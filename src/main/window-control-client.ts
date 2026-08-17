import { app } from 'electron';
import { join } from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';

let windowControlHost: ChildProcessWithoutNullStreams | null = null;
let windowControlRequestId = 0;
const windowControlPending = new Map<string, {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}>();
const WINDOW_CONTROL_COMMAND_TIMEOUT_MS = 15000;

function getWindowControlHostPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'window-control-host.ps1');
  }

  return join(process.cwd(), 'src/main/window-control-host.ps1');
}

function rejectAllPendingWindowControlRequests(error: Error): void {
  for (const pending of windowControlPending.values()) {
    clearTimeout(pending.timer);
    pending.reject(error);
  }
  windowControlPending.clear();
}

function ensureWindowControlHost(): ChildProcessWithoutNullStreams {
  if (windowControlHost && !windowControlHost.killed && windowControlHost.stdin.writable) {
    return windowControlHost;
  }

  const hostPath = getWindowControlHostPath();
  if (!existsSync(hostPath)) {
    throw new Error(`Window control host was not found: ${hostPath}`);
  }

  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', hostPath], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let stdoutBuffer = '';
  child.stdout.on('data', (chunk: Buffer) => {
    stdoutBuffer += chunk.toString('utf8');
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }

      let message: { id?: string; ok?: boolean; result?: unknown; error?: string };
      try {
        message = JSON.parse(line);
      } catch {
        console.error(`[window-control] Unparseable line from host: ${line}`);
        continue;
      }

      if (!message.id) {
        continue;
      }

      const pending = windowControlPending.get(message.id);
      if (!pending) {
        continue;
      }

      windowControlPending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.ok) {
        pending.resolve(message.result);
      } else {
        pending.reject(new Error(message.error || 'Window control command failed.'));
      }
    }
  });

  child.stderr.on('data', (chunk: Buffer) => {
    console.error(`[window-control] ${chunk.toString('utf8').trim()}`);
  });

  child.on('exit', () => {
    if (windowControlHost === child) {
      windowControlHost = null;
    }
    rejectAllPendingWindowControlRequests(new Error('Window control host process exited unexpectedly.'));
  });

  child.on('error', (error) => {
    if (windowControlHost === child) {
      windowControlHost = null;
    }
    rejectAllPendingWindowControlRequests(error instanceof Error ? error : new Error(String(error)));
  });

  windowControlHost = child;
  return child;
}

export function sendWindowControlCommand<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
  let child: ChildProcessWithoutNullStreams;
  try {
    child = ensureWindowControlHost();
  } catch (error) {
    return Promise.reject(error as Error);
  }

  const id = String(++windowControlRequestId);

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!windowControlPending.delete(id)) {
        return;
      }
      reject(new Error(`Window control command '${action}' timed out after ${WINDOW_CONTROL_COMMAND_TIMEOUT_MS}ms.`));
      if (windowControlHost === child) {
        windowControlHost = null;
        child.kill();
      }
    }, WINDOW_CONTROL_COMMAND_TIMEOUT_MS);

    windowControlPending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });

    try {
      child.stdin.write(`${JSON.stringify({ id, action, params })}\n`, 'utf8');
    } catch (error) {
      clearTimeout(timer);
      windowControlPending.delete(id);
      reject(error as Error);
    }
  });
}

export function stopWindowControlHost(): void {
  const child = windowControlHost;
  windowControlHost = null;
  rejectAllPendingWindowControlRequests(new Error('Window control host is shutting down.'));
  if (!child || child.killed) {
    return;
  }

  try {
    if (child.stdin.writable) {
      child.stdin.write(`${JSON.stringify({ id: '0', action: 'exit', params: {} })}\n`, 'utf8');
      child.stdin.end();
    }
  } catch {
    child.kill();
  }
}
