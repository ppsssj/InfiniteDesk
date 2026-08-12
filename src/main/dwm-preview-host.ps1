$ErrorActionPreference = "Stop"

Add-Type -ReferencedAssemblies @(
  "System.Windows.Forms",
  "System.Drawing",
  "System.Web.Extensions",
  "UIAutomationClient",
  "UIAutomationTypes",
  "WindowsBase"
) -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Automation;
using System.Windows.Forms;
using System.Web.Script.Serialization;

namespace InfiniteDeskPreview {
  public class PreviewItem {
    public string id { get; set; }
    public string hwnd { get; set; }
    public int x { get; set; }
    public int y { get; set; }
    public int width { get; set; }
    public int height { get; set; }
    public double cropX { get; set; }
    public double cropY { get; set; }
    public double cropWidth { get; set; }
    public double cropHeight { get; set; }
    public bool visible { get; set; }
    public int opacity { get; set; }
  }

  public class PreviewCommand {
    public string action { get; set; }
    public string ownerHwnd { get; set; }
    public List<PreviewItem> previews { get; set; }
    public PointerInputItem input { get; set; }
  }

  public class PointerInputItem {
    public string hwnd { get; set; }
    public double normalizedX { get; set; }
    public double normalizedY { get; set; }
    public string phase { get; set; }
    public string button { get; set; }
    public int buttons { get; set; }
    public int clickCount { get; set; }
    public int wheelDelta { get; set; }
    public string controllerHwnd { get; set; }
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct Rect {
    public int left;
    public int top;
    public int right;
    public int bottom;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct DwmSize {
    public int width;
    public int height;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct DwmThumbnailProperties {
    public int dwFlags;
    public Rect rcDestination;
    public Rect rcSource;
    public byte opacity;
    [MarshalAs(UnmanagedType.Bool)]
    public bool fVisible;
    [MarshalAs(UnmanagedType.Bool)]
    public bool fSourceClientAreaOnly;
  }

  public static class NativePointerRelay {
    private const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;
    private const uint CWP_SKIPINVISIBLE = 0x0001;
    private const uint CWP_SKIPDISABLED = 0x0002;
    private const uint CWP_SKIPTRANSPARENT = 0x0004;
    private const uint WM_MOUSEMOVE = 0x0200;
    private const uint WM_LBUTTONDOWN = 0x0201;
    private const uint WM_LBUTTONUP = 0x0202;
    private const uint WM_LBUTTONDBLCLK = 0x0203;
    private const uint WM_RBUTTONDOWN = 0x0204;
    private const uint WM_RBUTTONUP = 0x0205;
    private const uint WM_RBUTTONDBLCLK = 0x0206;
    private const uint WM_MBUTTONDOWN = 0x0207;
    private const uint WM_MBUTTONUP = 0x0208;
    private const uint WM_MBUTTONDBLCLK = 0x0209;
    private const uint WM_MOUSEWHEEL = 0x020A;
    private const int MK_LBUTTON = 0x0001;
    private const int MK_RBUTTON = 0x0002;
    private const int MK_MBUTTON = 0x0010;
    private const byte VK_CONTROL = 0x11;
    private const byte VK_UP = 0x26;
    private const byte VK_DOWN = 0x28;
    private const uint KEYEVENTF_KEYUP = 0x0002;
    private const int SM_CXDOUBLECLK = 36;
    private const int SM_CYDOUBLECLK = 37;
    private static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
    private static readonly HashSet<string> AccessibleWheelProcesses = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
      "chrome",
      "msedge",
      "brave",
      "vivaldi",
      "opera",
      "electron",
      "figma"
    };

    private static readonly Dictionary<long, IntPtr> capturedTargets = new Dictionary<long, IntPtr>();
    private static readonly Dictionary<long, int> capturedButtons = new Dictionary<long, int>();
    private sealed class ClickState {
      public IntPtr target;
      public string button;
      public Point screenPoint;
      public long timestamp;
    }
    private static readonly Dictionary<long, ClickState> lastClicks = new Dictionary<long, ClickState>();
    private sealed class CodeEditorTarget {
      public AutomationElement input;
      public System.Windows.Rect bounds;
    }
    private static readonly Dictionary<long, List<CodeEditorTarget>> codeEditorTargets = new Dictionary<long, List<CodeEditorTarget>>();
    private static readonly object codeScrollSync = new object();
    private static System.Threading.Timer codeFocusRestoreTimer;
    private static DateTime codeFocusRestoreAtUtc;
    private static IntPtr pendingCodeController = IntPtr.Zero;
    private static long activeCodeSource;
    private static AutomationElement activeCodeInput;

    [DllImport("user32.dll")]
    private static extern bool IsWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool BringWindowToTop(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();

    [DllImport("user32.dll")]
    private static extern bool AttachThreadInput(uint firstThread, uint secondThread, bool attach);

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr hWnd, out Rect rect);

    [DllImport("dwmapi.dll")]
    private static extern int DwmGetWindowAttribute(IntPtr hWnd, int attribute, out Rect rect, int size);

    [DllImport("user32.dll")]
    private static extern bool ScreenToClient(IntPtr hWnd, ref Point point);

    [DllImport("user32.dll")]
    private static extern IntPtr ChildWindowFromPointEx(IntPtr hWndParent, Point point, uint flags);

    [DllImport("user32.dll")]
    private static extern int MapWindowPoints(IntPtr hWndFrom, IntPtr hWndTo, ref Point points, uint pointCount);

    [DllImport("user32.dll")]
    private static extern bool PostMessage(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool SetWindowPos(IntPtr hWnd, IntPtr insertAfter, int x, int y, int width, int height, uint flags);

    [DllImport("user32.dll")]
    private static extern uint GetDoubleClickTime();

    [DllImport("user32.dll")]
    private static extern int GetSystemMetrics(int index);

    [DllImport("user32.dll")]
    private static extern void keybd_event(byte virtualKey, byte scanCode, uint flags, UIntPtr extraInfo);

    [StructLayout(LayoutKind.Sequential)]
    private struct Point {
      public int x;
      public int y;
    }

    public static void Relay(PointerInputItem input) {
      if (input == null || String.IsNullOrWhiteSpace(input.hwnd)) {
        return;
      }

      IntPtr source = ParseHwnd(input.hwnd);
      if (source == IntPtr.Zero || !IsWindow(source)) {
        return;
      }

      if (IsIconic(source)) {
        ShowWindow(source, 9);
      }

      Rect bounds;
      if (DwmGetWindowAttribute(source, DWMWA_EXTENDED_FRAME_BOUNDS, out bounds, Marshal.SizeOf(typeof(Rect))) != 0 ||
          bounds.right <= bounds.left || bounds.bottom <= bounds.top) {
        if (!GetWindowRect(source, out bounds)) {
          return;
        }
      }

      double normalizedX = Math.Max(0.0, Math.Min(1.0, input.normalizedX));
      double normalizedY = Math.Max(0.0, Math.Min(1.0, input.normalizedY));
      Point screenPoint = new Point {
        x = bounds.left + (int)Math.Round((bounds.right - bounds.left - 1) * normalizedX),
        y = bounds.top + (int)Math.Round((bounds.bottom - bounds.top - 1) * normalizedY)
      };

      long sourceKey = source.ToInt64();
      string phase = String.IsNullOrWhiteSpace(input.phase) ? "move" : input.phase.ToLowerInvariant();
      IntPtr target;
      if (!capturedTargets.TryGetValue(sourceKey, out target) || target == IntPtr.Zero || !IsWindow(target) || phase == "down") {
        target = FindDeepestTarget(source, screenPoint);
      }
      if (target == IntPtr.Zero) {
        target = source;
      }

      Point targetPoint = screenPoint;
      if (!ScreenToClient(target, ref targetPoint)) {
        return;
      }
      IntPtr pointParam = MakePointParam(targetPoint.x, targetPoint.y);

      if (phase == "down") {
        FocusSource(source);
        int buttonMask = ButtonMask(input.button);
        capturedTargets[sourceKey] = target;
        capturedButtons[sourceKey] = buttonMask;
        int clickCount = ResolveClickCount(sourceKey, target, input.button, screenPoint, input.clickCount);
        uint message = clickCount >= 2 ? DoubleClickMessage(input.button) : DownMessage(input.button);
        PostMessage(target, message, new IntPtr(buttonMask), pointParam);
        return;
      }

      if (phase == "move") {
        int buttonState = input.buttons > 0 ? DomButtonsToWin32(input.buttons) : GetCapturedButtons(sourceKey);
        PostMessage(target, WM_MOUSEMOVE, new IntPtr(buttonState), pointParam);
        return;
      }

      if (phase == "wheel") {
        IntPtr controller = ParseHwnd(input.controllerHwnd);
        if (TryRelayAccessibleWheel(source, controller, screenPoint, input.wheelDelta)) {
          return;
        }
        FocusSource(source);
        int wheelParam = (input.wheelDelta & 0xFFFF) << 16;
        PostMessage(target, WM_MOUSEWHEEL, new IntPtr(wheelParam), MakePointParam(screenPoint.x, screenPoint.y));
        return;
      }

      if (phase == "up" || phase == "cancel") {
        int pressedMask = GetCapturedButtons(sourceKey);
        if (phase == "cancel" && pressedMask != 0) {
          if ((pressedMask & MK_LBUTTON) != 0) PostMessage(target, WM_LBUTTONUP, IntPtr.Zero, pointParam);
          if ((pressedMask & MK_RBUTTON) != 0) PostMessage(target, WM_RBUTTONUP, IntPtr.Zero, pointParam);
          if ((pressedMask & MK_MBUTTON) != 0) PostMessage(target, WM_MBUTTONUP, IntPtr.Zero, pointParam);
        } else {
          PostMessage(target, UpMessage(input.button), IntPtr.Zero, pointParam);
        }
        capturedTargets.Remove(sourceKey);
        capturedButtons.Remove(sourceKey);
      }
    }

    public static void KeepControllerAbove(IntPtr controller) {
      if (controller == IntPtr.Zero || !IsWindow(controller)) {
        return;
      }
      SetWindowPos(controller, HWND_TOPMOST, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010);
    }

    public static bool IsValidWindow(IntPtr handle) {
      return handle != IntPtr.Zero && IsWindow(handle);
    }

    private static void FocusSource(IntPtr source) {
      uint ignoredProcessId;
      uint currentThread = GetCurrentThreadId();
      IntPtr foreground = GetForegroundWindow();
      uint foregroundThread = foreground == IntPtr.Zero ? 0 : GetWindowThreadProcessId(foreground, out ignoredProcessId);
      uint sourceThread = GetWindowThreadProcessId(source, out ignoredProcessId);
      bool attachedForeground = foregroundThread != 0 && foregroundThread != currentThread && AttachThreadInput(currentThread, foregroundThread, true);
      bool attachedSource = sourceThread != 0 && sourceThread != currentThread && AttachThreadInput(currentThread, sourceThread, true);
      try {
        BringWindowToTop(source);
        SetForegroundWindow(source);
      } finally {
        if (attachedSource) AttachThreadInput(currentThread, sourceThread, false);
        if (attachedForeground) AttachThreadInput(currentThread, foregroundThread, false);
      }
    }

    private static string GetProcessName(IntPtr source) {
      uint processId;
      GetWindowThreadProcessId(source, out processId);
      if (processId == 0) {
        return String.Empty;
      }
      try {
        return Process.GetProcessById((int)processId).ProcessName;
      } catch {
        return String.Empty;
      }
    }

    private static bool TryRelayAccessibleWheel(IntPtr source, IntPtr controller, Point screenPoint, int wheelDelta) {
      if (wheelDelta == 0) {
        return true;
      }

      string processName = GetProcessName(source);
      if (String.Equals(processName, "code", StringComparison.OrdinalIgnoreCase)) {
        // VS Code extension surfaces such as Codex are scrollable webviews, not
        // Monaco editor instances. Prefer the scrollable UIA element directly
        // under the pointer, then keep the editor-specific keyboard fallback.
        if (TryScrollAutomation(source, screenPoint, wheelDelta, true)) {
          return true;
        }
        return TryScrollCodeEditor(source, controller, screenPoint, wheelDelta);
      }
      return AccessibleWheelProcesses.Contains(processName) && TryScrollAutomation(source, screenPoint, wheelDelta, false);
    }

    private static bool TryScrollAutomation(IntPtr source, Point screenPoint, int wheelDelta, bool requirePointMatch) {
      try {
        AutomationElement root = AutomationElement.FromHandle(source);
        Condition condition = new PropertyCondition(AutomationElement.IsScrollPatternAvailableProperty, true);
        AutomationElementCollection candidates = root.FindAll(TreeScope.Descendants, condition);
        AutomationElement selected = null;
        AutomationElement fallback = null;
        double selectedArea = Double.MaxValue;

        for (int index = 0; index < candidates.Count; index++) {
          AutomationElement candidate = candidates[index];
          ScrollPattern pattern;
          try {
            pattern = (ScrollPattern)candidate.GetCurrentPattern(ScrollPattern.Pattern);
          } catch {
            continue;
          }
          if (!pattern.Current.VerticallyScrollable) {
            continue;
          }
          if (fallback == null) {
            fallback = candidate;
          }

          System.Windows.Rect bounds = candidate.Current.BoundingRectangle;
          bool containsPoint = !bounds.IsEmpty &&
            screenPoint.x >= bounds.Left && screenPoint.x < bounds.Right &&
            screenPoint.y >= bounds.Top && screenPoint.y < bounds.Bottom;
          double area = bounds.IsEmpty ? Double.MaxValue : bounds.Width * bounds.Height;
          if (containsPoint && area < selectedArea) {
            selected = candidate;
            selectedArea = area;
          }
        }
        if (selected == null && !requirePointMatch) {
          selected = fallback;
        }
        if (selected == null) {
          return false;
        }

        ScrollPattern selectedPattern = (ScrollPattern)selected.GetCurrentPattern(ScrollPattern.Pattern);
        ScrollAmount amount = wheelDelta < 0 ? ScrollAmount.SmallIncrement : ScrollAmount.SmallDecrement;
        int steps = Math.Max(1, Math.Abs(wheelDelta) / 120) * 3;
        for (int step = 0; step < steps; step++) {
          selectedPattern.Scroll(ScrollAmount.NoAmount, amount);
        }
        return true;
      } catch {
        return false;
      }
    }

    private static bool TryScrollCodeEditor(IntPtr source, IntPtr controller, Point screenPoint, int wheelDelta) {
      long sourceKey = source.ToInt64();
      for (int attempt = 0; attempt < 2; attempt++) {
        try {
          CodeEditorTarget target = FindCodeEditorTarget(source, screenPoint, attempt > 0);
          if (target == null) {
            return false;
          }

          bool needsFocus = GetForegroundWindow() != source ||
            activeCodeSource != sourceKey ||
            !Object.ReferenceEquals(activeCodeInput, target.input);
          if (needsFocus) {
            FocusSource(source);
            target.input.SetFocus();
            Thread.Sleep(8);
            activeCodeSource = sourceKey;
            activeCodeInput = target.input;
          }

          int steps = Math.Max(1, Math.Abs(wheelDelta) / 120);
          byte direction = wheelDelta < 0 ? VK_DOWN : VK_UP;
          for (int step = 0; step < steps; step++) {
            keybd_event(VK_CONTROL, 0, 0, UIntPtr.Zero);
            keybd_event(direction, 0, 0, UIntPtr.Zero);
            keybd_event(direction, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
            keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
          }
          ScheduleCodeFocusRestore(controller);
          return true;
        } catch {
          codeEditorTargets.Remove(sourceKey);
          activeCodeSource = 0;
          activeCodeInput = null;
        }
      }
      return false;
    }

    private static CodeEditorTarget FindCodeEditorTarget(IntPtr source, Point screenPoint, bool refresh) {
      long sourceKey = source.ToInt64();
      List<CodeEditorTarget> targets;
      if (refresh || !codeEditorTargets.TryGetValue(sourceKey, out targets)) {
        targets = new List<CodeEditorTarget>();
        AutomationElement root = AutomationElement.FromHandle(source);
        Condition editorsCondition = new PropertyCondition(AutomationElement.ClassNameProperty, "editor-instance");
        Condition inputCondition = new PropertyCondition(AutomationElement.ClassNameProperty, "native-edit-context");
        AutomationElementCollection editors = root.FindAll(TreeScope.Descendants, editorsCondition);
        for (int index = 0; index < editors.Count; index++) {
          AutomationElement editor = editors[index];
          AutomationElement input = editor.FindFirst(TreeScope.Descendants, inputCondition);
          if (input == null) {
            continue;
          }
          targets.Add(new CodeEditorTarget {
            input = input,
            bounds = editor.Current.BoundingRectangle
          });
        }
        codeEditorTargets[sourceKey] = targets;
      }

      foreach (CodeEditorTarget target in targets) {
        System.Windows.Rect bounds = target.bounds;
        if (!bounds.IsEmpty &&
            screenPoint.x >= bounds.Left && screenPoint.x < bounds.Right &&
            screenPoint.y >= bounds.Top && screenPoint.y < bounds.Bottom) {
          return target;
        }
      }
      return null;
    }

    private static void ScheduleCodeFocusRestore(IntPtr controller) {
      if (controller == IntPtr.Zero || !IsWindow(controller)) {
        return;
      }
      lock (codeScrollSync) {
        pendingCodeController = controller;
        codeFocusRestoreAtUtc = DateTime.UtcNow.AddMilliseconds(180);
        if (codeFocusRestoreTimer == null) {
          codeFocusRestoreTimer = new System.Threading.Timer(RestoreCodeFocus, null, 180, Timeout.Infinite);
        } else {
          codeFocusRestoreTimer.Change(180, Timeout.Infinite);
        }
      }
    }

    private static void RestoreCodeFocus(object state) {
      IntPtr controller;
      lock (codeScrollSync) {
        int remaining = (int)Math.Ceiling((codeFocusRestoreAtUtc - DateTime.UtcNow).TotalMilliseconds);
        if (remaining > 0) {
          codeFocusRestoreTimer.Change(remaining, Timeout.Infinite);
          return;
        }
        controller = pendingCodeController;
        pendingCodeController = IntPtr.Zero;
        activeCodeSource = 0;
        activeCodeInput = null;
      }
      if (controller != IntPtr.Zero && IsWindow(controller)) {
        KeepControllerAbove(controller);
        FocusSource(controller);
      }
    }

    private static IntPtr FindDeepestTarget(IntPtr source, Point screenPoint) {
      Point point = screenPoint;
      if (!ScreenToClient(source, ref point)) {
        return source;
      }
      IntPtr target = source;
      uint flags = CWP_SKIPINVISIBLE | CWP_SKIPDISABLED | CWP_SKIPTRANSPARENT;
      for (int depth = 0; depth < 12; depth++) {
        IntPtr child = ChildWindowFromPointEx(target, point, flags);
        if (child == IntPtr.Zero || child == target) {
          break;
        }
        MapWindowPoints(target, child, ref point, 1);
        target = child;
      }
      return target;
    }

    private static int GetCapturedButtons(long sourceKey) {
      int value;
      return capturedButtons.TryGetValue(sourceKey, out value) ? value : 0;
    }

    private static int ResolveClickCount(long sourceKey, IntPtr target, string button, Point screenPoint, int reportedClickCount) {
      string normalizedButton = String.IsNullOrWhiteSpace(button) ? "left" : button.ToLowerInvariant();
      long now = Stopwatch.GetTimestamp();
      ClickState previous;
      bool isDoubleClick = reportedClickCount >= 2;

      if (!isDoubleClick && lastClicks.TryGetValue(sourceKey, out previous)) {
        long maximumTicks = Math.Max(1L, (long)Math.Ceiling(GetDoubleClickTime() * Stopwatch.Frequency / 1000.0));
        int maximumXDistance = Math.Max(1, GetSystemMetrics(SM_CXDOUBLECLK) / 2);
        int maximumYDistance = Math.Max(1, GetSystemMetrics(SM_CYDOUBLECLK) / 2);
        isDoubleClick = previous.target == target &&
          String.Equals(previous.button, normalizedButton, StringComparison.Ordinal) &&
          now - previous.timestamp >= 0 && now - previous.timestamp <= maximumTicks &&
          Math.Abs(screenPoint.x - previous.screenPoint.x) <= maximumXDistance &&
          Math.Abs(screenPoint.y - previous.screenPoint.y) <= maximumYDistance;
      }

      if (isDoubleClick) {
        lastClicks.Remove(sourceKey);
        return 2;
      }

      lastClicks[sourceKey] = new ClickState {
        target = target,
        button = normalizedButton,
        screenPoint = screenPoint,
        timestamp = now
      };
      return 1;
    }

    private static int ButtonMask(string button) {
      string normalized = String.IsNullOrWhiteSpace(button) ? "left" : button.ToLowerInvariant();
      if (normalized == "right") return MK_RBUTTON;
      if (normalized == "middle") return MK_MBUTTON;
      return MK_LBUTTON;
    }

    private static int DomButtonsToWin32(int buttons) {
      int result = 0;
      if ((buttons & 1) != 0) result |= MK_LBUTTON;
      if ((buttons & 2) != 0) result |= MK_RBUTTON;
      if ((buttons & 4) != 0) result |= MK_MBUTTON;
      return result;
    }

    private static uint DownMessage(string button) {
      string normalized = String.IsNullOrWhiteSpace(button) ? "left" : button.ToLowerInvariant();
      if (normalized == "right") return WM_RBUTTONDOWN;
      if (normalized == "middle") return WM_MBUTTONDOWN;
      return WM_LBUTTONDOWN;
    }

    private static uint DoubleClickMessage(string button) {
      string normalized = String.IsNullOrWhiteSpace(button) ? "left" : button.ToLowerInvariant();
      if (normalized == "right") return WM_RBUTTONDBLCLK;
      if (normalized == "middle") return WM_MBUTTONDBLCLK;
      return WM_LBUTTONDBLCLK;
    }

    private static uint UpMessage(string button) {
      string normalized = String.IsNullOrWhiteSpace(button) ? "left" : button.ToLowerInvariant();
      if (normalized == "right") return WM_RBUTTONUP;
      if (normalized == "middle") return WM_MBUTTONUP;
      return WM_LBUTTONUP;
    }

    private static IntPtr MakePointParam(int x, int y) {
      uint value = ((uint)(ushort)y << 16) | (uint)(ushort)x;
      return new IntPtr((long)value);
    }

    private static IntPtr ParseHwnd(string value) {
      string trimmed = value.Trim();
      if (trimmed.StartsWith("0x", StringComparison.OrdinalIgnoreCase)) {
        return new IntPtr(Convert.ToInt64(trimmed.Substring(2), 16));
      }
      return new IntPtr(Convert.ToInt64(trimmed));
    }
  }

  public sealed class MouseWheelHook : IDisposable {
    private const int WH_MOUSE_LL = 14;
    private const int WM_MOUSEWHEEL = 0x020A;
    private const uint LLMHF_INJECTED = 0x00000001;
    private delegate IntPtr HookProcedure(int code, IntPtr message, IntPtr data);
    public delegate bool WheelHandler(int screenX, int screenY, int delta);

    [StructLayout(LayoutKind.Sequential)]
    private struct HookPoint {
      public int x;
      public int y;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct LowLevelMouseInput {
      public HookPoint point;
      public uint mouseData;
      public uint flags;
      public uint time;
      public IntPtr extraInfo;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int hookId, HookProcedure callback, IntPtr module, uint threadId);

    [DllImport("user32.dll")]
    private static extern bool UnhookWindowsHookEx(IntPtr hook);

    [DllImport("user32.dll")]
    private static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr message, IntPtr data);

    [DllImport("kernel32.dll")]
    private static extern IntPtr GetModuleHandle(string moduleName);

    private readonly HookProcedure callback;
    private readonly WheelHandler handler;
    private IntPtr hook;

    public MouseWheelHook(WheelHandler handler) {
      this.handler = handler;
      callback = HandleHook;
      hook = SetWindowsHookEx(WH_MOUSE_LL, callback, GetModuleHandle(null), 0);
    }

    private IntPtr HandleHook(int code, IntPtr message, IntPtr data) {
      if (code >= 0 && message.ToInt32() == WM_MOUSEWHEEL) {
        LowLevelMouseInput input = (LowLevelMouseInput)Marshal.PtrToStructure(data, typeof(LowLevelMouseInput));
        if ((input.flags & LLMHF_INJECTED) != 0) {
          return CallNextHookEx(hook, code, message, data);
        }
        int delta = (short)((input.mouseData >> 16) & 0xFFFF);
        if (delta != 0 && handler(input.point.x, input.point.y, delta)) {
          return new IntPtr(1);
        }
      }
      return CallNextHookEx(hook, code, message, data);
    }

    public void Dispose() {
      if (hook != IntPtr.Zero) {
        UnhookWindowsHookEx(hook);
        hook = IntPtr.Zero;
      }
      GC.KeepAlive(callback);
    }
  }

  public sealed class PreviewForm : Form {
    private const int WS_EX_TOOLWINDOW = 0x00000080;
    private const int WS_EX_NOACTIVATE = 0x08000000;
    private const int DWM_TNP_RECTDESTINATION = 0x00000001;
    private const int DWM_TNP_RECTSOURCE = 0x00000002;
    private const int DWM_TNP_OPACITY = 0x00000004;
    private const int DWM_TNP_VISIBLE = 0x00000008;
    private const int DWM_TNP_SOURCECLIENTAREAONLY = 0x00000010;
    private const int GWLP_HWNDPARENT = -8;
    private const uint SWP_NOSIZE = 0x0001;
    private const uint SWP_NOMOVE = 0x0002;
    private const uint SWP_NOACTIVATE = 0x0010;
    private const uint SWP_SHOWWINDOW = 0x0040;
    private const int GWL_EXSTYLE = -20;
    private const long WS_EX_TOPMOST = 0x00000008L;
    private const int SW_SHOWNOACTIVATE = 4;
    private static readonly IntPtr HWND_TOP = IntPtr.Zero;
    private static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
    private static readonly IntPtr HWND_NOTOPMOST = new IntPtr(-2);
    private static readonly HashSet<string> BrowserProcessesKeptRendered = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
      "chrome",
      "chromium",
      "msedge",
      "brave",
      "vivaldi",
      "opera"
    };

    [DllImport("dwmapi.dll")]
    private static extern int DwmRegisterThumbnail(IntPtr hwndDestination, IntPtr hwndSource, out IntPtr thumbnail);

    [DllImport("dwmapi.dll")]
    private static extern int DwmUnregisterThumbnail(IntPtr thumbnail);

    [DllImport("dwmapi.dll")]
    private static extern int DwmUpdateThumbnailProperties(IntPtr thumbnail, ref DwmThumbnailProperties properties);

    [DllImport("dwmapi.dll")]
    private static extern int DwmQueryThumbnailSourceSize(IntPtr thumbnail, out DwmSize size);

    [DllImport("dwmapi.dll")]
    private static extern int DwmFlush();

    [DllImport("dwmapi.dll")]
    private static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out Rect bounds, int size);

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr hwnd, out Rect bounds);

    [DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr hwnd);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hwnd, int command);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);

    [DllImport("user32.dll", EntryPoint="SetWindowLong")]
    private static extern int SetWindowLong32(IntPtr hWnd, int index, int value);

    [DllImport("user32.dll", EntryPoint="SetWindowLongPtr")]
    private static extern IntPtr SetWindowLongPtr64(IntPtr hWnd, int index, IntPtr value);

    [DllImport("user32.dll", EntryPoint="GetWindowLong")]
    private static extern int GetWindowLong32(IntPtr hWnd, int index);

    [DllImport("user32.dll", EntryPoint="GetWindowLongPtr")]
    private static extern IntPtr GetWindowLongPtr64(IntPtr hWnd, int index);

    [DllImport("user32.dll")]
    private static extern bool SetWindowPos(IntPtr hWnd, IntPtr insertAfter, int x, int y, int width, int height, uint flags);

    private IntPtr thumbnail = IntPtr.Zero;
    private IntPtr sourceHwnd = IntPtr.Zero;
    private IntPtr ownerHwnd = IntPtr.Zero;
    private RectangleF currentSourceCrop = new RectangleF(0, 0, 1, 1);
    private IntPtr desiredSourceHwnd = IntPtr.Zero;
    private Rectangle desiredBounds = Rectangle.Empty;
    private RectangleF desiredSourceCrop = new RectangleF(0, 0, 1, 1);
    private byte desiredOpacity = 255;
    private bool desiredOwnerIsTopmost;
    private bool pointerIsDown;
    private string pressedButton = "left";
    private double lastNormalizedX;
    private double lastNormalizedY;
    private const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;

    public IntPtr SourceHwnd {
      get { return sourceHwnd; }
    }

    public PreviewForm() {
      FormBorderStyle = FormBorderStyle.None;
      ShowInTaskbar = false;
      StartPosition = FormStartPosition.Manual;
      BackColor = Color.Black;
      TopMost = false;
      Opacity = 1.0;
      Width = 1;
      Height = 1;
    }

    protected override bool ShowWithoutActivation {
      get { return true; }
    }

    protected override CreateParams CreateParams {
      get {
        CreateParams cp = base.CreateParams;
        cp.ExStyle |= WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE;
        return cp;
      }
    }

    public void SetOwnerWindow(IntPtr ownerHwnd) {
      if (ownerHwnd == IntPtr.Zero) {
        return;
      }
      this.ownerHwnd = ownerHwnd;
      IntPtr previewHwnd = Handle;
      if (IntPtr.Size == 8) {
        SetWindowLongPtr64(previewHwnd, GWLP_HWNDPARENT, ownerHwnd);
      } else {
        SetWindowLong32(previewHwnd, GWLP_HWNDPARENT, ownerHwnd.ToInt32());
      }
    }

    public static bool BringOwnerForward(IntPtr ownerHwnd) {
      if (ownerHwnd == IntPtr.Zero) {
        return false;
      }
      long exStyle = IntPtr.Size == 8
        ? GetWindowLongPtr64(ownerHwnd, GWL_EXSTYLE).ToInt64()
        : GetWindowLong32(ownerHwnd, GWL_EXSTYLE);
      bool ownerIsTopmost = (exStyle & WS_EX_TOPMOST) != 0;
      SetWindowPos(
        ownerHwnd,
        ownerIsTopmost ? HWND_TOPMOST : HWND_TOP,
        0,
        0,
        0,
        0,
        SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE
      );
      return ownerIsTopmost;
    }

    public void UpdatePreview(IntPtr nextSourceHwnd, Rectangle bounds, RectangleF sourceCrop, byte nextOpacity, bool ownerIsTopmost) {
      if (bounds.Width <= 1 || bounds.Height <= 1 || nextSourceHwnd == IntPtr.Zero) {
        HidePreview();
        return;
      }

      desiredSourceHwnd = nextSourceHwnd;
      desiredBounds = bounds;
      desiredSourceCrop = sourceCrop;
      desiredOpacity = nextOpacity;
      desiredOwnerIsTopmost = ownerIsTopmost;
      Bounds = bounds;
      currentSourceCrop = sourceCrop;

      // Chromium stops producing its web-content composition surface while a
      // top-level window is minimized. Restore it without activation so DWM
      // thumbnails keep receiving live page frames, then return the controller
      // to the front of its current z-order band.
      if (RestoreBrowserSourceWithoutActivation(nextSourceHwnd)) {
        ownerIsTopmost = BringOwnerForward(ownerHwnd);
        desiredOwnerIsTopmost = ownerIsTopmost;
      }

      if (thumbnail == IntPtr.Zero || sourceHwnd != nextSourceHwnd) {
        UnregisterThumbnail();
        sourceHwnd = nextSourceHwnd;
        int registerResult = DwmRegisterThumbnail(Handle, sourceHwnd, out thumbnail);
        if (registerResult != 0 || thumbnail == IntPtr.Zero) {
          UnregisterThumbnail();
          HideWindowOnly();
          return;
        }
      }

      DwmThumbnailProperties properties = new DwmThumbnailProperties();
      properties.dwFlags = DWM_TNP_RECTDESTINATION | DWM_TNP_VISIBLE | DWM_TNP_OPACITY | DWM_TNP_SOURCECLIENTAREAONLY;
      properties.rcDestination = new Rect { left = 0, top = 0, right = bounds.Width, bottom = bounds.Height };
      DwmSize sourceSize;
      if (DwmQueryThumbnailSourceSize(thumbnail, out sourceSize) == 0 && sourceSize.width > 0 && sourceSize.height > 0) {
        Point sourceOffset = GetVisibleSourceOffset();
        int sourceLeft = sourceOffset.X + Math.Max(0, Math.Min(sourceSize.width - 1, (int)Math.Round(sourceCrop.X * sourceSize.width)));
        int sourceTop = sourceOffset.Y + Math.Max(0, Math.Min(sourceSize.height - 1, (int)Math.Round(sourceCrop.Y * sourceSize.height)));
        int sourceRight = sourceOffset.X + Math.Max(sourceLeft - sourceOffset.X + 1, Math.Min(sourceSize.width, (int)Math.Round((sourceCrop.X + sourceCrop.Width) * sourceSize.width)));
        int sourceBottom = sourceOffset.Y + Math.Max(sourceTop - sourceOffset.Y + 1, Math.Min(sourceSize.height, (int)Math.Round((sourceCrop.Y + sourceCrop.Height) * sourceSize.height)));
        properties.dwFlags |= DWM_TNP_RECTSOURCE;
        properties.rcSource = new Rect { left = sourceLeft, top = sourceTop, right = sourceRight, bottom = sourceBottom };
      }
      properties.opacity = nextOpacity;
      properties.fVisible = true;
      properties.fSourceClientAreaOnly = false;
      int updateResult = DwmUpdateThumbnailProperties(thumbnail, ref properties);
      if (updateResult != 0) {
        UnregisterThumbnail();
        HideWindowOnly();
        return;
      }
      bool wasHidden = !Visible;
      if (wasHidden) {
        Show();
      }
      // Keep previews in the same z-order band as their Electron owner. Making
      // only the previews permanently topmost leaves them floating over other
      // apps when a newly launched process moves the controller behind itself.
      SetWindowPos(
        Handle,
        ownerIsTopmost ? HWND_TOPMOST : HWND_NOTOPMOST,
        0,
        0,
        0,
        0,
        SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW
      );
      if (wasHidden) {
        // DWM can defer an update issued while the destination is hidden.
        // Re-apply once the native destination is visible and wait for the
        // next composition pass so a newly-created source appears promptly.
        DwmUpdateThumbnailProperties(thumbnail, ref properties);
        DwmFlush();
      }
    }

    public void MaintainSourceRendering() {
      if (!RestoreBrowserSourceWithoutActivation(sourceHwnd)) {
        return;
      }

      bool ownerIsTopmost = BringOwnerForward(ownerHwnd);
      desiredOwnerIsTopmost = ownerIsTopmost;
      if (IsHandleCreated) {
        SetWindowPos(
          Handle,
          ownerIsTopmost ? HWND_TOPMOST : HWND_NOTOPMOST,
          0,
          0,
          0,
          0,
          SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW
        );
      }
    }

    private static bool RestoreBrowserSourceWithoutActivation(IntPtr sourceHwnd) {
      if (sourceHwnd == IntPtr.Zero || !IsIconic(sourceHwnd)) {
        return false;
      }

      uint processId;
      GetWindowThreadProcessId(sourceHwnd, out processId);
      if (processId == 0) {
        return false;
      }

      string processName;
      try {
        processName = Process.GetProcessById((int)processId).ProcessName;
      } catch {
        return false;
      }
      if (!BrowserProcessesKeptRendered.Contains(processName)) {
        return false;
      }

      ShowWindow(sourceHwnd, SW_SHOWNOACTIVATE);
      return !IsIconic(sourceHwnd);
    }

    public void RetryPendingPreview() {
      if (desiredSourceHwnd == IntPtr.Zero) {
        return;
      }
      if (thumbnail != IntPtr.Zero) {
        return;
      }
      UpdatePreview(desiredSourceHwnd, desiredBounds, desiredSourceCrop, desiredOpacity, desiredOwnerIsTopmost);
    }

    private Point GetVisibleSourceOffset() {
      Rect windowBounds;
      Rect visibleBounds;
      if (!GetWindowRect(sourceHwnd, out windowBounds) ||
          DwmGetWindowAttribute(sourceHwnd, DWMWA_EXTENDED_FRAME_BOUNDS, out visibleBounds, Marshal.SizeOf(typeof(Rect))) != 0) {
        return new Point(0, 0);
      }

      int offsetX = visibleBounds.left - windowBounds.left;
      int offsetY = visibleBounds.top - windowBounds.top;
      return new Point(Math.Max(0, Math.Min(32, offsetX)), Math.Max(0, Math.Min(32, offsetY)));
    }

    protected override void OnMouseDown(MouseEventArgs eventArgs) {
      NativePointerRelay.KeepControllerAbove(ownerHwnd);
      pressedButton = GetButtonName(eventArgs.Button);
      pointerIsDown = true;
      Capture = true;
      RelayMouse(eventArgs, "down", pressedButton);
    }

    protected override void OnMouseMove(MouseEventArgs eventArgs) {
      RelayMouse(eventArgs, "move", pointerIsDown ? pressedButton : GetButtonName(eventArgs.Button));
    }

    protected override void OnMouseUp(MouseEventArgs eventArgs) {
      RelayMouse(eventArgs, "up", GetButtonName(eventArgs.Button));
      pointerIsDown = false;
      Capture = false;
      Console.Out.WriteLine("{\"event\":\"interaction\",\"hwnd\":\"" + HwndToString(sourceHwnd) + "\"}");
      Console.Out.Flush();
    }

    protected override void OnMouseWheel(MouseEventArgs eventArgs) {
      NativePointerRelay.KeepControllerAbove(ownerHwnd);
      RelayMouse(eventArgs, "wheel", "left");
    }

    public void RelayWheelAtScreenPoint(int screenX, int screenY, int delta) {
      Point clientPoint = PointToClient(new Point(screenX, screenY));
      if (clientPoint.X < 0 || clientPoint.Y < 0 || clientPoint.X >= ClientSize.Width || clientPoint.Y >= ClientSize.Height) {
        return;
      }
      NativePointerRelay.KeepControllerAbove(ownerHwnd);
      RelayMouse(new MouseEventArgs(MouseButtons.None, 0, clientPoint.X, clientPoint.Y, delta), "wheel", "left");
    }

    protected override void OnMouseCaptureChanged(EventArgs eventArgs) {
      base.OnMouseCaptureChanged(eventArgs);
      if (!pointerIsDown || Capture) {
        return;
      }
      NativePointerRelay.Relay(new PointerInputItem {
        hwnd = HwndToString(sourceHwnd),
        normalizedX = lastNormalizedX,
        normalizedY = lastNormalizedY,
        phase = "cancel",
        button = pressedButton,
        buttons = 0,
        wheelDelta = 0
      });
      pointerIsDown = false;
    }

    private void RelayMouse(MouseEventArgs eventArgs, string phase, string button) {
      if (sourceHwnd == IntPtr.Zero || ClientSize.Width <= 0 || ClientSize.Height <= 0) {
        return;
      }
      double localX = Math.Max(0.0, Math.Min(1.0, (double)eventArgs.X / Math.Max(1, ClientSize.Width - 1)));
      double localY = Math.Max(0.0, Math.Min(1.0, (double)eventArgs.Y / Math.Max(1, ClientSize.Height - 1)));
      lastNormalizedX = currentSourceCrop.X + localX * currentSourceCrop.Width;
      lastNormalizedY = currentSourceCrop.Y + localY * currentSourceCrop.Height;
      NativePointerRelay.Relay(new PointerInputItem {
        hwnd = HwndToString(sourceHwnd),
        normalizedX = lastNormalizedX,
        normalizedY = lastNormalizedY,
        phase = phase,
        button = button,
        buttons = GetButtons(eventArgs.Button),
        clickCount = Math.Max(1, eventArgs.Clicks),
        wheelDelta = eventArgs.Delta,
        controllerHwnd = HwndToString(ownerHwnd)
      });
    }

    private static string GetButtonName(MouseButtons button) {
      if ((button & MouseButtons.Right) == MouseButtons.Right) return "right";
      if ((button & MouseButtons.Middle) == MouseButtons.Middle) return "middle";
      return "left";
    }

    private static int GetButtons(MouseButtons buttons) {
      int result = 0;
      if ((buttons & MouseButtons.Left) == MouseButtons.Left) result |= 1;
      if ((buttons & MouseButtons.Right) == MouseButtons.Right) result |= 2;
      if ((buttons & MouseButtons.Middle) == MouseButtons.Middle) result |= 4;
      return result;
    }

    private static string HwndToString(IntPtr handle) {
      return "0x" + handle.ToInt64().ToString("X");
    }

    public void HidePreview() {
      desiredSourceHwnd = IntPtr.Zero;
      HideWindowOnly();
    }

    private void HideWindowOnly() {
      if (Visible) {
        Hide();
      }
    }

    public void RemoveClosedSource() {
      HidePreview();
      UnregisterThumbnail();
    }

    protected override void Dispose(bool disposing) {
      UnregisterThumbnail();
      base.Dispose(disposing);
    }

    private void UnregisterThumbnail() {
      if (thumbnail != IntPtr.Zero) {
        DwmUnregisterThumbnail(thumbnail);
        thumbnail = IntPtr.Zero;
      }
      sourceHwnd = IntPtr.Zero;
    }
  }

  public sealed class PreviewContext : ApplicationContext {
    private readonly Control invoker = new Control();
    private readonly Dictionary<string, PreviewForm> forms = new Dictionary<string, PreviewForm>();
    private readonly HashSet<long> reportedClosedSources = new HashSet<long>();
    private readonly System.Windows.Forms.Timer windowWatchTimer = new System.Windows.Forms.Timer();
    private readonly object pendingSyncLock = new object();
    private PreviewCommand pendingSyncCommand;
    private bool syncDispatchScheduled;
    private readonly MouseWheelHook mouseWheelHook;

    public PreviewContext() {
      invoker.CreateControl();
      IntPtr ignored = invoker.Handle;
      mouseWheelHook = new MouseWheelHook(TryRelayMouseWheel);
      windowWatchTimer.Interval = 250;
      windowWatchTimer.Tick += delegate(object sender, EventArgs args) { MaintainPreviews(); };
      windowWatchTimer.Start();
    }

    public void Post(Action action) {
      if (invoker.IsDisposed) {
        return;
      }
      invoker.BeginInvoke(action);
    }

    public void PostCommand(PreviewCommand command) {
      string action = command == null || command.action == null ? "" : command.action.ToLowerInvariant();
      if (action != "sync") {
        Post(delegate() { HandleCommand(command); });
        return;
      }

      lock (pendingSyncLock) {
        pendingSyncCommand = command;
        if (syncDispatchScheduled) {
          return;
        }
        syncDispatchScheduled = true;
      }
      Post(ProcessLatestSync);
    }

    private void ProcessLatestSync() {
      PreviewCommand command;
      lock (pendingSyncLock) {
        command = pendingSyncCommand;
        pendingSyncCommand = null;
        syncDispatchScheduled = false;
      }
      if (command != null) {
        HandleCommand(command);
      }
    }

    public void HandleCommand(PreviewCommand command) {
      string action = command.action == null ? "" : command.action.ToLowerInvariant();
      if (action == "exit") {
        windowWatchTimer.Stop();
        mouseWheelHook.Dispose();
        ClearForms(true);
        ExitThread();
        return;
      }

      if (action == "clear" || action == "hide") {
        ClearForms(action == "clear");
        return;
      }

      if (action == "input") {
        NativePointerRelay.Relay(command.input);
        return;
      }

      if (action != "sync") {
        return;
      }

      IntPtr ownerHwnd = ParseHwnd(command.ownerHwnd);
      bool ownerIsTopmost = PreviewForm.BringOwnerForward(ownerHwnd);
      HashSet<string> seen = new HashSet<string>();
      if (command.previews != null) {
        foreach (PreviewItem item in command.previews) {
          if (item == null || String.IsNullOrWhiteSpace(item.id)) {
            continue;
          }
          seen.Add(item.id);

          PreviewForm form;
          if (!forms.TryGetValue(item.id, out form) || form.IsDisposed) {
            form = new PreviewForm();
            forms[item.id] = form;
          }
          form.SetOwnerWindow(ownerHwnd);

          if (!item.visible || String.IsNullOrWhiteSpace(item.hwnd) || item.width <= 1 || item.height <= 1) {
            form.HidePreview();
            continue;
          }

          IntPtr sourceHwnd = ParseHwnd(item.hwnd);
          byte opacity = item.opacity <= 0 ? (byte)255 : (byte)Math.Min(255, item.opacity);
          RectangleF sourceCrop = new RectangleF((float)item.cropX, (float)item.cropY, (float)item.cropWidth, (float)item.cropHeight);
          form.UpdatePreview(sourceHwnd, new Rectangle(item.x, item.y, item.width, item.height), sourceCrop, opacity, ownerIsTopmost);
        }
      }

      List<string> staleIds = new List<string>();
      foreach (string id in forms.Keys) {
        if (!seen.Contains(id)) {
          staleIds.Add(id);
        }
      }
      foreach (string id in staleIds) {
        forms[id].HidePreview();
      }
    }

    private bool TryRelayMouseWheel(int screenX, int screenY, int delta) {
      foreach (PreviewForm form in forms.Values) {
        if (!form.IsDisposed && form.Visible && form.Bounds.Contains(screenX, screenY)) {
          form.BeginInvoke(new Action(delegate() {
            if (!form.IsDisposed) {
              form.RelayWheelAtScreenPoint(screenX, screenY, delta);
            }
          }));
          return true;
        }
      }
      return false;
    }

    private void MaintainPreviews() {
      foreach (PreviewForm form in forms.Values) {
        IntPtr source = form.SourceHwnd;
        if (source == IntPtr.Zero) {
          form.RetryPendingPreview();
          continue;
        }
        long sourceValue = source.ToInt64();
        if (NativePointerRelay.IsValidWindow(source)) {
          reportedClosedSources.Remove(sourceValue);
          form.MaintainSourceRendering();
          form.RetryPendingPreview();
          continue;
        }
        if (reportedClosedSources.Add(sourceValue)) {
          Console.Out.WriteLine("{\"event\":\"window-closed\",\"hwnd\":\"0x" + sourceValue.ToString("X") + "\"}");
          Console.Out.Flush();
        }
        form.RemoveClosedSource();
      }
    }

    private void ClearForms(bool dispose) {
      foreach (PreviewForm form in forms.Values) {
        if (dispose) {
          form.Dispose();
        } else {
          form.HidePreview();
        }
      }
      if (dispose) {
        forms.Clear();
      }
    }

    private static IntPtr ParseHwnd(string value) {
      if (String.IsNullOrWhiteSpace(value)) {
        return IntPtr.Zero;
      }
      string trimmed = value.Trim();
      if (trimmed.StartsWith("0x", StringComparison.OrdinalIgnoreCase)) {
        return new IntPtr(Convert.ToInt64(trimmed.Substring(2), 16));
      }
      return new IntPtr(Convert.ToInt64(trimmed));
    }
  }

  public static class Host {
    [DllImport("user32.dll")]
    private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr dpiContext);

    public static void Run() {
      JavaScriptSerializer serializer = new JavaScriptSerializer();
      ManualResetEventSlim ready = new ManualResetEventSlim(false);
      PreviewContext context = null;

      Thread uiThread = new Thread(delegate() {
        try {
          SetThreadDpiAwarenessContext(new IntPtr(-4));
        } catch {
          // Per-monitor V2 is best-effort on older Windows builds.
        }
        Application.EnableVisualStyles();
        context = new PreviewContext();
        ready.Set();
        Application.Run(context);
      });
      uiThread.IsBackground = false;
      uiThread.SetApartmentState(ApartmentState.STA);
      uiThread.Start();
      ready.Wait();

      string line;
      while ((line = Console.ReadLine()) != null) {
        line = line.TrimStart('\uFEFF');
        if (String.IsNullOrWhiteSpace(line)) {
          continue;
        }
        try {
          PreviewCommand command = serializer.Deserialize<PreviewCommand>(line);
          context.PostCommand(command);
        } catch (Exception error) {
          Console.Error.WriteLine(error.Message);
        }
      }

      context.Post(delegate() { context.HandleCommand(new PreviewCommand { action = "exit" }); });
      uiThread.Join();
    }
  }
}
"@

[InfiniteDeskPreview.Host]::Run()
