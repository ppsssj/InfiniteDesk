# Persistent Win32 window-control host.
#
# Unlike dwm-preview-host.ps1, this script does NOT spin up a WinForms/STA
# message-pump thread. Every action here is a synchronous P/Invoke call
# (SetForegroundWindow, MoveWindow, SetWindowPos, ...) which does not require
# a message pump in the calling thread -- a pump is only needed there because
# that host renders WinForms thumbnail windows. Do not "fix" this file to look
# like dwm-preview-host.ps1; the two hosts intentionally use different
# threading models for different reasons.
#
# Protocol: NDJSON both directions over stdin/stdout.
#   Node -> PS:  {"id":"42","action":"focus","params":{"hwnd":"0x..."}}
#   PS -> Node:  {"id":"42","ok":true,"result":{...},"error":null}

$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

Add-Type @"
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

public class WinApi {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

  [DllImport("user32.dll")]
  public static extern int GetWindowTextLength(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern int GetClassName(IntPtr hWnd, StringBuilder className, int maxCount);

  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

  [DllImport("user32.dll")]
  public static extern bool GetWindowPlacement(IntPtr hWnd, ref WINDOWPLACEMENT placement);

  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool SetWindowPlacement(IntPtr hWnd, ref WINDOWPLACEMENT placement);

  [DllImport("user32.dll")]
  public static extern IntPtr MonitorFromWindow(IntPtr hWnd, uint dwFlags);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO monitorInfo);

  [DllImport("user32.dll")]
  public static extern int GetSystemMetrics(int nIndex);

  [DllImport("dwmapi.dll")]
  public static extern int DwmGetWindowAttribute(IntPtr hWnd, int dwAttribute, out RECT pvAttribute, int cbAttribute);

  [DllImport("user32.dll")]
  public static extern bool IsIconic(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

  [DllImport("user32.dll")]
  public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);

  [DllImport("user32.dll")]
  public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

  [DllImport("user32.dll")]
  public static extern bool IsWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern IntPtr GetParent(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern IntPtr SetParent(IntPtr hWndChild, IntPtr hWndNewParent);

  [DllImport("user32.dll", EntryPoint="GetWindowLong")]
  private static extern int GetWindowLong32(IntPtr hWnd, int nIndex);

  [DllImport("user32.dll", EntryPoint="GetWindowLongPtr")]
  private static extern IntPtr GetWindowLongPtr64(IntPtr hWnd, int nIndex);

  [DllImport("user32.dll", EntryPoint="SetWindowLong")]
  private static extern int SetWindowLong32(IntPtr hWnd, int nIndex, int dwNewLong);

  [DllImport("user32.dll", EntryPoint="SetWindowLongPtr")]
  private static extern IntPtr SetWindowLongPtr64(IntPtr hWnd, int nIndex, IntPtr dwNewLong);

  public static IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex) {
    if (IntPtr.Size == 8) {
      return GetWindowLongPtr64(hWnd, nIndex);
    }
    return new IntPtr(GetWindowLong32(hWnd, nIndex));
  }

  public static IntPtr SetWindowLongPtr(IntPtr hWnd, int nIndex, IntPtr dwNewLong) {
    if (IntPtr.Size == 8) {
      return SetWindowLongPtr64(hWnd, nIndex, dwNewLong);
    }
    return new IntPtr(SetWindowLong32(hWnd, nIndex, dwNewLong.ToInt32()));
  }

  [DllImport("user32.dll")]
  public static extern bool BringWindowToTop(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll")]
  public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct POINT {
    public int X;
    public int Y;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct WINDOWPLACEMENT {
    public int length;
    public int flags;
    public int showCmd;
    public POINT ptMinPosition;
    public POINT ptMaxPosition;
    public RECT rcNormalPosition;
  }

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct MONITORINFO {
    public int cbSize;
    public RECT rcMonitor;
    public RECT rcWork;
    public uint dwFlags;
  }
}
"@

function Convert-HwndToString {
  param([IntPtr]$Handle)
  return "0x$($Handle.ToInt64().ToString('X'))"
}

function Convert-StringToHwnd {
  param([string]$Handle)
  if ($Handle.StartsWith("0x")) {
    return [IntPtr]([Convert]::ToInt64($Handle.Substring(2), 16))
  }
  return [IntPtr]([Convert]::ToInt64($Handle, 10))
}

function Convert-StringToInt64 {
  param([string]$Value)
  if ([string]::IsNullOrWhiteSpace($Value)) {
    return [Int64]0
  }
  if ($Value.StartsWith("0x")) {
    return [Convert]::ToInt64($Value.Substring(2), 16)
  }
  return [Convert]::ToInt64($Value, 10)
}

function Get-VisibleWindowRect {
  param([IntPtr]$Handle)

  $DWMWA_EXTENDED_FRAME_BOUNDS = 9
  $dwmRect = New-Object WinApi+RECT
  $dwmResult = [WinApi]::DwmGetWindowAttribute($Handle, $DWMWA_EXTENDED_FRAME_BOUNDS, [ref]$dwmRect, 16)
  $dwmWidth = $dwmRect.Right - $dwmRect.Left
  $dwmHeight = $dwmRect.Bottom - $dwmRect.Top
  if ($dwmResult -eq 0 -and $dwmWidth -gt 0 -and $dwmHeight -gt 0) {
    return $dwmRect
  }

  $rect = New-Object WinApi+RECT
  if ([WinApi]::GetWindowRect($Handle, [ref]$rect)) {
    return $rect
  }

  return $null
}

function Get-RestoreWindowRect {
  param([IntPtr]$Handle)

  $placement = New-Object WinApi+WINDOWPLACEMENT
  $placement.length = [System.Runtime.InteropServices.Marshal]::SizeOf([type][WinApi+WINDOWPLACEMENT])
  if (-not [WinApi]::GetWindowPlacement($Handle, [ref]$placement)) {
    return $null
  }

  $rect = $placement.rcNormalPosition
  $width = $rect.Right - $rect.Left
  $height = $rect.Bottom - $rect.Top
  if ($width -le 0 -or $height -le 0) {
    return $null
  }

  return $rect
}

function Get-MonitorBoundsForWindow {
  param([IntPtr]$Handle)

  $MONITOR_DEFAULTTONEAREST = 2
  $monitor = [WinApi]::MonitorFromWindow($Handle, $MONITOR_DEFAULTTONEAREST)
  if ($monitor -eq [IntPtr]::Zero) {
    return $null
  }

  $monitorInfo = New-Object WinApi+MONITORINFO
  $monitorInfo.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf([type][WinApi+MONITORINFO])
  if (-not [WinApi]::GetMonitorInfo($monitor, [ref]$monitorInfo)) {
    return $null
  }

  return $monitorInfo.rcMonitor
}

function Convert-WindowPlacementToResult {
  param([WinApi+WINDOWPLACEMENT]$Placement)

  return [pscustomobject]@{
    flags = $Placement.flags
    showCmd = $Placement.showCmd
    minX = $Placement.ptMinPosition.X
    minY = $Placement.ptMinPosition.Y
    maxX = $Placement.ptMaxPosition.X
    maxY = $Placement.ptMaxPosition.Y
    normalLeft = $Placement.rcNormalPosition.Left
    normalTop = $Placement.rcNormalPosition.Top
    normalRight = $Placement.rcNormalPosition.Right
    normalBottom = $Placement.rcNormalPosition.Bottom
  }
}

function New-WindowPlacementFromResult {
  param($Placement)

  $result = New-Object WinApi+WINDOWPLACEMENT
  $result.length = [System.Runtime.InteropServices.Marshal]::SizeOf([type][WinApi+WINDOWPLACEMENT])
  $result.flags = [int]$Placement.flags
  $result.showCmd = [int]$Placement.showCmd

  $minPosition = New-Object WinApi+POINT
  $minPosition.X = [int]$Placement.minX
  $minPosition.Y = [int]$Placement.minY
  $result.ptMinPosition = $minPosition

  $maxPosition = New-Object WinApi+POINT
  $maxPosition.X = [int]$Placement.maxX
  $maxPosition.Y = [int]$Placement.maxY
  $result.ptMaxPosition = $maxPosition

  $normalPosition = New-Object WinApi+RECT
  $normalPosition.Left = [int]$Placement.normalLeft
  $normalPosition.Top = [int]$Placement.normalTop
  $normalPosition.Right = [int]$Placement.normalRight
  $normalPosition.Bottom = [int]$Placement.normalBottom
  $result.rcNormalPosition = $normalPosition
  return $result
}

function Move-WindowToVirtualDisplay {
  param(
    [string]$TargetHwnd,
    [int]$DisplayX,
    [int]$DisplayY,
    [int]$DisplayWidth,
    [int]$DisplayHeight
  )

  if ([string]::IsNullOrWhiteSpace($TargetHwnd)) {
    return [pscustomobject]@{ success = $false; hwnd = ""; error = "No HWND was provided." }
  }
  if ($DisplayWidth -le 0 -or $DisplayHeight -le 0) {
    return [pscustomobject]@{ success = $false; hwnd = $TargetHwnd; error = "The virtual display bounds are invalid." }
  }

  $handle = Convert-StringToHwnd $TargetHwnd
  if (-not [WinApi]::IsWindow($handle)) {
    return [pscustomobject]@{ success = $false; hwnd = $TargetHwnd; error = "Window handle is no longer valid." }
  }
  if (Test-IsInfiniteDeskWindow $handle) {
    return [pscustomobject]@{ success = $false; hwnd = $TargetHwnd; error = "InfiniteDesk internal window cannot be moved." }
  }

  $original = New-Object WinApi+WINDOWPLACEMENT
  $original.length = [System.Runtime.InteropServices.Marshal]::SizeOf([type][WinApi+WINDOWPLACEMENT])
  if (-not [WinApi]::GetWindowPlacement($handle, [ref]$original)) {
    return [pscustomobject]@{ success = $false; hwnd = $TargetHwnd; error = "Could not read the original window placement." }
  }

  $sourceMonitor = Get-MonitorBoundsForWindow $handle
  if ($null -eq $sourceMonitor) {
    return [pscustomobject]@{ success = $false; hwnd = $TargetHwnd; error = "Could not resolve the source monitor." }
  }

  $normalWidth = $original.rcNormalPosition.Right - $original.rcNormalPosition.Left
  $normalHeight = $original.rcNormalPosition.Bottom - $original.rcNormalPosition.Top
  if ($normalWidth -le 0 -or $normalHeight -le 0) {
    return [pscustomobject]@{ success = $false; hwnd = $TargetHwnd; error = "The original restore bounds are invalid." }
  }

  $relativeX = $original.rcNormalPosition.Left - $sourceMonitor.Left
  $relativeY = $original.rcNormalPosition.Top - $sourceMonitor.Top
  $targetNormal = New-Object WinApi+RECT
  $targetNormal.Left = $DisplayX + $relativeX
  $targetNormal.Top = $DisplayY + $relativeY
  $targetNormal.Right = $targetNormal.Left + $normalWidth
  $targetNormal.Bottom = $targetNormal.Top + $normalHeight

  $targetPlacement = New-Object WinApi+WINDOWPLACEMENT
  $targetPlacement.length = [System.Runtime.InteropServices.Marshal]::SizeOf([type][WinApi+WINDOWPLACEMENT])
  $targetPlacement.flags = 0
  $targetPlacement.showCmd = 1
  $targetPlacement.ptMinPosition = $original.ptMinPosition
  $targetPlacement.ptMaxPosition = $original.ptMaxPosition
  $targetPlacement.rcNormalPosition = $targetNormal

  [void][WinApi]::ShowWindow($handle, 9)
  if (-not [WinApi]::SetWindowPlacement($handle, [ref]$targetPlacement)) {
    return [pscustomobject]@{ success = $false; hwnd = $TargetHwnd; error = "Could not place the window on the virtual display." }
  }

  if ($original.showCmd -eq 3) {
    [void][WinApi]::ShowWindow($handle, 3)
  } elseif ($original.showCmd -eq 2) {
    [void][WinApi]::ShowWindow($handle, 6)
  } else {
    [void][WinApi]::ShowWindow($handle, 1)
  }

  return [pscustomobject]@{
    success = $true
    hwnd = $TargetHwnd
    originalPlacement = Convert-WindowPlacementToResult $original
    virtualDisplay = [pscustomobject]@{
      x = $DisplayX
      y = $DisplayY
      width = $DisplayWidth
      height = $DisplayHeight
    }
    error = $null
  }
}

function Restore-WindowFromVirtualDisplay {
  param(
    [string]$TargetHwnd,
    $OriginalPlacement
  )

  if ([string]::IsNullOrWhiteSpace($TargetHwnd) -or $null -eq $OriginalPlacement) {
    return [pscustomobject]@{ success = $false; hwnd = $TargetHwnd; error = "The original window placement is unavailable." }
  }

  $handle = Convert-StringToHwnd $TargetHwnd
  if (-not [WinApi]::IsWindow($handle)) {
    return [pscustomobject]@{ success = $true; hwnd = $TargetHwnd; error = $null }
  }

  $placement = New-WindowPlacementFromResult $OriginalPlacement
  $originalShowCommand = $placement.showCmd
  $placement.showCmd = 1
  $placement.flags = 0

  [void][WinApi]::ShowWindow($handle, 9)
  if (-not [WinApi]::SetWindowPlacement($handle, [ref]$placement)) {
    return [pscustomobject]@{ success = $false; hwnd = $TargetHwnd; error = "Could not restore the original window placement." }
  }

  if ($originalShowCommand -eq 3) {
    [void][WinApi]::ShowWindow($handle, 3)
  } elseif ($originalShowCommand -eq 2) {
    [void][WinApi]::ShowWindow($handle, 6)
  } else {
    [void][WinApi]::ShowWindow($handle, 1)
  }

  return [pscustomobject]@{ success = $true; hwnd = $TargetHwnd; error = $null }
}

function Get-VirtualScreenRect {
  $SM_XVIRTUALSCREEN = 76
  $SM_YVIRTUALSCREEN = 77
  $SM_CXVIRTUALSCREEN = 78
  $SM_CYVIRTUALSCREEN = 79
  $left = [WinApi]::GetSystemMetrics($SM_XVIRTUALSCREEN)
  $top = [WinApi]::GetSystemMetrics($SM_YVIRTUALSCREEN)
  $width = [WinApi]::GetSystemMetrics($SM_CXVIRTUALSCREEN)
  $height = [WinApi]::GetSystemMetrics($SM_CYVIRTUALSCREEN)

  return [pscustomobject]@{
    Left = $left
    Top = $top
    Right = $left + $width
    Bottom = $top + $height
  }
}

function Test-RectIntersectsVirtualScreen {
  param(
    [WinApi+RECT]$Rect,
    [object]$VirtualScreen
  )

  return -not (
    $Rect.Right -le $VirtualScreen.Left -or
    $Rect.Left -ge $VirtualScreen.Right -or
    $Rect.Bottom -le $VirtualScreen.Top -or
    $Rect.Top -ge $VirtualScreen.Bottom
  )
}

function Get-WindowTitleByHandle {
  param([IntPtr]$Handle)

  $titleLength = [WinApi]::GetWindowTextLength($Handle)
  if ($titleLength -le 0) {
    return ""
  }

  $titleBuilder = New-Object System.Text.StringBuilder ($titleLength + 1)
  [void][WinApi]::GetWindowText($Handle, $titleBuilder, $titleBuilder.Capacity)
  return $titleBuilder.ToString().Trim()
}

function Get-WindowProcessNameByHandle {
  param([IntPtr]$Handle)

  $processId = 0
  [void][WinApi]::GetWindowThreadProcessId($Handle, [ref]$processId)

  try {
    return [System.Diagnostics.Process]::GetProcessById($processId).ProcessName
  } catch {
    return "unknown"
  }
}

function Test-IsInfiniteDeskWindow {
  param([IntPtr]$Handle)

  $title = Get-WindowTitleByHandle $Handle
  $processName = Get-WindowProcessNameByHandle $Handle
  return $processName -eq "electron" -and $title -like "*InfiniteDesk*"
}

function Get-OpenWindows {
  $windows = New-Object System.Collections.Generic.List[object]
  $ignoredClasses = @("Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd", "Windows.UI.Core.CoreWindow")
  # Transient system surfaces are not useful workspace windows. In particular,
  # the Windows capture overlay can briefly expose a titled top-level window
  # while selecting an area, which otherwise looks like a newly launched app.
  $ignoredProcesses = @(
    "TextInputHost",
    "ScreenClippingHost",
    "SnippingTool"
  )
  $virtualScreen = Get-VirtualScreenRect
  $foregroundWindow = [WinApi]::GetForegroundWindow()

  [WinApi]::EnumWindows({
    param([IntPtr]$hWnd, [IntPtr]$lParam)

    if (-not [WinApi]::IsWindowVisible($hWnd)) {
      return $true
    }

    $titleLength = [WinApi]::GetWindowTextLength($hWnd)
    if ($titleLength -le 0) {
      return $true
    }

    $titleBuilder = New-Object System.Text.StringBuilder ($titleLength + 1)
    [void][WinApi]::GetWindowText($hWnd, $titleBuilder, $titleBuilder.Capacity)
    $title = $titleBuilder.ToString().Trim()
    if ([string]::IsNullOrWhiteSpace($title)) {
      return $true
    }

    $classBuilder = New-Object System.Text.StringBuilder 256
    [void][WinApi]::GetClassName($hWnd, $classBuilder, $classBuilder.Capacity)
    $className = $classBuilder.ToString()
    if ($ignoredClasses -contains $className) {
      return $true
    }

    $isMinimized = [WinApi]::IsIconic($hWnd)
    $rect = if ($isMinimized) { Get-RestoreWindowRect $hWnd } else { Get-VisibleWindowRect $hWnd }
    if ($null -eq $rect) {
      $rect = Get-VisibleWindowRect $hWnd
    }
    if ($null -eq $rect) {
      return $true
    }

    $processId = 0
    [void][WinApi]::GetWindowThreadProcessId($hWnd, [ref]$processId)

    $processName = "unknown"
    try {
      $processName = [System.Diagnostics.Process]::GetProcessById($processId).ProcessName
    } catch {}

    if ($ignoredProcesses -contains $processName) {
      return $true
    }

    $rawX = $rect.Left
    $rawY = $rect.Top
    $width = $rect.Right - $rect.Left
    $height = $rect.Bottom - $rect.Top
    if ($width -le 0 -or $height -le 0) {
      return $true
    }

    $isOutsideVirtualScreen = -not (Test-RectIntersectsVirtualScreen $rect $virtualScreen)
    $hasInvalidMinimizedBounds = $isMinimized -and $isOutsideVirtualScreen
    $isOffscreenHidden = -not $isMinimized -and $isOutsideVirtualScreen
    $isInternal = $processName -eq "electron" -and $title -like "*InfiniteDesk*"
    $hasNoUsefulPreview = -not $isMinimized -and -not $isInternal -and ($width -lt 320 -or $height -lt 180)
    $isRestorable = -not $hasInvalidMinimizedBounds -and -not $isOffscreenHidden -and -not $isInternal
    $statusReason = "Ready"

    if ($isInternal) {
      $statusReason = "Internal app"
    } elseif ($hasInvalidMinimizedBounds) {
      $statusReason = "Minimized / position unavailable"
    } elseif ($isOffscreenHidden) {
      $statusReason = "Offscreen / hidden"
    } elseif ($isMinimized) {
      $statusReason = "Minimized"
    } elseif ($hasNoUsefulPreview) {
      $statusReason = "No useful preview"
    }

    $windows.Add([pscustomobject]@{
      hwnd = Convert-HwndToString $hWnd
      title = $title
      processName = $processName
      x = if ($hasInvalidMinimizedBounds -or $isOffscreenHidden) { $null } else { $rawX }
      y = if ($hasInvalidMinimizedBounds -or $isOffscreenHidden) { $null } else { $rawY }
      width = if ($hasInvalidMinimizedBounds -or $isOffscreenHidden) { $null } else { $width }
      height = if ($hasInvalidMinimizedBounds -or $isOffscreenHidden) { $null } else { $height }
      isMinimized = $isMinimized
      isRestorable = $isRestorable
      isForeground = $hWnd -eq $foregroundWindow
      isInternal = $isInternal
      isIgnored = $hasNoUsefulPreview -or $isOffscreenHidden
      statusReason = $statusReason
    })

    return $true
  }, [IntPtr]::Zero) | Out-Null

  return $windows
}

function Restore-Windows {
  param([object[]]$TargetWindows)

  $openWindows = Get-OpenWindows
  $restored = 0
  $skipped = 0
  $errors = New-Object System.Collections.Generic.List[string]

  foreach ($target in $TargetWindows) {
    $targetRestorable = $true
    if ($null -ne $target.PSObject.Properties["isRestorable"]) {
      $targetRestorable = [bool]$target.isRestorable
    }

    if (-not $targetRestorable -or $null -eq $target.x -or $null -eq $target.y -or $null -eq $target.width -or $null -eq $target.height) {
      $skipped++
      $errors.Add("Skipped $($target.processName): invalid or non-restorable saved bounds.")
      continue
    }

    $match = $openWindows | Where-Object {
      $_.hwnd -eq $target.hwnd -or ($_.processName -eq $target.processName -and $_.title -eq $target.title)
    } | Select-Object -First 1

    if ($null -eq $match) {
      $skipped++
      $errors.Add("Skipped $($target.processName): window was not found.")
      continue
    }

    $handle = Convert-StringToHwnd $match.hwnd
    if ($match.isMinimized) {
      [void][WinApi]::ShowWindow($handle, 9)
    }

    if ([WinApi]::MoveWindow($handle, [int]$target.x, [int]$target.y, [int]$target.width, [int]$target.height, $true)) {
      $restored++
    } else {
      $skipped++
      $errors.Add("Skipped $($target.processName): MoveWindow failed.")
    }
  }

  return [pscustomobject]@{
    restored = $restored
    skipped = $skipped
    errors = $errors
  }
}

function Focus-Window {
  param([string]$TargetHwnd)

  if ([string]::IsNullOrWhiteSpace($TargetHwnd)) {
    return [pscustomobject]@{
      success = $false
      hwnd = ""
      error = "No HWND was provided."
    }
  }

  $handle = Convert-StringToHwnd $TargetHwnd
  if (-not [WinApi]::IsWindow($handle)) {
    return [pscustomobject]@{
      success = $false
      hwnd = $TargetHwnd
      error = "Window handle is no longer valid."
    }
  }

  if ([WinApi]::IsIconic($handle)) {
    [void][WinApi]::ShowWindow($handle, 9)
  }

  $broughtToTop = [WinApi]::BringWindowToTop($handle)
  $foreground = [WinApi]::SetForegroundWindow($handle)

  return [pscustomobject]@{
    success = ($broughtToTop -or $foreground)
    hwnd = $TargetHwnd
    error = if ($broughtToTop -or $foreground) { $null } else { "Windows did not grant foreground focus." }
  }
}

function Move-SingleWindow {
  param(
    [string]$TargetHwnd,
    [int]$TargetX,
    [int]$TargetY,
    [int]$TargetWidth,
    [int]$TargetHeight
  )

  if ([string]::IsNullOrWhiteSpace($TargetHwnd)) {
    return [pscustomobject]@{
      success = $false
      hwnd = ""
      error = "No HWND was provided."
    }
  }

  if ($TargetWidth -le 0 -or $TargetHeight -le 0) {
    return [pscustomobject]@{
      success = $false
      hwnd = $TargetHwnd
      error = "Invalid target bounds."
    }
  }

  $handle = Convert-StringToHwnd $TargetHwnd
  if (-not [WinApi]::IsWindow($handle)) {
    return [pscustomobject]@{
      success = $false
      hwnd = $TargetHwnd
      error = "Window handle is no longer valid."
    }
  }

  if ([WinApi]::IsIconic($handle)) {
    [void][WinApi]::ShowWindow($handle, 9)
  }

  $moved = [WinApi]::MoveWindow($handle, $TargetX, $TargetY, $TargetWidth, $TargetHeight, $true)
  return [pscustomobject]@{
    success = $moved
    hwnd = $TargetHwnd
    error = if ($moved) { $null } else { "MoveWindow failed." }
  }
}

function Embed-Window {
  param(
    [string]$TargetHwnd,
    [string]$TargetHostHwnd,
    [int]$TargetX,
    [int]$TargetY,
    [int]$TargetWidth,
    [int]$TargetHeight
  )

  if ([string]::IsNullOrWhiteSpace($TargetHwnd) -or [string]::IsNullOrWhiteSpace($TargetHostHwnd)) {
    return [pscustomobject]@{
      success = $false
      hwnd = if ($TargetHwnd) { $TargetHwnd } else { "" }
      error = "Target HWND and host HWND are required."
    }
  }

  if ($TargetWidth -le 0 -or $TargetHeight -le 0) {
    return [pscustomobject]@{
      success = $false
      hwnd = $TargetHwnd
      error = "Invalid embed bounds."
    }
  }

  $handle = Convert-StringToHwnd $TargetHwnd
  $hostHandle = Convert-StringToHwnd $TargetHostHwnd

  if (-not [WinApi]::IsWindow($handle)) {
    return [pscustomobject]@{
      success = $false
      hwnd = $TargetHwnd
      error = "Target window handle is no longer valid."
    }
  }

  if (-not [WinApi]::IsWindow($hostHandle)) {
    return [pscustomobject]@{
      success = $false
      hwnd = $TargetHwnd
      error = "Host window handle is not valid."
    }
  }

  if (Test-IsInfiniteDeskWindow $handle) {
    return [pscustomobject]@{
      success = $false
      hwnd = $TargetHwnd
      error = "InfiniteDesk internal window cannot be embedded."
    }
  }

  if ([WinApi]::IsIconic($handle)) {
    return [pscustomobject]@{
      success = $false
      hwnd = $TargetHwnd
      error = "Minimized windows cannot be embedded."
    }
  }

  $rect = New-Object WinApi+RECT
  if (-not [WinApi]::GetWindowRect($handle, [ref]$rect)) {
    return [pscustomobject]@{
      success = $false
      hwnd = $TargetHwnd
      error = "Could not read original window bounds."
    }
  }

  $originalParent = [WinApi]::GetParent($handle)
  $originalStyle = [WinApi]::GetWindowLongPtr($handle, -16).ToInt64()
  $originalExStyle = [WinApi]::GetWindowLongPtr($handle, -20).ToInt64()

  $WS_CHILD = [Int64]0x40000000
  $WS_POPUP = [Int64]0x80000000
  $WS_CAPTION = [Int64]0x00C00000
  $WS_THICKFRAME = [Int64]0x00040000
  $WS_MINIMIZEBOX = [Int64]0x00020000
  $WS_MAXIMIZEBOX = [Int64]0x00010000
  $WS_SYSMENU = [Int64]0x00080000
  $WS_CLIPSIBLINGS = [Int64]0x04000000
  $WS_CLIPCHILDREN = [Int64]0x02000000
  $removeMask = $WS_POPUP -bor $WS_CAPTION -bor $WS_THICKFRAME -bor $WS_MINIMIZEBOX -bor $WS_MAXIMIZEBOX -bor $WS_SYSMENU
  $newStyle = ($originalStyle -band (-bnot $removeMask)) -bor $WS_CHILD -bor $WS_CLIPSIBLINGS -bor $WS_CLIPCHILDREN

  [void][WinApi]::SetParent($handle, $hostHandle)
  [void][WinApi]::SetWindowLongPtr($handle, -16, [IntPtr]$newStyle)

  $SWP_NOZORDER = [uint32]0x0004
  $SWP_FRAMECHANGED = [uint32]0x0020
  $SWP_SHOWWINDOW = [uint32]0x0040
  $positioned = [WinApi]::SetWindowPos($handle, [IntPtr]::Zero, $TargetX, $TargetY, $TargetWidth, $TargetHeight, $SWP_NOZORDER -bor $SWP_FRAMECHANGED -bor $SWP_SHOWWINDOW)

  return [pscustomobject]@{
    success = $positioned
    hwnd = $TargetHwnd
    error = if ($positioned) { $null } else { "SetParent or SetWindowPos failed." }
    originalParentHwnd = Convert-HwndToString $originalParent
    originalStyle = $originalStyle.ToString()
    originalExStyle = $originalExStyle.ToString()
    originalX = $rect.Left
    originalY = $rect.Top
    originalWidth = $rect.Right - $rect.Left
    originalHeight = $rect.Bottom - $rect.Top
  }
}

function Detach-EmbeddedWindow {
  param(
    [string]$TargetHwnd,
    [string]$ParentHwnd,
    [string]$StyleValue,
    [string]$ExStyleValue,
    [int]$TargetX,
    [int]$TargetY,
    [int]$TargetWidth,
    [int]$TargetHeight
  )

  if ([string]::IsNullOrWhiteSpace($TargetHwnd)) {
    return [pscustomobject]@{
      success = $false
      hwnd = ""
      error = "No HWND was provided."
    }
  }

  $handle = Convert-StringToHwnd $TargetHwnd
  if (-not [WinApi]::IsWindow($handle)) {
    return [pscustomobject]@{
      success = $false
      hwnd = $TargetHwnd
      error = "Window handle is no longer valid."
    }
  }

  $parentHandle = if ([string]::IsNullOrWhiteSpace($ParentHwnd)) { [IntPtr]::Zero } else { Convert-StringToHwnd $ParentHwnd }
  $style = Convert-StringToInt64 $StyleValue
  $exStyle = Convert-StringToInt64 $ExStyleValue

  [void][WinApi]::SetParent($handle, $parentHandle)
  [void][WinApi]::SetWindowLongPtr($handle, -16, [IntPtr]$style)
  [void][WinApi]::SetWindowLongPtr($handle, -20, [IntPtr]$exStyle)

  $SWP_NOZORDER = [uint32]0x0004
  $SWP_FRAMECHANGED = [uint32]0x0020
  $SWP_SHOWWINDOW = [uint32]0x0040
  $positioned = [WinApi]::SetWindowPos($handle, [IntPtr]::Zero, $TargetX, $TargetY, $TargetWidth, $TargetHeight, $SWP_NOZORDER -bor $SWP_FRAMECHANGED -bor $SWP_SHOWWINDOW)

  return [pscustomobject]@{
    success = $positioned
    hwnd = $TargetHwnd
    error = if ($positioned) { $null } else { "Could not detach embedded window cleanly." }
  }
}

function Move-EmbeddedWindow {
  param(
    [string]$TargetHwnd,
    [int]$TargetX,
    [int]$TargetY,
    [int]$TargetWidth,
    [int]$TargetHeight
  )

  if ([string]::IsNullOrWhiteSpace($TargetHwnd)) {
    return [pscustomobject]@{
      success = $false
      hwnd = ""
      error = "No HWND was provided."
    }
  }

  $handle = Convert-StringToHwnd $TargetHwnd
  if (-not [WinApi]::IsWindow($handle)) {
    return [pscustomobject]@{
      success = $false
      hwnd = $TargetHwnd
      error = "Window handle is no longer valid."
    }
  }

  $moved = [WinApi]::MoveWindow($handle, $TargetX, $TargetY, $TargetWidth, $TargetHeight, $true)
  return [pscustomobject]@{
    success = $moved
    hwnd = $TargetHwnd
    error = if ($moved) { $null } else { "MoveWindow failed." }
  }
}

function Invoke-WindowCommand {
  param(
    [string]$TargetHwnd,
    [string]$TargetCommand
  )

  if ([string]::IsNullOrWhiteSpace($TargetHwnd)) {
    return [pscustomobject]@{
      success = $false
      hwnd = ""
      command = $TargetCommand
      error = "No HWND was provided."
    }
  }

  if ([string]::IsNullOrWhiteSpace($TargetCommand)) {
    return [pscustomobject]@{
      success = $false
      hwnd = $TargetHwnd
      command = ""
      error = "No window command was provided."
    }
  }

  $handle = Convert-StringToHwnd $TargetHwnd
  if (-not [WinApi]::IsWindow($handle)) {
    return [pscustomobject]@{
      success = $false
      hwnd = $TargetHwnd
      command = $TargetCommand
      error = "Window handle is no longer valid."
    }
  }

  if (Test-IsInfiniteDeskWindow $handle) {
    return [pscustomobject]@{
      success = $false
      hwnd = $TargetHwnd
      command = $TargetCommand
      error = "InfiniteDesk internal window cannot be controlled."
    }
  }

  $success = $false
  $errorMessage = $null

  switch ($TargetCommand) {
    "focus" {
      $focusResult = Focus-Window $TargetHwnd
      $success = [bool]$focusResult.success
      $errorMessage = $focusResult.error
    }
    "minimize" {
      [void][WinApi]::ShowWindow($handle, 6)
      $success = [WinApi]::IsWindow($handle)
      if (-not $success) {
        $errorMessage = "ShowWindow minimize failed."
      }
    }
    "maximize" {
      [void][WinApi]::ShowWindow($handle, 3)
      $success = [WinApi]::IsWindow($handle)
      if (-not $success) {
        $errorMessage = "ShowWindow maximize failed."
      }
    }
    "restore" {
      [void][WinApi]::ShowWindow($handle, 9)
      $success = [WinApi]::IsWindow($handle)
      if (-not $success) {
        $errorMessage = "ShowWindow restore failed."
      }
    }
    "close" {
      $success = [WinApi]::PostMessage($handle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
      if (-not $success) {
        $errorMessage = "WM_CLOSE could not be posted."
      }
    }
    default {
      $success = $false
      $errorMessage = "Unsupported window command."
    }
  }

  return [pscustomobject]@{
    success = $success
    hwnd = $TargetHwnd
    command = $TargetCommand
    error = $errorMessage
  }
}

function Write-Response {
  param(
    [string]$Id,
    $Result,
    [bool]$Ok = $true,
    [string]$ErrorMessage = $null
  )

  $envelope = [pscustomobject]@{
    id = $Id
    ok = $Ok
    result = $Result
    error = $ErrorMessage
  }

  [Console]::Out.WriteLine(($envelope | ConvertTo-Json -Depth 8 -Compress))
  [Console]::Out.Flush()
}

function Invoke-Dispatch {
  param($Message)

  switch ($Message.action) {
    "scan" { return Get-OpenWindows }
    "restore" { return Restore-Windows $Message.params.windows }
    "focus" { return Focus-Window $Message.params.hwnd }
    "move" { return Move-SingleWindow $Message.params.hwnd $Message.params.x $Message.params.y $Message.params.width $Message.params.height }
    "command" { return Invoke-WindowCommand $Message.params.hwnd $Message.params.command }
    "embed" { return Embed-Window $Message.params.hwnd $Message.params.hostHwnd $Message.params.x $Message.params.y $Message.params.width $Message.params.height }
    "detach" { return Detach-EmbeddedWindow $Message.params.hwnd $Message.params.originalParentHwnd $Message.params.originalStyle $Message.params.originalExStyle $Message.params.originalX $Message.params.originalY $Message.params.originalWidth $Message.params.originalHeight }
    "moveEmbedded" { return Move-EmbeddedWindow $Message.params.hwnd $Message.params.x $Message.params.y $Message.params.width $Message.params.height }
    "virtualAttach" { return Move-WindowToVirtualDisplay $Message.params.hwnd $Message.params.displayX $Message.params.displayY $Message.params.displayWidth $Message.params.displayHeight }
    "virtualDetach" { return Restore-WindowFromVirtualDisplay $Message.params.hwnd $Message.params.originalPlacement }
    default { throw "Unsupported action: $($Message.action)" }
  }
}

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) {
    break
  }

  $line = $line.TrimStart([char]0xFEFF)
  if ([string]::IsNullOrWhiteSpace($line)) {
    continue
  }

  $message = $null
  try {
    # PS 5.1's ConvertFrom-Json has no -Depth parameter (unlike ConvertTo-Json).
    # Its default depth already handles this app's payloads; do not add one.
    $message = $line | ConvertFrom-Json
  } catch {
    [Console]::Error.WriteLine("[window-control-host] Failed to parse message: $($_.Exception.Message)")
    continue
  }

  if ($message.action -eq "exit") {
    break
  }

  try {
    $result = Invoke-Dispatch $message
    Write-Response -Id $message.id -Result $result -Ok $true
  } catch {
    # Per-message error isolation: any exception here must not kill the loop,
    # since this process now serves every future window-control command too.
    Write-Response -Id $message.id -Result $null -Ok $false -ErrorMessage $_.Exception.Message
  }
}

exit 0
