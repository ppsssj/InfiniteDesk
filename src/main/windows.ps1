param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("scan", "restore", "focus", "move", "command", "embed", "detach", "moveEmbedded")]
  [string]$Action,

  [string]$PayloadPath,

  [string]$Hwnd,

  [string]$HostHwnd,

  [ValidateSet("focus", "minimize", "maximize", "restore", "close")]
  [string]$WindowCommand,

  [string]$OriginalParentHwnd,

  [string]$OriginalStyle,

  [string]$OriginalExStyle,

  [int]$X,

  [int]$Y,

  [int]$Width,

  [int]$Height,

  [int]$OriginalX,

  [int]$OriginalY,

  [int]$OriginalWidth,

  [int]$OriginalHeight
)

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
}
"@

function Convert-HwndToString {
  param([IntPtr]$Handle)
  return "0x$($Handle.ToInt64().ToString('X'))"
}

function Convert-Int64ToHwndString {
  param([Int64]$Handle)
  return "0x$($Handle.ToString('X'))"
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
  $ignoredProcesses = @("TextInputHost")

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

    $rect = New-Object WinApi+RECT
    if (-not [WinApi]::GetWindowRect($hWnd, [ref]$rect)) {
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

    $isMinimized = [WinApi]::IsIconic($hWnd)
    $rawX = $rect.Left
    $rawY = $rect.Top
    $width = $rect.Right - $rect.Left
    $height = $rect.Bottom - $rect.Top
    if ($width -le 0 -or $height -le 0) {
      return $true
    }

    $hasInvalidMinimizedBounds = $isMinimized -and ($rawX -le -30000 -or $rawY -le -30000)
    $isInternal = $processName -eq "electron" -and $title -like "*InfiniteDesk*"
    $isTinyHelper = -not $isMinimized -and -not $isInternal -and ($width -lt 200 -or $height -lt 100)
    $isRestorable = -not $hasInvalidMinimizedBounds -and -not $isInternal
    $statusReason = "Ready"

    if ($isInternal) {
      $statusReason = "Internal app"
    } elseif ($hasInvalidMinimizedBounds) {
      $statusReason = "Minimized / position unavailable"
    } elseif ($isMinimized) {
      $statusReason = "Minimized"
    } elseif ($isTinyHelper) {
      $statusReason = "Tiny helper window"
    }

    $windows.Add([pscustomobject]@{
      hwnd = Convert-HwndToString $hWnd
      title = $title
      processName = $processName
      x = if ($hasInvalidMinimizedBounds) { $null } else { $rawX }
      y = if ($hasInvalidMinimizedBounds) { $null } else { $rawY }
      width = if ($hasInvalidMinimizedBounds) { $null } else { $width }
      height = if ($hasInvalidMinimizedBounds) { $null } else { $height }
      isMinimized = $isMinimized
      isRestorable = $isRestorable
      isInternal = $isInternal
      isIgnored = $isTinyHelper
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

if ($Action -eq "scan") {
  Get-OpenWindows | ConvertTo-Json -Depth 5 -Compress
  exit 0
}

if ($Action -eq "focus") {
  Focus-Window $Hwnd | ConvertTo-Json -Depth 5 -Compress
  exit 0
}

if ($Action -eq "move") {
  Move-SingleWindow $Hwnd $X $Y $Width $Height | ConvertTo-Json -Depth 5 -Compress
  exit 0
}

if ($Action -eq "command") {
  Invoke-WindowCommand $Hwnd $WindowCommand | ConvertTo-Json -Depth 5 -Compress
  exit 0
}

if ($Action -eq "embed") {
  Embed-Window $Hwnd $HostHwnd $X $Y $Width $Height | ConvertTo-Json -Depth 8 -Compress
  exit 0
}

if ($Action -eq "detach") {
  Detach-EmbeddedWindow $Hwnd $OriginalParentHwnd $OriginalStyle $OriginalExStyle $OriginalX $OriginalY $OriginalWidth $OriginalHeight | ConvertTo-Json -Depth 8 -Compress
  exit 0
}

if ($Action -eq "moveEmbedded") {
  Move-EmbeddedWindow $Hwnd $X $Y $Width $Height | ConvertTo-Json -Depth 5 -Compress
  exit 0
}

if ([string]::IsNullOrWhiteSpace($PayloadPath) -or -not (Test-Path $PayloadPath)) {
  throw "PayloadPath is required for restore."
}

$payload = Get-Content $PayloadPath -Raw | ConvertFrom-Json
Restore-Windows $payload.windows | ConvertTo-Json -Depth 8 -Compress
