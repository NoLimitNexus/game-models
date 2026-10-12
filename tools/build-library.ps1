# Rebuilds library\ (the web-ready GLBs) from extracted\ using headless Blender (no window opens).
#   powershell -File tools\build-library.ps1
# What it does:
#   Quaternius: characters, outfits, hair and cut-off heads, textures shrunk to 1024 px, one GLB each;
#               the Unreal-skeleton animation file becomes one animation-only GLB (45 clips, same 65 bones)
#   KayKit:     characters are copied as they are (already tiny); the 8 Rig_Medium animation files are
#               stripped to animation-only GLBs (132 distinct clips)
$ErrorActionPreference = 'Stop'
$g = Split-Path $PSScriptRoot
$e = Join-Path $g 'extracted'
$lib = Join-Path $g 'library'

$bc = "$e\base\Universal Base Characters[Standard]"
$od = "$e\outfits\Modular Character Outfits - Fantasy[Standard]\Exports\glTF (Godot-Unreal)"
$ka = "$e\kaykit-adv\KayKit_Adventurers_2.0_FREE"
$kn = "$e\kaykit-anim\KayKit_Character_Animations_1.1"
foreach ($d in $bc, $od, $ka, $kn) { if (-not (Test-Path -LiteralPath $d)) { throw "missing $d (run tools\fetch-packs.ps1 first)" } }

$jobs = @()
$jobs += @{ kind = 'animations'; src = "$e\ual\Animation Library[Standard]\Unreal Engine\AL_Standard.fbx"; out = "$lib\quaternius\animations\UAL_Standard.glb" }
foreach ($s in 'Male', 'Female') {
  $jobs += @{ kind = 'character'; src = "$bc\Base Characters\Godot - UE\Superhero_${s}_FullBody.gltf"; out = "$lib\quaternius\characters\Superhero_$s.glb"; tex = 1024 }
  $jobs += @{ kind = 'head';      src = "$bc\Base Characters\Godot - UE\Superhero_${s}_FullBody.gltf"; out = "$lib\quaternius\heads\Head_$s.glb"; tex = 1024 }
}
foreach ($h in 'Hair_Beard', 'Hair_Buns', 'Hair_Buzzed', 'Hair_BuzzedFemale', 'Hair_Long', 'Hair_SimpleParted') {
  $jobs += @{ kind = 'character'; src = "$bc\Hairstyles\Rigged to Head Bone\glTF (Godot -Unreal)\$h.gltf"; out = "$lib\quaternius\hair\$h.glb"; tex = 1024 }
}
foreach ($o in 'Male_Peasant', 'Female_Peasant', 'Male_Ranger', 'Female_Ranger') {
  $jobs += @{ kind = 'character'; src = "$od\Outfits\$o.gltf"; out = "$lib\quaternius\outfits\$o.glb"; tex = 1024 }
}
foreach ($f in Get-ChildItem "$kn\Animations\gltf\Rig_Medium" -Filter *.glb) {
  $jobs += @{ kind = 'animations'; src = $f.FullName; out = "$lib\kaykit\animations\$($f.Name)" }
}

New-Item -ItemType Directory -Force -Path "$lib\kaykit\characters" | Out-Null
Copy-Item -Path "$ka\Characters\gltf\*.glb" -Destination "$lib\kaykit\characters" -Force

$jobFile = Join-Path $env:TEMP 'game-models-jobs.json'
[ordered]@{ log = "$g\tools\last-run.log"; jobs = $jobs } | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 $jobFile
& powershell.exe -NoProfile -File "$PSScriptRoot\run-blender.ps1" -Jobs $jobFile | Select-String 'wrote|FAILED|exit code|DONE'

# Our own characters (characters\*.json) on the KayKit skeleton, built by tools\bl_make_character.py
$charLog = Join-Path $env:TEMP 'game-models-chars.log'
$specs = (Get-ChildItem "$g\characters" -Filter *.json).FullName | ForEach-Object { "`"$_`"" }
$p = Start-Process -FilePath (Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps\blender-launcher.exe') -WindowStyle Hidden -Wait -PassThru `
  -ArgumentList (@('--background', '--factory-startup', '--python', "`"$PSScriptRoot\bl_make_character.py`"", '--', "`"$charLog`"", "`"$lib\ours\characters`"") + $specs)
"character generator exit code: " + $p.ExitCode
Get-Content $charLog | Select-String 'wrote|FAILED|DONE'
Get-ChildItem $lib -Recurse -File -Filter *.glb | Group-Object { $_.Directory.Parent.Name + '/' + $_.Directory.Name } |
  ForEach-Object { '{0,-28} {1,2} files {2,6:N1} MB' -f $_.Name, $_.Count, (($_.Group | Measure-Object Length -Sum).Sum / 1MB) }
