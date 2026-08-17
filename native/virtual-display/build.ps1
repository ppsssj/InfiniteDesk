param(
  [ValidateSet('Debug', 'Release')]
  [string]$Configuration = 'Debug'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path -LiteralPath $vswhere)) {
  throw 'Visual Studio Installer (vswhere.exe) was not found.'
}

$installPath = & $vswhere -products * -requires Component.Microsoft.Windows.DriverKit.BuildTools -property installationPath
if ([string]::IsNullOrWhiteSpace($installPath)) {
  throw 'Visual Studio WDK Build Tools are not installed.'
}

$msbuild = Join-Path $installPath 'MSBuild\Current\Bin\amd64\MSBuild.exe'
if (-not (Test-Path -LiteralPath $msbuild)) {
  throw '64-bit MSBuild was not found.'
}

$solution = Join-Path $PSScriptRoot 'InfiniteDeskVirtualDisplay.sln'
& $msbuild $solution /m /nodeReuse:false /t:Clean,Build /p:Configuration=$Configuration /p:Platform=x64 /p:TargetPlatformVersion=10.0.26100.0 /verbosity:minimal
if ($LASTEXITCODE -ne 0) {
  throw "Virtual display build failed with exit code $LASTEXITCODE."
}
