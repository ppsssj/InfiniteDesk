param(
  [ValidateSet('Debug', 'Release')]
  [string]$Configuration = 'Release'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$hostPath = Join-Path $PSScriptRoot "x64\$Configuration\InfiniteDeskVirtualDisplayHost.exe"
if (-not (Test-Path -LiteralPath $hostPath)) {
  throw "Virtual display host was not found: $hostPath"
}

Get-Process InfiniteDeskVirtualDisplayHost -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 750

Start-Process -FilePath $hostPath -WorkingDirectory (Split-Path -Parent $hostPath) -WindowStyle Hidden
