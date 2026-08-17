param(
  [ValidateSet('Debug', 'Release')]
  [string]$Configuration = 'Debug'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Administrator privileges are required.'
}

Get-Process InfiniteDeskVirtualDisplayHost -ErrorAction SilentlyContinue | Stop-Process

$matchingDrivers = @(Get-WindowsDriver -Online -All | Where-Object {
  $_.OriginalFileName -like '*InfiniteDeskVirtualDisplayDriver.inf'
})
foreach ($driver in $matchingDrivers) {
  & pnputil.exe /delete-driver $driver.Driver /uninstall /force
  if ($LASTEXITCODE -ne 0) {
    throw "PnPUtil could not remove $($driver.Driver)."
  }
}

$certificate = Join-Path $PSScriptRoot "x64\$Configuration\InfiniteDeskVirtualDisplayDriver.cer"
if (Test-Path -LiteralPath $certificate) {
  $thumbprint = (New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($certificate)).Thumbprint
  foreach ($storePath in @('Cert:\LocalMachine\Root', 'Cert:\LocalMachine\TrustedPublisher')) {
    Get-ChildItem -LiteralPath $storePath | Where-Object Thumbprint -eq $thumbprint | Remove-Item
  }
}

Write-Output 'InfiniteDesk virtual display test driver and certificate were removed.'
Write-Output 'To leave Windows test mode, run set-test-signing.ps1 -Mode Disable as administrator and restart.'
