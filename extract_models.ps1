# Extract the 10 specified model zip files
$modelsDir = "c:\Users\JITENDRA KATARIYA\Weapons.ai\frontend\public\models"
if (-not (Test-Path $modelsDir)) { New-Item -ItemType Directory -Path $modelsDir -Force }

$zipFiles = @(
  "mini-14_ranch_rifle.zip",
  "sukhoi-su-57-felon-fighter-jet-free.zip",
  "kf-21a-boramae-fighter-jet.zip",
  "sukhoi-su-57-felon-p-fighter-jet-free.zip",
  "jet-fighter.zip",
  "us-super-battleship-rhodeisland.zip",
  "sikorsky-ch-53e-sea-stallion.zip",
  "type87_arv.zip",
  "arx-apc.zip",
  "japanese-type-87-rcv.zip"
)

$downloadsDir = "c:\Users\JITENDRA KATARIYA\Downloads"

foreach ($zip in $zipFiles) {
  $zipPath = Join-Path $downloadsDir $zip
  $folderName = [System.IO.Path]::GetFileNameWithoutExtension($zip)
  $extractDir = Join-Path $modelsDir $folderName
  
  if (Test-Path $zipPath) {
    Write-Host "Processing: $zip"
    if (-not (Test-Path $extractDir)) { New-Item -ItemType Directory -Path $extractDir -Force | Out-Null }
    try {
      Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force -ErrorAction Stop
      $models = Get-ChildItem -Path $extractDir -Recurse -Include "*.glb","*.gltf" | Select-Object -ExpandProperty FullName
      if ($models) {
        foreach ($m in $models) { Write-Host "  FOUND: $m" }
      } else {
        Write-Host "  WARNING: No GLB/GLTF found in $zip"
      }
    } catch {
      Write-Host "  ERROR extracting: $_"
    }
  } else {
    Write-Host "NOT FOUND: $zipPath"
  }
}

Write-Host "=== EXTRACTION COMPLETE ==="
