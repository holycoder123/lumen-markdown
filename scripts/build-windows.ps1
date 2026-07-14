$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
$stageOne = Join-Path $root 'dist-build-stage'
$stageTwo = Join-Path $root 'dist-build-result'
$dist = Join-Path $root 'dist'

function Remove-SafeDirectory([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) { return }
  $workspace = (Resolve-Path $root).Path
  $resolved = (Resolve-Path $path).Path
  if (-not $resolved.StartsWith($workspace + '\')) { throw "Refusing to remove path outside workspace: $resolved" }
  Remove-Item -LiteralPath $resolved -Recurse -Force
}

if (-not (Test-Path (Join-Path $root 'node_modules\electron-builder'))) {
  Write-Host 'Installing dependencies...' -ForegroundColor Cyan
  npm install
  if ($LASTEXITCODE -ne 0) { throw 'npm install failed' }
}

Remove-SafeDirectory $stageOne
Remove-SafeDirectory $stageTwo
New-Item -ItemType Directory -Path $stageOne -Force | Out-Null

Write-Host 'Building Electron package...' -ForegroundColor Cyan
& npx --no-install electron-builder --win --publish never "--config.directories.output=$stageOne"
$firstExitCode = $LASTEXITCODE

if ($firstExitCode -eq 0) {
  $builtFrom = $stageOne
} else {
  $temporaryElectron = Join-Path $stageOne 'win-unpacked.tmp'
  if (-not (Test-Path -LiteralPath $temporaryElectron)) {
    throw "electron-builder failed with exit code $firstExitCode and did not leave an unpacked Electron directory"
  }

  # electron-builder may fail to rename this directory on some Windows/Node versions.
  $electronDist = Join-Path $stageOne 'electron-unpacked'
  Move-Item -LiteralPath $temporaryElectron -Destination $electronDist -Force
  Write-Host 'Retrying with the extracted Electron runtime...' -ForegroundColor Yellow
  & npx --no-install electron-builder --win --publish never "--config.electronDist=$electronDist" "--config.directories.output=$stageTwo"
  if ($LASTEXITCODE -ne 0) { throw 'electron-builder retry failed' }
  $builtFrom = $stageTwo
}

Write-Host 'Updating dist directory...' -ForegroundColor Cyan
Get-Process picpreview,Lumen,electron -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

try {
  Remove-SafeDirectory (Join-Path $dist 'win-unpacked')
  Get-ChildItem -LiteralPath $builtFrom -File | Copy-Item -Destination $dist -Force -ErrorAction Stop
  Copy-Item -LiteralPath (Join-Path $builtFrom 'win-unpacked') -Destination (Join-Path $dist 'win-unpacked') -Recurse -Force -ErrorAction Stop
} catch {
  Write-Host 'A file preview window is locking dist; restarting Explorer and retrying...' -ForegroundColor Yellow
  Get-Process explorer -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  Remove-SafeDirectory (Join-Path $dist 'win-unpacked')
  Get-ChildItem -LiteralPath $builtFrom -File | Copy-Item -Destination $dist -Force
  Copy-Item -LiteralPath (Join-Path $builtFrom 'win-unpacked') -Destination (Join-Path $dist 'win-unpacked') -Recurse -Force
  Start-Process explorer.exe
}

Remove-SafeDirectory $stageOne
Remove-SafeDirectory $stageTwo

Write-Host ''
Write-Host 'Build complete:' -ForegroundColor Green
Get-ChildItem -LiteralPath $dist -Filter 'Lumen-*.exe' | Select-Object Name,Length,LastWriteTime
