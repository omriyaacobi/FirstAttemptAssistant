# autostart.ps1 - makes, removes or shows the Windows scheduled task "Bot". Run it through install-autostart.cmd /
# remove-autostart.cmd (double-click), not by hand.
#
# The task (you can see it in Task Scheduler, Task Scheduler Library -> "Bot"):
#   - runs as YOU, only while you are logged in, with normal rights (not as administrator);
#   - starts 30 seconds after you log in, then repeats every 5 minutes for as long as you are logged in;
#     a second (time) trigger starts the same 5-minute check right after install, without waiting for a login;
#   - runs bot-watchdog.vbs with wscript //B: no window, and no error box can ever pop up over a game;
#   - bot-watchdog.vbs runs watchdog.cmd, which starts Bot if it is not running and restarts it if it hangs;
#   - runs on battery too, never starts a second copy of itself, and is stopped if it ever takes over 10 minutes.
# "show" only prints the task definition (XML) that "install" would register, and changes nothing.
param([ValidateSet('install', 'remove', 'status', 'show')][string]$Action = 'status')
$ErrorActionPreference = 'Stop'
$TaskName = 'Bot'
$folder = $PSScriptRoot
$vbs = Join-Path $folder 'bot-watchdog.vbs'
$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

function Esc([string]$s) { [System.Security.SecurityElement]::Escape($s) }

function Show-Status {
  $t = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if (-not $t) { "There is no '$TaskName' task: Bot does not start by itself at login."; return }
  $i = Get-ScheduledTaskInfo -TaskName $TaskName
  "Task '$TaskName' is $($t.State). It runs: $($t.Actions[0].Execute) $($t.Actions[0].Arguments)"
  "Last run: $($i.LastRunTime) (result $($i.LastTaskResult); 0 = fine). Next run: $($i.NextRunTime)."
}

if ($Action -eq 'status') { Show-Status; return }

if ($Action -eq 'remove') {
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    "Removed the '$TaskName' task. Bot will no longer start at login or be watched."
    "If Bot is running now it keeps running; stop it with stop-bot.cmd."
  } else { "There was no '$TaskName' task. Nothing to remove." }
  return
}

# The login trigger's 5-minute repeat only begins at the NEXT login, so a task installed while logged in never repeated
# (Bot stayed down a whole night, 2026-11-14). The time trigger starts the same 5-minute check one minute after install.
$start = (Get-Date).AddMinutes(1).ToString('yyyy-MM-ddTHH:mm:ss')

$xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Keeps Bot running with no window: starts it at login and checks every 5 minutes (watchdog.cmd). Made by install-autostart.cmd; remove with remove-autostart.cmd.</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>$(Esc $user)</UserId>
      <Delay>PT30S</Delay>
      <Repetition>
        <Interval>PT5M</Interval>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
    </LogonTrigger>
    <TimeTrigger>
      <Enabled>true</Enabled>
      <StartBoundary>$start</StartBoundary>
      <Repetition>
        <Interval>PT5M</Interval>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
    </TimeTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>$(Esc $user)</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <IdleSettings><StopOnIdleEnd>false</StopOnIdleEnd><RestartOnIdle>false</RestartOnIdle></IdleSettings>
    <ExecutionTimeLimit>PT10M</ExecutionTimeLimit>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>wscript.exe</Command>
      <Arguments>//B //Nologo "$(Esc $vbs)"</Arguments>
      <WorkingDirectory>$(Esc $folder)</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"@

if ($Action -eq 'show') { $xml; return }

# install
if ($folder -match '\\\.claude\\worktrees\\') {
  throw "This copy is a Claude Code worktree ($folder). Run install-autostart.cmd from the main Bot folder instead."
}
if (-not (Test-Path $vbs)) { throw "bot-watchdog.vbs is missing next to this script." }

try {
  Register-ScheduledTask -TaskName $TaskName -Xml $xml -Force | Out-Null
} catch {
  if ("$_" -match 'denied') {
    throw "Windows said 'access denied'. Right-click install-autostart.cmd and choose 'Run as administrator' (only to MAKE the task; it still runs as you, with normal rights)."
  }
  throw
}
"Made the '$TaskName' task for $user."
"Bot now starts by itself 30 seconds after you log in, and is checked every 5 minutes (started again if it stopped or hung)."
"To undo: double-click remove-autostart.cmd. To stop Bot for a while: stop-bot.cmd (the watchdog then leaves it stopped)."
Start-ScheduledTask -TaskName $TaskName
"Ran the check once now."
Show-Status
