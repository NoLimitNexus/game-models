param([string]$PageUrl, [string]$OutDir)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$page = $PageUrl.TrimEnd('/')
$r = Invoke-WebRequest -UseBasicParsing $page -SessionVariable s
$csrf = [regex]::Match($r.Content, 'name="csrf_token" value="([^"]+)"').Groups[1].Value
$resp = Invoke-WebRequest -UseBasicParsing -Method Post -Uri ($page + '/download_url') -Body @{ csrf_token = $csrf } -WebSession $s
$dl = ($resp.Content | ConvertFrom-Json).url
$d = Invoke-WebRequest -UseBasicParsing $dl -WebSession $s
$csrf2 = [regex]::Match($d.Content, 'name="csrf_token" value="([^"]+)"').Groups[1].Value
$key = ($dl -split '/download/')[1]
$ids = @([regex]::Matches($d.Content, 'data-upload_id="(\d+)"') | ForEach-Object { $_.Groups[1].Value })
$names = @([regex]::Matches($d.Content, 'class="upload_name"[^>]*>.*?title="([^"]+)"') | ForEach-Object { $_.Groups[1].Value })
for ($i = 0; $i -lt $ids.Count; $i++) {
  $id = $ids[$i]
  $fileUrl = "$page/file/${id}?source=view_game&as_props=1&after_download_lightbox=true"
  $fr = Invoke-WebRequest -UseBasicParsing -Method Post -Uri $fileUrl -Body @{ csrf_token = $csrf2 } -WebSession $s
  $cdn = ($fr.Content | ConvertFrom-Json).url
  if (-not $cdn) { throw "no cdn url for $id : $($fr.Content)" }
  $leaf = ($names[$i] -replace '[^\w\.\- ]', '_'); if ($leaf -notmatch '\.zip$') { $leaf += '.zip' }
  $out = Join-Path $OutDir $leaf
  Invoke-WebRequest -UseBasicParsing -Uri $cdn -OutFile $out
  $item = Get-Item $out
  "{0}  {1:N0} bytes  (itch name: {2})" -f $item.FullName, $item.Length, $names[$i]
}
