# Registers the nightly bridge poll (ADR-0033 decision 7) for the logged-on
# Windows user: 07:00 UTC every day, running scripts/poll-nightly.sh in the
# monsterpaws-dev distro. Re-running replaces the task. From WSL:
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(wslpath -w scripts/windows/register-nightly-poll.ps1)"
# Remove: Unregister-ScheduledTask -TaskName 'Monster Paws nightly poll' -Confirm:$false
$ErrorActionPreference = 'Stop'
$name = 'Monster Paws nightly poll'
$action = New-ScheduledTaskAction -Execute 'wsl.exe' `
  -Argument '-d monsterpaws-dev -u oof -- /home/oof/monsterpaws/scripts/poll-nightly.sh'
$trigger = New-ScheduledTaskTrigger -Daily -At '07:00'
# A trailing Z synchronizes the trigger to UTC, so the 07:00 run does not move
# an hour when Central time leaves daylight saving (2026-11-01).
$trigger.StartBoundary = '2026-10-29T07:00:00Z'
# Interactive logon only: WSL needs the user's session. StartWhenAvailable
# runs a missed 07:00 once the user is back, still never twice in a day.
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 4)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger `
  -Settings $settings -Principal $principal -Force | Out-Null
$t = Get-ScheduledTask -TaskName $name
"{0}: {1}, next run {2:u}" -f $t.TaskName, $t.State, (Get-ScheduledTaskInfo -TaskName $name).NextRunTime.ToUniversalTime()
