# Runs bl_convert.py headless in the Store version of Blender (no window opens).
# Usage: powershell -File run-blender.ps1 -Jobs <jobs.json>
param([Parameter(Mandatory)][string]$Jobs)
$ErrorActionPreference = 'Stop'
$launcher = Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps\blender-launcher.exe'
$script = Join-Path $PSScriptRoot 'bl_convert.py'
$p = Start-Process -FilePath $launcher -ArgumentList @('--background', '--factory-startup', '--python', "`"$script`"", '--', "`"$Jobs`"") -Wait -PassThru -WindowStyle Hidden
"blender exit code: " + $p.ExitCode
$log = (Get-Content -Raw $Jobs | ConvertFrom-Json).log
if (Test-Path $log) { Get-Content $log }
