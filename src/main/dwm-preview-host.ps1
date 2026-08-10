$ErrorActionPreference = "Stop"

Add-Type -ReferencedAssemblies @(
  "System.Windows.Forms",
  "System.Drawing",
  "System.Web.Extensions"
) -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Threading;
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
    public int wheelDelta { get; set; }
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
    private const uint WM_RBUTTONDOWN = 0x0204;
    private const uint WM_RBUTTONUP = 0x0205;
    private const uint WM_MBUTTONDOWN = 0x0207;
    private const uint WM_MBUTTONUP = 0x0208;
    private const uint WM_MOUSEWHEEL = 0x020A;
    private const int MK_LBUTTON = 0x0001;
    private const int MK_RBUTTON = 0x0002;
    private const int MK_MBUTTON = 0x0010;
    private static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);

    private static readonly Dictionary<long, IntPtr> capturedTargets = new Dictionary<long, IntPtr>();
    private static readonly Dictionary<long, int> capturedButtons = new Dictionary<long, int>();

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
        PostMessage(target, DownMessage(input.button), new IntPtr(buttonMask), pointParam);
        return;
      }

      if (phase == "move") {
        int buttonState = input.buttons > 0 ? DomButtonsToWin32(input.buttons) : GetCapturedButtons(sourceKey);
        PostMessage(target, WM_MOUSEMOVE, new IntPtr(buttonState), pointParam);
        return;
      }

      if (phase == "wheel") {
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

    [DllImport("dwmapi.dll")]
    private static extern int DwmRegisterThumbnail(IntPtr hwndDestination, IntPtr hwndSource, out IntPtr thumbnail);

    [DllImport("dwmapi.dll")]
    private static extern int DwmUnregisterThumbnail(IntPtr thumbnail);

    [DllImport("dwmapi.dll")]
    private static extern int DwmUpdateThumbnailProperties(IntPtr thumbnail, ref DwmThumbnailProperties properties);

    [DllImport("dwmapi.dll")]
    private static extern int DwmQueryThumbnailSourceSize(IntPtr thumbnail, out DwmSize size);

    [DllImport("dwmapi.dll")]
    private static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out Rect bounds, int size);

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr hwnd, out Rect bounds);

    [DllImport("user32.dll", EntryPoint="SetWindowLong")]
    private static extern int SetWindowLong32(IntPtr hWnd, int index, int value);

    [DllImport("user32.dll", EntryPoint="SetWindowLongPtr")]
    private static extern IntPtr SetWindowLongPtr64(IntPtr hWnd, int index, IntPtr value);

    private IntPtr thumbnail = IntPtr.Zero;
    private IntPtr sourceHwnd = IntPtr.Zero;
    private IntPtr ownerHwnd = IntPtr.Zero;
    private RectangleF currentSourceCrop = new RectangleF(0, 0, 1, 1);
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

    public void UpdatePreview(IntPtr nextSourceHwnd, Rectangle bounds, RectangleF sourceCrop, byte nextOpacity) {
      if (bounds.Width <= 1 || bounds.Height <= 1 || nextSourceHwnd == IntPtr.Zero) {
        HidePreview();
        return;
      }

      Bounds = bounds;
      currentSourceCrop = sourceCrop;
      if (!Visible) {
        Show();
      }

      if (thumbnail == IntPtr.Zero || sourceHwnd != nextSourceHwnd) {
        UnregisterThumbnail();
        sourceHwnd = nextSourceHwnd;
        int registerResult = DwmRegisterThumbnail(Handle, sourceHwnd, out thumbnail);
        if (registerResult != 0 || thumbnail == IntPtr.Zero) {
          HidePreview();
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
      DwmUpdateThumbnailProperties(thumbnail, ref properties);
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
        wheelDelta = eventArgs.Delta
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
      windowWatchTimer.Interval = 700;
      windowWatchTimer.Tick += delegate(object sender, EventArgs args) { DetectClosedSources(); };
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
          form.UpdatePreview(sourceHwnd, new Rectangle(item.x, item.y, item.width, item.height), sourceCrop, opacity);
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

    private void DetectClosedSources() {
      foreach (PreviewForm form in forms.Values) {
        IntPtr source = form.SourceHwnd;
        if (source == IntPtr.Zero) {
          continue;
        }
        long sourceValue = source.ToInt64();
        if (NativePointerRelay.IsValidWindow(source)) {
          reportedClosedSources.Remove(sourceValue);
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
    public static void Run() {
      JavaScriptSerializer serializer = new JavaScriptSerializer();
      ManualResetEventSlim ready = new ManualResetEventSlim(false);
      PreviewContext context = null;

      Thread uiThread = new Thread(delegate() {
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
