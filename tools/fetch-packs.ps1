# Downloads the KayKit packs into downloads\ and unpacks each into its own folder under extracted\.
# Safe to re-run: a pack that is already there is skipped. Everything here is untrusted third-party data: it is only
# ever read (by Blender, headless), never run.
#   kaykit-anim : the animation clips we build library\animations from (CC0)
#   kaykit-adv  : KayKit's classic characters, kept on this PC only as the quality benchmark (reference\, never published)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot
$dl = Join-Path $root 'downloads'
$ex = Join-Path $root 'extracted'
New-Item -ItemType Directory -Force -Path $dl, $ex | Out-Null

$packs = @(
  @{ key = 'kaykit-adv';  dir = 'kaykit-adventurers'; itch = 'https://kaylousberg.itch.io/kaykit-adventurers' },
  @{ key = 'kaykit-anim'; dir = 'kaykit-animations';  itch = 'https://kaylousberg.itch.io/kaykit-character-animations' }
)

foreach ($p in $packs) {
  $dir = Join-Path $dl $p.dir
  if (-not (Get-ChildItem -LiteralPath $dir -Filter *.zip -ErrorAction SilentlyContinue)) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    & powershell.exe -NoProfile -File (Join-Path $PSScriptRoot 'itch-get.ps1') -PageUrl $p.itch -OutDir $dir
  }
  $dest = Join-Path $ex $p.key
  if (-not (Test-Path -LiteralPath $dest)) {
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    $zip = Get-ChildItem -LiteralPath $dir -Filter *.zip | Select-Object -First 1
    Expand-Archive -LiteralPath $zip.FullName -DestinationPath $dest
  }
  "{0,-12} ready" -f $p.key
}
