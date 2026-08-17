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

$bcdOutput = @(bcdedit.exe /enum '{current}' 2>&1)
if (-not ($bcdOutput -match '^testsigning\s+Yes$')) {
  throw 'Windows test signing is not enabled. Run set-test-signing.ps1 -Mode Enable and restart first.'
}

$outputRoot = Join-Path $PSScriptRoot "x64\$Configuration"
$packageRoot = Join-Path $outputRoot 'InfiniteDeskVirtualDisplayDriver'
$inf = Join-Path $packageRoot 'InfiniteDeskVirtualDisplayDriver.inf'
$catalog = Join-Path $packageRoot 'infinitedeskvirtualdisplaydriver.cat'
$certificate = Join-Path $outputRoot 'InfiniteDeskVirtualDisplayDriver.cer'

foreach ($path in @($inf, $catalog, $certificate)) {
  if (-not (Test-Path -LiteralPath $path)) {
    throw "Required package file is missing: $path"
  }
}

$infText = Get-Content -LiteralPath $inf -Raw
if ($infText -notmatch 'InfiniteDeskVirtualDisplay' -or $infText -match 'IddSampleDriver') {
  throw 'The driver INF does not match the InfiniteDesk prototype hardware ID.'
}

$catalogSignature = Get-AuthenticodeSignature -LiteralPath $catalog
if ($null -eq $catalogSignature.SignerCertificate) {
  throw 'The driver catalog does not have a signer certificate.'
}

$rootCertificate = Import-Certificate -FilePath $certificate -CertStoreLocation 'Cert:\LocalMachine\Root'
$publisherCertificate = Import-Certificate -FilePath $certificate -CertStoreLocation 'Cert:\LocalMachine\TrustedPublisher'
if ($null -eq $rootCertificate -or $null -eq $publisherCertificate) {
  throw 'The test certificate could not be imported.'
}

$trustedSignature = Get-AuthenticodeSignature -LiteralPath $catalog
if ($trustedSignature.Status -ne [System.Management.Automation.SignatureStatus]::Valid) {
  throw "The trusted catalog signature is not valid: $($trustedSignature.StatusMessage)"
}

& pnputil.exe /add-driver $inf /install
if ($LASTEXITCODE -ne 0) {
  throw "PnPUtil failed with exit code $LASTEXITCODE."
}

Write-Output 'InfiniteDesk virtual display test driver is staged.'
Write-Output "Start the monitor with: $outputRoot\InfiniteDeskVirtualDisplayHost.exe"
