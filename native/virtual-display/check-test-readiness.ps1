param(
  [Parameter(Mandatory = $true)]
  [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Administrator privileges are required.'
}

$secureBoot = try {
  [bool](Confirm-SecureBootUEFI)
} catch {
  "Unknown: $($_.Exception.Message)"
}

$bcdOutput = @(bcdedit.exe /enum '{current}' 2>&1)
$testSigning = [bool]($bcdOutput -match '^testsigning\s+Yes$')

$bitLocker = try {
  $volume = Get-BitLockerVolume -MountPoint $env:SystemDrive
  [pscustomobject]@{
    ProtectionStatus = [string]$volume.ProtectionStatus
    VolumeStatus = [string]$volume.VolumeStatus
  }
} catch {
  [pscustomobject]@{
    ProtectionStatus = 'Unknown'
    VolumeStatus = $_.Exception.Message
  }
}

$result = [pscustomobject]@{
  IsAdministrator = $true
  SecureBoot = $secureBoot
  TestSigning = $testSigning
  BitLocker = $bitLocker
  BcdOutput = $bcdOutput
}

$directory = Split-Path -Parent $OutputPath
if (-not (Test-Path -LiteralPath $directory)) {
  New-Item -ItemType Directory -Path $directory -Force | Out-Null
}
$result | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $OutputPath -Encoding UTF8
