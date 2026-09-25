# Builds the frontend, embeds it into the Go server and produces:
#   dist\shelf.exe   - console version (shows logs in a window)
#   dist\shelfw.exe  - windowless version (for autostart; logs go to data\server.log)
#
# Usage: powershell -ExecutionPolicy Bypass -File build.ps1 [-SkipFront]

param(
    [switch]$SkipFront
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$go = if (Get-Command go -ErrorAction SilentlyContinue) { 'go' } else { "$env:ProgramFiles\Go\bin\go.exe" }
$version = (git -C $root describe --tags --always --dirty 2>$null)
if (-not $version) { $version = 'dev' }

if (-not $SkipFront) {
    Push-Location (Join-Path $root 'front')
    try {
        if (-not (Test-Path 'node_modules')) { npm ci --no-audit --no-fund }
        npm run build
        if ($LASTEXITCODE -ne 0) { throw 'frontend build failed' }
    } finally { Pop-Location }
}

$embed = Join-Path $root 'back\web\dist'
Get-ChildItem $embed -Exclude '.gitkeep' | Remove-Item -Recurse -Force
Copy-Item (Join-Path $root 'front\dist\*') $embed -Recurse -Force

$out = Join-Path $root 'dist'
New-Item -ItemType Directory -Force $out | Out-Null
Push-Location (Join-Path $root 'back')
try {
    $env:CGO_ENABLED = '0'
    & $go build -trimpath -ldflags "-s -w -X main.version=$version" -o (Join-Path $out 'shelf.exe') .
    if ($LASTEXITCODE -ne 0) { throw 'go build (console) failed' }
    & $go build -trimpath -ldflags "-s -w -H windowsgui -X main.version=$version" -o (Join-Path $out 'shelfw.exe') .
    if ($LASTEXITCODE -ne 0) { throw 'go build (windowless) failed' }
} finally { Pop-Location }

Get-ChildItem $out | Select-Object Name, @{n='MB';e={[math]::Round($_.Length/1MB,1)}}
Write-Host "built $version -> $out"
