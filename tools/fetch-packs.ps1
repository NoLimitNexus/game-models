# Downloads the free packs into downloads\ and unpacks each into its own folder under extracted\.
# Safe to re-run: a pack that is already there is skipped.
# Everything here is untrusted third-party data: it is only ever read (by Blender, headless), never run.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot
$dl = Join-Path $root 'downloads'
$ex = Join-Path $root 'extracted'
New-Item -ItemType Directory -Force -Path $dl, $ex | Out-Null

$packs = @(
  @{ key = 'ual';         dir = 'quaternius-ual-standard';        direct = 'https://opengameart.org/sites/default/files/universal_animation_librarystandard.zip' },
  @{ key = 'base';        dir = 'quaternius-base-characters';     itch = 'https://quaternius.itch.io/universal-base-characters' },
  @{ key = 'outfits';     dir = 'quaternius-outfits-fantasy';     itch = 'https://quaternius.itch.io/modular-character-outfits-fantasy' },
  @{ key = 'kaykit-adv';  dir = 'kaykit-adventurers';             itch = 'https://kaylousberg.itch.io/kaykit-adventurers' },
  @{ key = 'kaykit-anim'; dir = 'kaykit-animations';              itch = 'https://kaylousberg.itch.io/kaykit-character-animations' },
  @{ key = 'kenney3';     dir = 'kenney-animated-characters-3';   itch = 'https://kenney-assets.itch.io/animated-characters-3' }
)

foreach ($p in $packs) {
  $dir = Join-Path $dl $p.dir
  if (-not (Get-ChildItem -LiteralPath $dir -Filter *.zip -ErrorAction SilentlyContinue)) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    if ($p.direct) {
      Invoke-WebRequest -UseBasicParsing $p.direct -OutFile (Join-Path $dir ([IO.Path]::GetFileName($p.direct)))
    } else {
      & powershell.exe -NoProfile -File (Join-Path $PSScriptRoot 'itch-get.ps1') -PageUrl $p.itch -OutDir $dir
    }
  }
  $dest = Join-Path $ex $p.key
  if (-not (Test-Path -LiteralPath $dest)) {
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    $zip = Get-ChildItem -LiteralPath $dir -Filter *.zip | Select-Object -First 1
    Expand-Archive -LiteralPath $zip.FullName -DestinationPath $dest
  }
  "{0,-12} ready" -f $p.key
}
