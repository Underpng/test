# Registers a per-user scheduled task that starts the windowless server at
# logon. No administrator rights needed. Run again to update the paths.
#
#   powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1 [-Exe <path to shelfw.exe>]
#   powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1 -Remove

param(
    [string]$Exe = (Join-Path (Split-Path $PSScriptRoot -Parent) 'dist\shelfw.exe'),
    [string]$TaskName = 'ShelfBookServer',
    [switch]$Remove
)

$ErrorActionPreference = 'Stop'

if ($Remove) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Get-Process shelfw -ErrorAction SilentlyContinue | Stop-Process
    Write-Host "removed task $TaskName"
    return
}

$Exe = (Resolve-Path $Exe).Path
$workDir = Split-Path $Exe -Parent

$action = New-ScheduledTaskAction -Execute $Exe -WorkingDirectory $workDir
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName
Write-Host "task $TaskName registered and started: $Exe (working dir $workDir)"
