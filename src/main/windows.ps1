param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("scan", "restore", "focus", "move", "command")]
  [string]$Action,

  [string]$PayloadPath,

  [string]$Hwnd,

  [ValidateSet("focus", "minimize", "maximize", "restore", "close")]
  [string]$WindowCommand,

  [int]$X,

  [int]$Y,

  [int]$Width,

  [int]$Height
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
  public static extern bool IsWindow(IntPtr hWnd);

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

function Convert-StringToHwnd {
  param([string]$Handle)
  if ($Handle.StartsWith("0x")) {
    return [IntPtr]([Convert]::ToInt64($Handle.Substring(2), 16))
  }
  return [IntPtr]([Convert]::ToInt64($Handle, 10))
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

if ([string]::IsNullOrWhiteSpace($PayloadPath) -or -not (Test-Path $PayloadPath)) {
  throw "PayloadPath is required for restore."
}

$payload = Get-Content $PayloadPath -Raw | ConvertFrom-Json
Restore-Windows $payload.windows | ConvertTo-Json -Depth 8 -Compress
