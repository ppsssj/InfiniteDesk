param(
  [ValidateSet('Enable', 'Disable')]
  [string]$Mode = 'Enable'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Administrator privileges are required.'
}

$value = if ($Mode -eq 'Enable') { 'on' } else { 'off' }
& bcdedit.exe /set testsigning $value
if ($LASTEXITCODE -ne 0) {
  throw "BCDEdit failed with exit code $LASTEXITCODE."
}

Write-Output "Test signing was set to $value. Restart Windows for the change to take effect."
Write-Output "To reverse it later, run this script as administrator with -Mode Disable, then restart."
