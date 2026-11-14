// Tests for watchdog.cmd (keeps Bot up) and autostart.ps1 (makes the scheduled task "Bot").
// watchdog.cmd is run FOR REAL, but from a copy in a temp folder, on a free port with fake servers, and with a
// harmless "start" command (it only makes a file), so the live Bot on port 3000 is never touched.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const net = require("net");
const http = require("http");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const skip = process.platform !== "win32" && "watchdog.cmd is a Windows script";

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-watchdog-"));
  fs.copyFileSync(path.join(ROOT, "watchdog.cmd"), path.join(dir, "watchdog.cmd"));
  fs.mkdirSync(path.join(dir, "data"));
  return dir;
}

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

// Runs the copied watchdog.cmd. Async on purpose: an in-process fake server must keep answering meanwhile.
function runWatchdog(dir, port) {
  const env = {
    ...process.env,
    BOT_WATCH_PORT: String(port),
    BOT_WATCH_WAIT: "1",
    BOT_WATCH_CURL: "2",
    BOT_WATCH_START: `type nul > "${path.join(dir, "started")}"`,
  };
  delete env.BOT_WATCH_LOG;
  return new Promise((resolve) => {
    const p = spawn("cmd.exe", ["/d", "/c", path.join(dir, "watchdog.cmd")], { env, cwd: dir, windowsHide: true });
    p.on("exit", (code) => resolve(code));
  });
}

const started = (dir) => fs.existsSync(path.join(dir, "started"));
const log = (dir) => { try { return fs.readFileSync(path.join(dir, "data", "bot.log"), "utf8"); } catch { return ""; } };

test("Bot answers: the watchdog does nothing and writes nothing", { skip }, async () => {
  const dir = sandbox();
  const server = http.createServer((req, res) => res.end("{}"));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const code = await runWatchdog(dir, server.address().port);
  server.close();
  assert.strictEqual(code, 0);
  assert.strictEqual(started(dir), false);
  assert.strictEqual(log(dir), "");
});

test("nothing on the port: the watchdog starts Bot and says so in bot.log", { skip }, async () => {
  const dir = sandbox();
  await runWatchdog(dir, await freePort());
  assert.strictEqual(started(dir), true);
  assert.match(log(dir), /^\d{4}-\d\d-\d\dT[\d:.]+Z \[watchdog\] Bot was not running/m);
});

test("stopped with stop-bot.cmd (data/stay-stopped): the watchdog leaves Bot stopped", { skip }, async () => {
  const dir = sandbox();
  fs.writeFileSync(path.join(dir, "data", "stay-stopped"), "");
  await runWatchdog(dir, await freePort());
  assert.strictEqual(started(dir), false);
  assert.strictEqual(log(dir), "");
});

test("hung Bot (port open, no answer): only that process is stopped, then Bot is started", { skip }, async () => {
  const dir = sandbox();
  const port = await freePort();
  // A separate node process that accepts connections and never answers, like a Bot whose event loop is stuck.
  const hung = spawn(process.execPath, ["-e", `require("net").createServer(() => {}).listen(${port}, "127.0.0.1", () => console.log("up"))`], { windowsHide: true });
  await new Promise((r) => hung.stdout.once("data", r));
  const gone = new Promise((r) => hung.on("exit", r));
  await runWatchdog(dir, port);
  await gone; // the watchdog stopped it
  assert.match(log(dir), /\[watchdog\] Bot did not answer .*hung.*Stopping node PID \d+/);
  assert.match(log(dir), /\[watchdog\] Bot's starter did not bring it back/);
  assert.strictEqual(started(dir), true);
});

test("the scheduled task runs hidden, as the user, with normal rights", () => {
  const ps = fs.readFileSync(path.join(ROOT, "autostart.ps1"), "utf8");
  assert.match(ps, /<Command>wscript\.exe<\/Command>/);
  assert.match(ps, /<Arguments>\/\/B \/\/Nologo "\$\(Esc \$vbs\)"<\/Arguments>/); // //B: no error box can pop up
  assert.match(ps, /<LogonType>InteractiveToken<\/LogonType>/);
  assert.match(ps, /<RunLevel>LeastPrivilege<\/RunLevel>/);
  assert.doesNotMatch(ps, /HighestAvailable/);
  assert.match(ps, /<Interval>PT5M<\/Interval>/);
  // the 5-minute check also starts right after install, not only at the next login (Bot stayed down a night, 2026-11-14)
  assert.match(ps, /<TimeTrigger>[\s\S]*<StartBoundary>\$start<\/StartBoundary>[\s\S]*<Interval>PT5M<\/Interval>[\s\S]*<\/TimeTrigger>/);
  assert.match(ps, /<MultipleInstancesPolicy>IgnoreNew<\/MultipleInstancesPolicy>/);
  assert.match(ps, /worktrees/); // refuses to point the task at a Claude Code worktree
  const vbs = fs.readFileSync(path.join(ROOT, "bot-watchdog.vbs"), "utf8");
  assert.match(vbs, /watchdog\.cmd""""", 0, True/); // 0 = hidden window
});

test("stop-bot.cmd leaves the stay-stopped mark and start-web.cmd clears it", () => {
  assert.match(fs.readFileSync(path.join(ROOT, "stop-bot.cmd"), "utf8"), /type nul > data\\stay-stopped/);
  assert.match(fs.readFileSync(path.join(ROOT, "start-web.cmd"), "utf8"), /if exist "data\\stay-stopped" del "data\\stay-stopped"/);
});

test("Windows scripts keep Windows line endings", () => {
  const attrs = fs.readFileSync(path.join(ROOT, ".gitattributes"), "utf8");
  for (const ext of ["cmd", "vbs", "ps1"]) assert.match(attrs, new RegExp(`\\*\\.${ext} text eol=crlf`));
});
