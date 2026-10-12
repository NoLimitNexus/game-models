# Rebuilds library\ from scratch (headless Blender, no window opens):
#   library\animations   the 8 Rig_Medium clip files from KayKit's animation pack, stripped to animation only (132 clips)
#   library\ours         OUR body, parts and tools, made by tools\bl_make_kit.py on that skeleton
# and copies KayKit's classic characters to reference\kaykit (this PC only, the quality benchmark; never published).
#   powershell -File tools\build-library.ps1
$ErrorActionPreference = 'Stop'
$g = Split-Path $PSScriptRoot
$e = Join-Path $g 'extracted'
$lib = Join-Path $g 'library'
$blender = Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps\blender-launcher.exe'

$kn = "$e\kaykit-anim\KayKit_Character_Animations_1.1"
$ka = "$e\kaykit-adv\KayKit_Adventurers_2.0_FREE"
foreach ($d in $kn, $ka) { if (-not (Test-Path -LiteralPath $d)) { throw "missing $d (run tools\fetch-packs.ps1 first)" } }

# 1. animation clips
$jobs = @()
foreach ($f in Get-ChildItem "$kn\Animations\gltf\Rig_Medium" -Filter *.glb) {
  $jobs += @{ kind = 'animations'; src = $f.FullName; out = "$lib\animations\$($f.Name)" }
}
$jobFile = Join-Path $env:TEMP 'game-models-jobs.json'
[ordered]@{ log = "$g\tools\last-run.log"; jobs = $jobs } | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 $jobFile
& powershell.exe -NoProfile -File "$PSScriptRoot\run-blender.ps1" -Jobs $jobFile | Select-String 'wrote|FAILED|exit code|DONE'

# 1b. our own clips, authored on that skeleton (tools\bl_make_clips.py): library\animations\Rig_Medium_Ours.glb
$clipLog = Join-Path $env:TEMP 'game-models-clips.log'
$pc = Start-Process -FilePath $blender -WindowStyle Hidden -Wait -PassThru -ArgumentList @('--background', '--factory-startup', '--python', "`"$PSScriptRoot\bl_make_clips.py`"", '--', "`"$clipLog`"", "`"$lib\animations\Rig_Medium_General.glb`"", "`"$lib\animations\Rig_Medium_Ours.glb`"")
"clip generator exit code: " + $pc.ExitCode
Get-Content $clipLog | Select-String 'FAILED|DONE|^wrote' | Select-Object -Last 3

# 2. our body kit
$kitLog = Join-Path $env:TEMP 'game-models-kit.log'
$p = Start-Process -FilePath $blender -WindowStyle Hidden -Wait -PassThru -ArgumentList @('--background', '--factory-startup', '--python', "`"$PSScriptRoot\bl_make_kit.py`"", '--', "`"$kitLog`"", "`"$lib\ours`"", 'body', 'parts', 'tools')
"kit generator exit code: " + $p.ExitCode
Get-Content $kitLog | Select-String 'FAILED|DONE|^body|^tool|^part' | Select-Object -Last 8

# 3. the benchmark characters, this PC only
New-Item -ItemType Directory -Force -Path "$g\reference\kaykit" | Out-Null
Copy-Item -Path "$ka\Characters\gltf\*.glb" -Destination "$g\reference\kaykit" -Force

Get-ChildItem $lib -Recurse -File -Filter *.glb | Group-Object { $_.Directory.Name } |
  ForEach-Object { '{0,-12} {1,2} files {2,6:N1} MB' -f $_.Name, $_.Count, (($_.Group | Measure-Object Length -Sum).Sum / 1MB) }
