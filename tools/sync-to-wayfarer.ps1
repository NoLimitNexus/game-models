# Copies what the game needs from this repo into Wayfarer: the character code and the models (library\).
#   powershell -File tools\sync-to-wayfarer.ps1 [-Wayfarer C:\Projects\wayfarer]
# Wayfarer keeps its own copy so it never depends on this repo being online. The database can override the bundled files
# at runtime; the copy is what the game falls back to.
param([string]$Wayfarer = 'C:\Projects\wayfarer')
$ErrorActionPreference = 'Stop'
$g = Split-Path $PSScriptRoot
if (-not (Test-Path -LiteralPath "$Wayfarer\src")) { throw "not a Wayfarer folder: $Wayfarer" }
Copy-Item -LiteralPath "$g\character.js" -Destination "$Wayfarer\src\character.js" -Force
$dst = Join-Path $Wayfarer 'assets\models\library'
if ((Test-Path -LiteralPath $dst) -and ($dst -notlike '*\wayfarer\assets\models\library')) { throw "refusing to clear $dst" }
if (Test-Path -LiteralPath $dst) { Remove-Item -LiteralPath $dst -Recurse -Force }
New-Item -ItemType Directory -Force -Path $dst | Out-Null
Copy-Item -Path "$g\library\*" -Destination $dst -Recurse -Force
$mb = (Get-ChildItem $dst -Recurse -File | Measure-Object Length -Sum).Sum / 1MB
"copied character.js and library ({0:N1} MB) into {1}" -f $mb, $Wayfarer
