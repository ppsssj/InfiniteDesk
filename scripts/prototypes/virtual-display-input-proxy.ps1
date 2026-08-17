param(
  [string]$TargetHwnd = '',
  [string]$ProcessName = '',
  [int]$ViewerScreenIndex = -1,
  [switch]$ListWindows
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Get-VisibleProcessWindows {
  Get-Process |
    Where-Object { $_.MainWindowHandle -ne 0 -and -not [string]::IsNullOrWhiteSpace($_.MainWindowTitle) } |
    Sort-Object ProcessName, MainWindowTitle |
    Select-Object @{ Name = 'Hwnd'; Expression = { ('0x{0:X}' -f $_.MainWindowHandle.ToInt64()) } }, ProcessName, MainWindowTitle
}

if ($ListWindows -or ([string]::IsNullOrWhiteSpace($TargetHwnd) -and [string]::IsNullOrWhiteSpace($ProcessName))) {
  Get-VisibleProcessWindows | Format-Table -AutoSize
  if (-not $ListWindows) {
    Write-Output ''
    Write-Output 'Run again with -TargetHwnd 0x123456 or -ProcessName chrome.'
  }
  exit 0
}

if (-not [string]::IsNullOrWhiteSpace($TargetHwnd)) {
  $normalizedHwnd = $TargetHwnd.Trim()
  $targetValue = if ($normalizedHwnd.StartsWith('0x', [System.StringComparison]::OrdinalIgnoreCase)) {
    [Convert]::ToInt64($normalizedHwnd.Substring(2), 16)
  } else {
    [Convert]::ToInt64($normalizedHwnd, 10)
  }
} else {
  $matches = @(Get-VisibleProcessWindows | Where-Object ProcessName -ieq $ProcessName)
  if ($matches.Count -eq 0) {
    throw "No visible top-level window was found for process '$ProcessName'."
  }
  if ($matches.Count -gt 1) {
    $matches | Format-Table -AutoSize
    throw "More than one '$ProcessName' window is visible. Re-run with -TargetHwnd."
  }
  $targetValue = [Convert]::ToInt64($matches[0].Hwnd.Substring(2), 16)
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$nativeSource = @'
using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public static class VirtualDisplayInputProxy
{
    [StructLayout(LayoutKind.Sequential)]
    private struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;

        public int Width { get { return Math.Max(1, Right - Left); } }
        public int Height { get { return Math.Max(1, Bottom - Top); } }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PSIZE
    {
        public int x;
        public int y;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct DWM_THUMBNAIL_PROPERTIES
    {
        public uint dwFlags;
        public RECT rcDestination;
        public RECT rcSource;
        public byte opacity;
        [MarshalAs(UnmanagedType.Bool)] public bool fVisible;
        [MarshalAs(UnmanagedType.Bool)] public bool fSourceClientAreaOnly;
    }

    private const uint DWM_TNP_RECTDESTINATION = 0x00000001;
    private const uint DWM_TNP_RECTSOURCE = 0x00000002;
    private const uint DWM_TNP_OPACITY = 0x00000004;
    private const uint DWM_TNP_VISIBLE = 0x00000008;
    private const uint DWM_TNP_SOURCECLIENTAREAONLY = 0x00000010;
    private const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;
    private const int SW_SHOW = 5;
    [DllImport("user32.dll")]
    private static extern bool IsWindow(IntPtr hwnd);

    [DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr hwnd);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hwnd);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hwnd, int command);

    [DllImport("user32.dll")]
    private static extern bool SetCursorPos(int x, int y);

    [DllImport("user32.dll")]
    private static extern bool GetCursorPos(out Point point);

    [DllImport("user32.dll")]
    private static extern bool ClipCursor(ref RECT rect);

    [DllImport("user32.dll")]
    private static extern bool ClipCursor(IntPtr rect);

    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int virtualKey);

    [DllImport("user32.dll")]
    private static extern bool SetProcessDPIAware();

    [DllImport("user32.dll")]
    private static extern bool SetProcessDpiAwarenessContext(IntPtr value);

    [DllImport("dwmapi.dll")]
    private static extern int DwmRegisterThumbnail(IntPtr destination, IntPtr source, out IntPtr thumbnail);

    [DllImport("dwmapi.dll")]
    private static extern int DwmUnregisterThumbnail(IntPtr thumbnail);

    [DllImport("dwmapi.dll")]
    private static extern int DwmUpdateThumbnailProperties(IntPtr thumbnail, ref DWM_THUMBNAIL_PROPERTIES properties);

    [DllImport("dwmapi.dll")]
    private static extern int DwmQueryThumbnailSourceSize(IntPtr thumbnail, out PSIZE size);

    [DllImport("dwmapi.dll")]
    private static extern int DwmFlush();

    [DllImport("dwmapi.dll")]
    private static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out RECT value, int size);

    public static void Run(long targetHwnd, int viewerScreenIndex)
    {
        try
        {
            SetProcessDpiAwarenessContext(new IntPtr(-4));
        }
        catch
        {
            SetProcessDPIAware();
        }

        IntPtr target = new IntPtr(targetHwnd);
        if (!IsWindow(target))
        {
            throw new InvalidOperationException("The target HWND is no longer valid.");
        }
        if (IsIconic(target))
        {
            throw new InvalidOperationException("Restore the target window before starting the proxy.");
        }
        if (Screen.AllScreens.Length < 2)
        {
            throw new InvalidOperationException("This driver-free spike requires two active monitors.");
        }

        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        using (ProxyForm form = new ProxyForm(target, viewerScreenIndex))
        {
            Application.Run(form);
        }
    }

    private sealed class ProxyForm : Form
    {
        private readonly IntPtr _target;
        private readonly Timer _timer;
        private readonly SoftwareCursorForm _softwareCursor;
        private IntPtr _thumbnail = IntPtr.Zero;
        private Rectangle _previewRect;
        private RECT _targetRect;
        private Point _savedCursor;
        private bool _redirecting;
        private bool _restoreChordDown;
        private bool _closeChordDown;
        private int _lastPreviewError = int.MinValue;
        private string _status = "Point inside the preview and press F8 to redirect real input.";

        public ProxyForm(IntPtr target, int viewerScreenIndex)
        {
            _target = target;
            Text = "InfiniteDesk virtual-display input spike";
            StartPosition = FormStartPosition.Manual;
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            MinimizeBox = false;
            KeyPreview = true;
            TopMost = true;
            BackColor = Color.FromArgb(245, 247, 250);
            ForeColor = Color.FromArgb(22, 30, 42);
            Font = new Font("Segoe UI", 10.0f, FontStyle.Regular, GraphicsUnit.Point);

            Screen targetScreen = Screen.FromHandle(_target);
            Screen viewerScreen = ResolveViewerScreen(targetScreen, viewerScreenIndex);
            Rectangle area = viewerScreen.WorkingArea;
            int width = Math.Min(1100, Math.Max(720, area.Width - 120));
            int height = Math.Min(720, Math.Max(480, area.Height - 120));
            Bounds = new Rectangle(
                area.Left + Math.Max(20, (area.Width - width) / 2),
                area.Top + Math.Max(20, (area.Height - height) / 2),
                width,
                height
            );

            _softwareCursor = new SoftwareCursorForm();
            _timer = new Timer();
            _timer.Interval = 16;
            _timer.Tick += delegate { TickProxy(); };
        }

        private static Screen ResolveViewerScreen(Screen targetScreen, int viewerScreenIndex)
        {
            if (viewerScreenIndex >= 0)
            {
                if (viewerScreenIndex >= Screen.AllScreens.Length)
                {
                    throw new ArgumentOutOfRangeException("viewerScreenIndex");
                }
                return Screen.AllScreens[viewerScreenIndex];
            }

            foreach (Screen screen in Screen.AllScreens)
            {
                if (!screen.DeviceName.Equals(targetScreen.DeviceName, StringComparison.OrdinalIgnoreCase))
                {
                    return screen;
                }
            }
            throw new InvalidOperationException("Could not find a viewer monitor distinct from the target monitor.");
        }

        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            int registerResult = DwmRegisterThumbnail(Handle, _target, out _thumbnail);
            if (registerResult != 0 || _thumbnail == IntPtr.Zero)
            {
                _thumbnail = IntPtr.Zero;
                _lastPreviewError = registerResult != 0 ? registerResult : unchecked((int)0x80004005);
                _status = String.Format("DWM register thumbnail failed: 0x{0:X8}", _lastPreviewError);
                Invalidate();
                _timer.Start();
                Activate();
                return;
            }

            UpdatePreview();
            DwmFlush();
            _timer.Start();
            BeginInvoke(new Action(delegate
            {
                ShowWindow(Handle, SW_SHOW);
                Activate();
            }));
        }

        protected override void OnKeyDown(KeyEventArgs e)
        {
            if (e.KeyCode == Keys.F8 && !e.Control && !e.Alt && !e.Shift)
            {
                EnterRedirectMode();
                e.Handled = true;
                e.SuppressKeyPress = true;
                return;
            }
            base.OnKeyDown(e);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            using (Brush titleBrush = new SolidBrush(Color.FromArgb(22, 30, 42)))
            using (Brush statusBrush = new SolidBrush(_redirecting ? Color.FromArgb(180, 83, 9) : Color.FromArgb(71, 85, 105)))
            using (Pen borderPen = new Pen(_redirecting ? Color.FromArgb(245, 158, 11) : Color.FromArgb(59, 130, 246), 2.0f))
            {
                e.Graphics.DrawString("F8: enter input mode   Ctrl+Alt+F10: restore cursor   Ctrl+Alt+F12: close safely", Font, titleBrush, 14, 10);
                e.Graphics.DrawString(_status, Font, statusBrush, 14, 32);
                e.Graphics.DrawRectangle(borderPen, _previewRect);
            }
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            ExitRedirectMode("Closing.");
            _timer.Stop();
            if (_thumbnail != IntPtr.Zero)
            {
                DwmUnregisterThumbnail(_thumbnail);
                _thumbnail = IntPtr.Zero;
            }
            _softwareCursor.Close();
            base.OnFormClosing(e);
        }

        private void TickProxy()
        {
            bool controlAlt = IsKeyDown(Keys.ControlKey) && IsKeyDown(Keys.Menu);
            bool restoreChordDown = controlAlt && IsKeyDown(Keys.F10);
            bool closeChordDown = controlAlt && IsKeyDown(Keys.F12);
            if (closeChordDown && !_closeChordDown)
            {
                _closeChordDown = true;
                Close();
                return;
            }
            if (restoreChordDown && !_restoreChordDown)
            {
                ExitRedirectMode("Input returned to the physical viewer monitor.");
            }
            _restoreChordDown = restoreChordDown;
            _closeChordDown = closeChordDown;

            if (!IsWindow(_target))
            {
                ExitRedirectMode("The target window closed.");
                Close();
                return;
            }

            UpdatePreview();
            if (_redirecting)
            {
                UpdateSoftwareCursor();
            }
        }

        private static bool IsKeyDown(Keys key)
        {
            return (GetAsyncKeyState((int)key) & 0x8000) != 0;
        }

        private void UpdatePreview()
        {
            if (_thumbnail == IntPtr.Zero)
            {
                return;
            }

            PSIZE sourceSize;
            int queryResult = DwmQueryThumbnailSourceSize(_thumbnail, out sourceSize);
            if (queryResult != 0 || sourceSize.x <= 0 || sourceSize.y <= 0)
            {
                SetPreviewError(queryResult != 0 ? queryResult : unchecked((int)0x80004005), "query source size");
                return;
            }

            Rectangle available = new Rectangle(14, 62, Math.Max(1, ClientSize.Width - 28), Math.Max(1, ClientSize.Height - 76));
            double scale = Math.Min((double)available.Width / sourceSize.x, (double)available.Height / sourceSize.y);
            int width = Math.Max(1, (int)Math.Round(sourceSize.x * scale));
            int height = Math.Max(1, (int)Math.Round(sourceSize.y * scale));
            _previewRect = new Rectangle(
                available.Left + (available.Width - width) / 2,
                available.Top + (available.Height - height) / 2,
                width,
                height
            );

            DWM_THUMBNAIL_PROPERTIES properties = new DWM_THUMBNAIL_PROPERTIES();
            properties.dwFlags = DWM_TNP_RECTDESTINATION | DWM_TNP_RECTSOURCE |
                DWM_TNP_OPACITY | DWM_TNP_VISIBLE | DWM_TNP_SOURCECLIENTAREAONLY;
            properties.rcDestination = new RECT
            {
                Left = _previewRect.Left,
                Top = _previewRect.Top,
                Right = _previewRect.Right,
                Bottom = _previewRect.Bottom
            };
            properties.rcSource = new RECT
            {
                Left = 0,
                Top = 0,
                Right = sourceSize.x,
                Bottom = sourceSize.y
            };
            properties.opacity = 255;
            properties.fVisible = true;
            properties.fSourceClientAreaOnly = false;
            int updateResult = DwmUpdateThumbnailProperties(_thumbnail, ref properties);
            if (updateResult != 0)
            {
                SetPreviewError(updateResult, "update thumbnail");
                return;
            }
            if (_lastPreviewError != 0)
            {
                _lastPreviewError = 0;
                _status = "Preview ready. Point inside it and press F8 to redirect real input.";
                Invalidate(new Rectangle(0, 0, ClientSize.Width, 60));
            }
            DwmFlush();

            RECT targetRect;
            if (DwmGetWindowAttribute(_target, DWMWA_EXTENDED_FRAME_BOUNDS, out targetRect, Marshal.SizeOf(typeof(RECT))) == 0)
            {
                _targetRect = targetRect;
            }
        }

        private void SetPreviewError(int result, string operation)
        {
            if (_lastPreviewError == result)
            {
                return;
            }
            _lastPreviewError = result;
            _status = String.Format("DWM {0} failed: 0x{1:X8}", operation, result);
            Invalidate(new Rectangle(0, 0, ClientSize.Width, 60));
        }

        private void EnterRedirectMode()
        {
            if (_redirecting || _previewRect.Width <= 1 || _targetRect.Width <= 1)
            {
                return;
            }

            Point pointer;
            if (!GetCursorPos(out pointer))
            {
                _status = "Could not read the cursor position.";
                Invalidate();
                return;
            }

            Point previewOrigin = PointToScreen(_previewRect.Location);
            Rectangle previewScreenRect = new Rectangle(previewOrigin, _previewRect.Size);
            if (!previewScreenRect.Contains(pointer))
            {
                _status = "Move the cursor inside the mirrored image before pressing F8.";
                Invalidate();
                return;
            }

            _savedCursor = pointer;
            double normalizedX = (double)(pointer.X - previewScreenRect.Left) / previewScreenRect.Width;
            double normalizedY = (double)(pointer.Y - previewScreenRect.Top) / previewScreenRect.Height;
            int targetX = _targetRect.Left + (int)Math.Round(normalizedX * (_targetRect.Width - 1));
            int targetY = _targetRect.Top + (int)Math.Round(normalizedY * (_targetRect.Height - 1));

            SetForegroundWindow(_target);
            SetCursorPos(targetX, targetY);
            ClipCursor(ref _targetRect);
            _redirecting = true;
            _status = "LIVE INPUT: use the mouse/keyboard normally. Press Ctrl+Alt+F10 to return.";
            _softwareCursor.ShowInactive();
            UpdateSoftwareCursor();
            Invalidate();
        }

        private void ExitRedirectMode(string status)
        {
            ClipCursor(IntPtr.Zero);
            if (_redirecting)
            {
                SetCursorPos(_savedCursor.X, _savedCursor.Y);
            }
            _redirecting = false;
            _softwareCursor.Hide();
            _status = status;
            Invalidate();
        }

        private void UpdateSoftwareCursor()
        {
            Point actual;
            if (!GetCursorPos(out actual) || _targetRect.Width <= 1 || _targetRect.Height <= 1)
            {
                return;
            }

            double normalizedX = Math.Max(0, Math.Min(1, (double)(actual.X - _targetRect.Left) / _targetRect.Width));
            double normalizedY = Math.Max(0, Math.Min(1, (double)(actual.Y - _targetRect.Top) / _targetRect.Height));
            Point previewOrigin = PointToScreen(_previewRect.Location);
            int displayX = previewOrigin.X + (int)Math.Round(normalizedX * _previewRect.Width);
            int displayY = previewOrigin.Y + (int)Math.Round(normalizedY * _previewRect.Height);
            _softwareCursor.MoveCenter(displayX, displayY);
        }
    }

    private sealed class SoftwareCursorForm : Form
    {
        public SoftwareCursorForm()
        {
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            TopMost = true;
            BackColor = Color.Magenta;
            TransparencyKey = Color.Magenta;
            Size = new Size(22, 22);
        }

        protected override bool ShowWithoutActivation { get { return true; } }

        protected override CreateParams CreateParams
        {
            get
            {
                const int WS_EX_TRANSPARENT = 0x20;
                const int WS_EX_TOOLWINDOW = 0x80;
                const int WS_EX_NOACTIVATE = 0x08000000;
                CreateParams value = base.CreateParams;
                value.ExStyle |= WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE;
                return value;
            }
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
            using (Brush fill = new SolidBrush(Color.FromArgb(245, 158, 11)))
            using (Pen outline = new Pen(Color.White, 2.0f))
            {
                e.Graphics.FillEllipse(fill, 3, 3, 14, 14);
                e.Graphics.DrawEllipse(outline, 3, 3, 14, 14);
                e.Graphics.DrawLine(outline, 10, 0, 10, 20);
                e.Graphics.DrawLine(outline, 0, 10, 20, 10);
            }
        }

        public void ShowInactive()
        {
            if (!Visible)
            {
                Show();
            }
        }

        public void MoveCenter(int x, int y)
        {
            Location = new Point(x - Width / 2, y - Height / 2);
        }
    }
}
'@

$compilerReferences = @(
  [System.Windows.Forms.Form].Assembly.Location,
  [System.Drawing.Point].Assembly.Location
)
Add-Type -TypeDefinition $nativeSource -Language CSharp -ReferencedAssemblies $compilerReferences

Write-Output ('Target HWND: 0x{0:X}' -f $targetValue)
Write-Output 'F8 enters redirected input; Ctrl+Alt+F10 restores the cursor; Ctrl+Alt+F12 closes the spike.'
[VirtualDisplayInputProxy]::Run($targetValue, $ViewerScreenIndex)
