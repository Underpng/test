# Copies the built server into a permanent folder and (optionally) moves an
# existing books folder there and registers autostart. No admin needed.
#
#   powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -Target D:\ShelfBook [-BooksFrom <folder>] [-Autostart]

param(
    [Parameter(Mandatory = $true)][string]$Target,
    [string]$BooksFrom = '',
    [switch]$Autostart
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$dist = Join-Path $repo 'dist'
foreach ($exe in 'shelf.exe', 'shelfw.exe') {
    if (-not (Test-Path (Join-Path $dist $exe))) { throw "missing $dist\$exe - run build.ps1 first" }
}

New-Item -ItemType Directory -Force $Target | Out-Null
New-Item -ItemType Directory -Force (Join-Path $Target 'scripts') | Out-Null

# Stop a running copy so the exe can be replaced.
Get-Process shelf, shelfw -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$Target*" } | Stop-Process -Force
Start-Sleep -Milliseconds 500

Copy-Item (Join-Path $dist 'shelf.exe') $Target -Force
Copy-Item (Join-Path $dist 'shelfw.exe') $Target -Force
Copy-Item (Join-Path $PSScriptRoot 'install-autostart.ps1') (Join-Path $Target 'scripts') -Force
Copy-Item (Join-Path $PSScriptRoot 'setup-firewall.ps1') (Join-Path $Target 'scripts') -Force

$books = Join-Path $Target 'books'
if ($BooksFrom -and (Test-Path $BooksFrom)) {
    if (Test-Path $books) {
        Get-ChildItem $BooksFrom -Force | Move-Item -Destination $books -Force
    } else {
        Move-Item $BooksFrom $books
    }
    Write-Host "moved books from $BooksFrom"
}
New-Item -ItemType Directory -Force $books | Out-Null

Write-Host "installed to $Target"
Write-Host "  books: $books"
Write-Host "  start: $Target\shelf.exe   (or shelfw.exe for no window)"

if ($Autostart) {
    & (Join-Path $Target 'scripts\install-autostart.ps1') -Exe (Join-Path $Target 'shelfw.exe')
}
