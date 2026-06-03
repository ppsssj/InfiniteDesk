# InfiniteDesk

InfiniteDesk is a Windows desktop controller for organizing real application windows on a spatial canvas.

It scans visible top-level Windows application windows, represents them as movable frames on an infinite canvas, saves layout regions as templates, and can apply those layouts back to the real OS windows.

## Current MVP

- Electron + React + TypeScript + Vite desktop app
- Windows window scanning through PowerShell and Win32 APIs
- Unicode-safe title scanning for Korean and other non-ASCII window titles
- Detection of HWND, title, process name, bounds, minimized state, and restorable state
- Minimized or invalid-bounds windows are protected from unsafe template saves
- InfiniteDesk internal Electron windows are excluded from managed targets
- Full-screen dark infinite canvas UI
- Virtual window frames with drag-based layout editing
- Template Regions created with Ctrl + drag
- Region membership based on window center-point containment
- Region dragging that moves assigned windows together
- Region saving, template preview, delete, and restore
- Apply Layout to move and resize real Windows application windows
- Live Control mode for immediate real window movement while dragging
- Window frame controls for focus, minimize, maximize, restore, close, and Work
- Dock launcher for default pinned Windows applications

## Live Control And Work Mode

InfiniteDesk does not embed Chrome, VS Code, or other app content inside React.

Instead, it controls the real Windows application windows by HWND:

- Dragging a frame in Live Control mode moves the real window.
- Clicking Focus brings the real window forward when Windows allows it.
- Clicking Work focuses the real window and minimizes InfiniteDesk so the user can work inside the actual app.
- Apply Layout moves all current canvas windows to their virtual positions.

This keeps applications real and interactive while InfiniteDesk acts as the spatial controller.

## Getting Started

Install dependencies:

```bash
npm install
```

Run the app in development:

```bash
npm run dev
```

Run validation:

```bash
npm run typecheck
npm run build
npm audit
```

## Usage

1. Start InfiniteDesk.
2. Scan Windows from the floating InfiniteDesk menu or press Ctrl+R.
3. Drag window frames to arrange a virtual layout.
4. Ctrl + drag on empty canvas to create a Template Region.
5. Drag windows into regions to assign them.
6. Save Regions to persist region templates.
7. Use Apply Layout to move real Windows windows to the current canvas layout.
8. Use Work on a frame to switch from InfiniteDesk into the real application window.

## Keyboard Shortcuts

- Ctrl+R: Scan Windows
- Ctrl+S: Save Regions
- Ctrl+Enter: Apply Layout
- Ctrl+0: Fit View
- Esc: Close overlays

## Architecture

```text
React Renderer
  |
  | preload IPC bridge
  v
Electron Main Process
  |
  | PowerShell script execution
  v
Win32 APIs
  |
  +-- EnumWindows / GetWindowText / GetWindowRect
  +-- MoveWindow
  +-- ShowWindow
  +-- SetForegroundWindow / BringWindowToTop
  +-- PostMessage(WM_CLOSE)
```

Templates are stored in Electron `userData` as `templates.json`.

## Project Structure

```text
src/
  main/
    index.ts        Electron main process and IPC handlers
    windows.ps1     Win32 scanning and window control script
  preload/
    index.ts        Safe renderer IPC API
  renderer/
    main.tsx        React app shell
    styles.css      Canvas and control styling
    canvas/         Coordinate, layout, and region helpers
    components/     Canvas and Dock components
    dock/           Default Dock app definitions
  shared/
    types.ts        Shared IPC and domain types
```

## Current Limitations

- App content is not embedded inside the canvas.
- Real-time window thumbnails are not implemented.
- DWM thumbnail integration is not implemented.
- Multi-monitor behavior is not specially modeled yet.
- Focus commands can be limited by Windows foreground restrictions.
- Elevated/admin windows may reject control from a non-elevated InfiniteDesk process.
- Dock apps are defined in code; installed app discovery is not implemented yet.

## Next Direction

The next major step is to choose a deeper live-desktop strategy:

- DWM thumbnails for live visual previews
- Overlay/controller mode with better recall behavior
- Optional native helper for stronger foreground and elevated-window control
- Region-level apply and launch workflows
