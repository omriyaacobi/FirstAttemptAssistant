# window-check.ps1 - proves the watchdog chain shows NO window and takes no focus (2026-11-12, see 2026-11-12-always-up.md).
# Run from the project root: powershell -NoProfile -ExecutionPolicy Bypass -File experiments\window-check.ps1 -Repo (Get-Location).Path
# It starts a fake HUNG server on port 3298 (never 3000), runs bot-watchdog.vbs the way the scheduled task does (wscript //B),
# and polls every visible top-level window and the foreground window every 50 ms until it ends. The final "start" step runs the
# real start-hidden.vbs, which does nothing because the live Bot answers on 3000.
param([string]$Repo)
Add-Type @"
using System; using System.Collections.Generic; using System.Runtime.InteropServices; using System.Text;
public static class Win {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  public static List<string> Visible() {
    var r = new List<string>();
    EnumWindows((h, l) => { if (IsWindowVisible(h)) { uint p; GetWindowThreadProcessId(h, out p); var s = new StringBuilder(256); GetWindowText(h, s, 256); r.Add(h.ToInt64() + "|" + p + "|" + s); } return true; }, IntPtr.Zero);
    return r;
  }
}
"@
$watch = 'cmd','conhost','OpenConsole','WindowsTerminal','wscript','powershell','curl','PING','netstat','findstr','taskkill','node'
$before = @{}; foreach ($w in [Win]::Visible()) { $before[$w.Split('|')[0]] = 1 }
$fg0 = [Win]::GetForegroundWindow()
$port = 3298
$hung = Start-Process node -ArgumentList '-e', "`"require('net').createServer(()=>{}).listen($port,'127.0.0.1')`"" -WindowStyle Hidden -PassThru
Start-Sleep -Milliseconds 800
$env:BOT_WATCH_PORT = "$port"; $env:BOT_WATCH_WAIT = '3'; $env:BOT_WATCH_CURL = '3'
$env:BOT_WATCH_LOG = Join-Path $env:TEMP 'wd-window-test.log'; Remove-Item $env:BOT_WATCH_LOG -ErrorAction SilentlyContinue
$ws = Start-Process wscript.exe -ArgumentList '//B', '//Nologo', "`"$Repo\bot-watchdog.vbs`"" -PassThru
$trans = @(); $seen = @{}; $polls = 0; $fgChanged = 0
$end = $null
while ($true) {
  $polls++
  foreach ($w in [Win]::Visible()) {
    $parts = $w.Split('|'); if ($before.ContainsKey($parts[0])) { continue }
    $p = Get-Process -Id $parts[1] -ErrorAction SilentlyContinue
    if ($p -and $watch -contains $p.ProcessName) { $seen[$w] = $p.ProcessName }
  }
  $fg = [Win]::GetForegroundWindow(); if ($fg -ne $fg0) { $fgChanged++; [uint32]$fp = 0; [void][Win]::GetWindowThreadProcessId($fg, [ref]$fp); $fn = (Get-Process -Id $fp -ErrorAction SilentlyContinue).ProcessName; $trans += "$((Get-Date).ToString('HH:mm:ss.fff')) fg -> $fn ($fp) hwnd $fg"; $fg0 = $fg }
  if ($ws.HasExited -and -not $end) { $end = (Get-Date).AddSeconds(4) }
  if ($end -and (Get-Date) -gt $end) { break }
  Start-Sleep -Milliseconds 50
}
"polls=$polls watchdog exit=$($ws.ExitCode) hungServerAlive=$(-not $hung.HasExited) foregroundChanges=$fgChanged"
"foreground transitions:"; $trans; "log:"; Get-Content $env:BOT_WATCH_LOG
if ($seen.Count) { "NEW VISIBLE WINDOWS:"; $seen.GetEnumerator() | ForEach-Object { "$($_.Value): $($_.Key)" } } else { "NEW VISIBLE WINDOWS: none" }
if (-not $hung.HasExited) { Stop-Process -Id $hung.Id }
