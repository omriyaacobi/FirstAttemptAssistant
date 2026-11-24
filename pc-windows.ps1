# pc-windows.ps1 - PC LOOK (pc-look.js). READ-ONLY: lists the apps with an open window, or takes a picture of ONE window.
# Started by Bot directly (powershell.exe -NoProfile -File, fixed arguments, no shell). .NET only, no package.
# It never focuses, restores, moves, closes or types into a window: PrintWindow asks the window to draw itself into a picture.
#   -Mode list                                   -> JSON [{handle, exe, title, minimized}]
#   -Mode shot -Handle N -Expect X.exe -Out F.jpg -> JSON {ok:true} or {ok:false, code: gone|changed|minimized|empty}
param(
  [ValidateSet("list", "shot")][string]$Mode = "list",
  [long]$Handle = 0,
  [string]$Expect = "",
  [string]$Out = ""
)
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) # Hebrew titles reach Bot intact, no BOM

Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class BotWin {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr p, EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int a, out int v, int size);
  public static string Title(IntPtr h) { var s = new StringBuilder(512); GetWindowText(h, s, 512); return s.ToString(); }
  public static uint Pid(IntPtr h) { uint p; GetWindowThreadProcessId(h, out p); return p; }
  // A window of the taskbar kind: visible, not owned by another window, not a tool window, not cloaked (hidden by Windows), has a title.
  public static bool Listed(IntPtr h) {
    if (!IsWindowVisible(h) || GetWindow(h, 4) != IntPtr.Zero) return false;
    if ((GetWindowLong(h, -20) & 0x80) != 0) return false;
    int cloaked = 0;
    if (DwmGetWindowAttribute(h, 14, out cloaked, 4) == 0 && cloaked != 0) return false;
    return Title(h).Length > 0;
  }
  public static List<IntPtr> TopWindows() {
    var list = new List<IntPtr>();
    EnumWindows((h, l) => { if (Listed(h)) list.Add(h); return true; }, IntPtr.Zero);
    return list;
  }
  // A Store app (Settings, Calculator) draws inside ApplicationFrameHost: its real program owns a child window.
  public static uint InnerPid(IntPtr h, uint outer) {
    uint found = 0;
    EnumChildWindows(h, (c, l) => { uint p = Pid(c); if (p != 0 && p != outer) { found = p; return false; } return true; }, IntPtr.Zero);
    return found == 0 ? outer : found;
  }
}
"@

function Get-ExeName([IntPtr]$h) {
  $pid0 = [BotWin]::Pid($h)
  try {
    $name = (Get-Process -Id $pid0).ProcessName
    if ($name -ieq "ApplicationFrameHost") { $name = (Get-Process -Id ([BotWin]::InnerPid($h, $pid0))).ProcessName }
    return "$name.exe"
  } catch { return "" }
}

if ($Mode -eq "list") {
  $rows = @()
  foreach ($h in [BotWin]::TopWindows()) {
    $exe = Get-ExeName $h
    if (-not $exe) { continue }
    $rows += [pscustomobject]@{ handle = $h.ToInt64(); exe = $exe; title = [BotWin]::Title($h); minimized = [BotWin]::IsIconic($h) }
  }
  ConvertTo-Json -InputObject @($rows) -Compress
  exit 0
}

# shot: only a window that is still the same program, listed, and not minimized. The picture goes to -Out (a .jpg in Bot's private temp folder).
function Write-Result($obj) { ConvertTo-Json -InputObject $obj -Compress; exit 0 }
if ($Handle -le 0 -or -not $Out.ToLower().EndsWith(".jpg") -or -not (Test-Path -LiteralPath (Split-Path -Parent $Out) -PathType Container)) { Write-Result @{ ok = $false; code = "args" } }
$h = [IntPtr]$Handle
if (-not [BotWin]::IsWindow($h) -or -not [BotWin]::Listed($h)) { Write-Result @{ ok = $false; code = "gone" } }
if ((Get-ExeName $h) -ine $Expect) { Write-Result @{ ok = $false; code = "changed" } }
if ([BotWin]::IsIconic($h)) { Write-Result @{ ok = $false; code = "minimized" } }
[void][BotWin]::SetProcessDPIAware() # real pixel sizes on a scaled screen (125%, 150%), so the picture is not cut off (idea from the Carbon build)
$r = New-Object BotWin+RECT
[void][BotWin]::GetWindowRect($h, [ref]$r)
$w = [Math]::Min($r.R - $r.L, 7680); $hh = [Math]::Min($r.B - $r.T, 4320)
if ($w -le 0 -or $hh -le 0) { Write-Result @{ ok = $false; code = "empty" } }
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap($w, $hh)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
try { [void][BotWin]::PrintWindow($h, $hdc, 2) } finally { $g.ReleaseHdc($hdc); $g.Dispose() } # 2 = PW_RENDERFULLCONTENT (Chrome, Store apps)
$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq "image/jpeg" }
$params = New-Object System.Drawing.Imaging.EncoderParameters(1)
$params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]80)
$bmp.Save($Out, $codec, $params)
$bmp.Dispose()
Write-Result @{ ok = $true }
