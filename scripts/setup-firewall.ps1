# Allows inbound connections to the server from the LAN (needed on Windows
# because the default profile blocks incoming traffic). Requires an
# administrator PowerShell.
#
#   powershell -ExecutionPolicy Bypass -File scripts\setup-firewall.ps1 [-Port 50080]

param(
    [int]$Port = 50080,
    [string]$RuleName = 'Shelf Book Server'
)

$ErrorActionPreference = 'Stop'
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { throw 'run this from an administrator PowerShell' }

# Windows adds a "block" rule for the program when the first-run security
# alert is dismissed, and block rules win over allow rules. Remove those.
$blocked = Get-NetFirewallRule -Direction Inbound -Action Block -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -in @('shelf', 'shelfw', 'shelf.exe', 'shelfw.exe') }
if ($blocked) {
    $blocked | Remove-NetFirewallRule
    Write-Host "removed $(@($blocked).Count) automatic block rule(s) for shelf"
}

Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName $RuleName -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Any | Out-Null
Write-Host "inbound TCP $Port allowed ($RuleName)"
