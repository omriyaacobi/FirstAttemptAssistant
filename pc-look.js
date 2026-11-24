// pc-look.js
// PC LOOK (2026-11-24, spec experiments/2026-11-24-pc-look-plan.md): Bot can SEE what is open on Omri's PC, never touch it.
//   - chrome_tabs: the title and address of every open Chrome tab (through the Bot extension in moodle-extension/, job "tabs").
//   - pc_windows: the apps with an open window, with their window titles (pc-windows.ps1 -Mode list).
//   - pc_look: ONE tab (its page text, or a picture when it is the tab in front) or ONE window (a picture, PrintWindow).
//
// The rules, all in code here:
//   - A target is a NUMBER from the LAST list Bot read (kept 2 hours). A model never hands in an address, a tab id or a window handle:
//     the real ids stay in this file.
//   - Two allowed lists in data/pc-look.json: SITES (a host, "moodle.bgu.ac.il") and APPS (a program, "Code.exe"). A look at something on
//     a list happens at once; anything else becomes a Confirm card with three choices: "Just this once", "Always allow", "Cancel".
//     The lists change only by Omri's own words (allow(): the name must be in Omri's message) or by his tap (card / Remove button).
//   - NEVER, not even on a list or with a card (NEVER_*): password managers, the browser's own pages (chrome://, edge://, about:, file:),
//     banking. Adding one to a list is refused with a plain reason.
//   - Limits: 3 looks a message (brain.js), 30 an hour (here), a picture at most 8 MB with real JPEG/PNG first bytes.
//   - A picture is kept like a photo: a private temp folder, a fixed name, deleted after the answer (brain.js removes it).
//   - Nothing here switches, focuses, moves, closes or types. A minimized window or a tab that is not in front is said plainly.
//   - The log says WHAT was looked at (a site or a program), never what it showed.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const { sniffImage } = require("./photo");

const LIST_MS = 2 * 3600 * 1000; // a numbered list is good for 2 hours (like pc_find)
const CARD_MS = 15 * 60 * 1000; // a card waits 15 minutes (like the other cards)
const GRANT_MS = 10 * 60 * 1000; // after "Just this once" the look must run within 10 minutes, once
const MAX_PENDING = 5;
const MAX_PER_HOUR = 30;
const MAX_PICTURE_BYTES = 8 * 1024 * 1024;
const MAX_TEXT = 14000; // the page text the model gets (the brain clips tool results there too)
const MAX_ITEMS = 120; // tabs or windows listed
const MAX_LIST_ENTRIES = 100; // names on one allowed list
const SCRIPT = path.join(__dirname, "pc-windows.ps1");
const SCRIPT_TIMEOUT_MS = 20 * 1000;
const STALE_MS = 3600 * 1000; // a picture folder older than this was left by a crash: deleted at the next look (idea from the other contest build)
// The extension in Chrome is still the old one (before PC LOOK): it refuses the new jobs as "unknown job" (idea from the other contest build).
const RELOAD_HINT = 'the Bot extension in Chrome is the old version: Omri must reload it once (chrome://extensions, "Bot Moodle reader", the reload arrow) before Bot can see his tabs';

// ---- never allowed ----
// Schemes: the browser's own pages and local files. Only http(s) tabs can be looked at at all.
const NEVER_SCHEMES = ["chrome:", "edge:", "about:", "file:", "chrome-extension:", "devtools:", "view-source:", "chrome-search:", "brave:", "opera:"];
// Password managers and the browsers' password pages.
const NEVER_HOSTS = ["passwords.google.com", "vault.bitwarden.com", "my.1password.com", "lastpass.com", "app.keeper.io", "nordpass.com", "dashlane.com"];
// Banking: any host with "bank" in a label, plus Israeli banks and payment sites whose names do not say "bank".
// OMRI_BANK (2026-11-25, Omri's word): his own bank, the First International Bank of Israel (הבינלאומי), and every address under it
// (www.fibi.co.il, online.fibi.co.il, ...). A host is refused when it IS one of these names or ends with "." + one of them.
const OMRI_BANK = "fibi.co.il";
const NEVER_BANK_HOSTS = [OMRI_BANK, "leumi.co.il", "mizrahi-tefahot.co.il", "mercantile.co.il", "pepper.co.il", "paypal.com", "bitpay.co.il", "max.co.il", "cal-online.co.il", "isracard.co.il"];
// A password manager judged by a WINDOW's title (a portable KeePass under another name, the Windows credential window), in English
// or Hebrew (the Hebrew names: idea from the other contest build). Not used for tabs: a page title naming one ("How to use Bitwarden") is no vault.
const PASSWORD_TITLE = /\b(1password|bitwarden|vaultwarden|keepass(xc)?|lastpass|dashlane|nordpass|enpass|roboform|proton pass|password manager|credential manager)\b|מנהל הסיסמאות|מנהל האישורים/i;
const NEVER_APPS = ["1password.exe", "bitwarden.exe", "keepass.exe", "keepassxc.exe", "lastpass.exe", "dashlane.exe", "nordpass.exe", "enpass.exe", "roboform.exe", "protonpass.exe", "keeper.exe", "credentialuibroker.exe"];
// A window picture of a browser would show whatever tab is in front (maybe a bank): browsers are looked at only tab by tab.
const BROWSER_APPS = ["chrome.exe", "msedge.exe", "firefox.exe", "brave.exe", "opera.exe", "vivaldi.exe", "iexplore.exe"];

const fail = (message, code = "refused") => Object.assign(new Error(message), { code });
const oneLine = (t, n) => String(t == null ? "" : t).replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n);

// The host of an address ("https://www.Moodle.bgu.ac.il/x" -> "moodle.bgu.ac.il"), or null when it is not an http(s) page.
function hostOf(url) {
  let u;
  try { u = new URL(String(url || "")); } catch (error) { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  return u.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "") || null;
}
const endsWithHost = (host, base) => host === base || host.endsWith("." + base);
// A site name as Omri or a model wrote it ("Moodle.BGU.ac.il", "https://youtube.com/") -> "moodle.bgu.ac.il" / "youtube.com", or null.
function cleanSite(site) {
  const s = String(site || "").trim().toLowerCase();
  if (!s || s.length > 200) return null;
  const host = /^[a-z][a-z0-9+.-]*:/.test(s) ? hostOf(s) : hostOf("https://" + s.replace(/^\/+/, ""));
  if (!host || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) || /^\d+(\.\d+)+$/.test(host)) return null; // a real name, not an IP address
  return host;
}
// A program name ("code", "Code.exe", "C:\\...\\Spotify.exe" -> "Code.exe"), or null.
function cleanApp(app) {
  const s = String(app || "").trim().split(/[\\/]/).pop();
  if (!s || s.length > 80) return null;
  const name = /\.exe$/i.test(s) ? s : s + ".exe";
  return /^[A-Za-z0-9][A-Za-z0-9 ._()+-]{0,70}\.exe$/i.test(name) ? name : null;
}

// Why an address may never be looked at (a short reason), or null.
function neverSite(url) {
  const raw = String(url || "").trim().toLowerCase();
  if (NEVER_SCHEMES.some((s) => raw.startsWith(s))) return "a browser page or a local file (chrome://, about:, file: ...) is never looked at";
  const host = hostOf(raw);
  if (!host) return "only web pages (http or https) can be looked at";
  return neverHost(host);
}
function neverHost(host) {
  const h = String(host || "").toLowerCase();
  if (NEVER_HOSTS.some((b) => endsWithHost(h, b))) return `${h} is a password manager, never looked at`;
  if (h.split(".").some((label) => label.includes("bank")) || NEVER_BANK_HOSTS.some((b) => endsWithHost(h, b))) return `${h} looks like banking, never looked at`;
  return null;
}
function neverApp(exe, title = "") {
  const e = String(exe || "").toLowerCase();
  if (NEVER_APPS.includes(e)) return `${exe} is a password manager, never looked at`;
  // A password manager inside another program (KeePass portable under another name, the Windows password window): judged by its title too.
  if (PASSWORD_TITLE.test(String(title))) return "a password manager window is never looked at";
  return null;
}

// ---- parsing what the extension and the script send (untrusted: shape checked, text cut) ----
function parseTabs(data) {
  if (!Array.isArray(data)) throw fail("the extension sent no tab list", "broken");
  const out = [];
  for (const t of data) {
    if (!t || typeof t !== "object") continue;
    const id = Number(t.id);
    if (!Number.isInteger(id) || id <= 0 || id >= 1e10) continue;
    if (t.incognito === true) continue; // a private window is never listed
    const url = String(t.url || "").slice(0, 2000);
    out.push({ kind: "tab", id, title: oneLine(t.title, 200), url, host: hostOf(url), active: t.active === true, minimized: t.windowState === "minimized" });
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}
function parseWindows(text) {
  let data;
  try { data = JSON.parse(String(text || "").replace(/^\uFEFF/, "").trim() || "[]"); } catch (error) { throw fail("the window list could not be read", "broken"); }
  if (!Array.isArray(data)) data = data && typeof data === "object" ? [data] : [];
  const out = [];
  for (const w of data) {
    if (!w || typeof w !== "object") continue;
    const handle = Number(w.handle);
    const exe = cleanApp(w.exe);
    if (!Number.isSafeInteger(handle) || handle <= 0 || !exe) continue;
    out.push({ kind: "window", handle, exe, title: oneLine(w.title, 200), minimized: w.minimized === true });
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

// The real command for the window script: powershell.exe started directly (no shell), fixed arguments, the script by its path.
// "-ExecutionPolicy Bypass" lets Windows run this one script for this one start; it changes no setting (like install-autostart.cmd).
function scriptArgs(mode, extra = []) {
  return ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", SCRIPT, "-Mode", mode, ...extra];
}
function runScript(args, { timeoutMs = SCRIPT_TIMEOUT_MS } = {}) {
  const exe = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  return new Promise((resolve, reject) => {
    execFile(exe, args, { windowsHide: true, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, encoding: "utf8", shell: false }, (error, stdout) => {
      if (error) return reject(fail(error.killed ? "the window script took too long" : "the window script failed", "script"));
      resolve(String(stdout || ""));
    });
  });
}

function createPcLook({
  dataDir, // data/: pc-look.json (the two lists) lives there
  bridge = null, // moodle-bridge.js: the Bot extension in Chrome takes the jobs "tabs", "tab_text", "tab_shot"
  run = runScript, // runs pc-windows.ps1 with fixed arguments (tests pass a fake: no real windows)
  tmpDir = os.tmpdir(),
  now = () => Date.now(),
  log = () => {},
}) {
  const file = path.join(dataDir, "pc-look.json");
  const last = { tab: null, window: null }; // { at, items } of the last list of each kind
  const pending = new Map(); // card id -> { target, how, task, questionId, lang, at }
  const grants = new Map(); // grant id -> { target, how, at }: "Just this once" / "Always allow", used once
  let looks = []; // times of the looks of the last hour

  // ---- the two lists ----
  function readLists() {
    try {
      const j = JSON.parse(fs.readFileSync(file, "utf8"));
      const sites = Array.isArray(j.sites) ? j.sites.map(cleanSite).filter(Boolean) : [];
      const apps = Array.isArray(j.apps) ? j.apps.map(cleanApp).filter(Boolean) : [];
      return { sites: [...new Set(sites)], apps: [...new Map(apps.map((a) => [a.toLowerCase(), a])).values()] };
    } catch (error) { return { sites: [], apps: [] }; }
  }
  function writeLists(lists) {
    fs.mkdirSync(dataDir, { recursive: true });
    const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ sites: lists.sites, apps: lists.apps }, null, 2));
    fs.renameSync(tmp, file); // atomic: a crash never leaves half a file
  }
  const siteAllowed = (host, lists = readLists()) => !!host && lists.sites.some((s) => endsWithHost(host, s));
  const appAllowed = (exe, lists = readLists()) => lists.apps.some((a) => a.toLowerCase() === String(exe).toLowerCase());
  // Adds or removes one name. `by`: "words" (Omri's message, checked by the brain) or "tap" (Omri's card or Remove button).
  function change({ site, app, remove = false }) {
    const lists = readLists();
    if (site !== undefined && site !== null && site !== "") {
      const host = cleanSite(site);
      if (!host) throw fail(`"${oneLine(site, 60)}" is not a site name (like moodle.bgu.ac.il)`);
      if (remove) {
        if (!lists.sites.includes(host)) return { changed: false, kind: "site", name: host, lists };
        lists.sites = lists.sites.filter((s) => s !== host);
      } else {
        const never = neverHost(host);
        if (never) throw fail(`not added: ${never}`);
        if (lists.sites.includes(host)) return { changed: false, kind: "site", name: host, lists };
        if (lists.sites.length >= MAX_LIST_ENTRIES) throw fail(`the sites list is full (${MAX_LIST_ENTRIES}); remove one first`);
        lists.sites.push(host);
      }
      writeLists(lists);
      return { changed: true, kind: "site", name: host, lists };
    }
    const exe = cleanApp(app);
    if (!exe) throw fail(`"${oneLine(app, 60)}" is not a program name (like Code.exe)`);
    const has = lists.apps.some((a) => a.toLowerCase() === exe.toLowerCase());
    if (remove) {
      if (!has) return { changed: false, kind: "app", name: exe, lists };
      lists.apps = lists.apps.filter((a) => a.toLowerCase() !== exe.toLowerCase());
    } else {
      const never = neverApp(exe) || (BROWSER_APPS.includes(exe.toLowerCase()) ? `${exe} is a browser: its tabs are looked at one by one, by site` : null);
      if (never) throw fail(`not added: ${never}`);
      if (has) return { changed: false, kind: "app", name: exe, lists };
      if (lists.apps.length >= MAX_LIST_ENTRIES) throw fail(`the apps list is full (${MAX_LIST_ENTRIES}); remove one first`);
      lists.apps.push(exe);
    }
    writeLists(lists);
    return { changed: true, kind: "app", name: exe, lists };
  }

  // pc_allow, from Omri's OWN message (brain.js passes it; the brain refuses it after a page, a photo, Moodle or a PC look).
  // The name must really be one Omri wrote. Accepted when:
  //   - a site: Omri wrote the whole host ("moodle.bgu.ac.il"), or one of his words (3+ letters) is a whole label of a host that code
  //     itself knows: a tab of the last chrome_tabs list (2 hours), or, to remove, a site on the list ("moodle" -> moodle.bgu.ac.il).
  //     So a model can never turn "allow moodle" into "moodle.evil.example".
  //   - an app: Omri wrote the program's name ("spotify" -> Spotify.exe, "Code.exe"), or one of his words (4+ letters) is part of the name
  //     of a program code knows: a window of the last pc_windows list, or, to remove, an app on the list ("settings" -> SystemSettings.exe).
  function allowFromWords({ site, app, remove = false }, words) {
    const text = String(words || "").toLowerCase();
    const mine = new Set(text.split(/[^a-z0-9\u0590-\u05ff.-]+/).flatMap((w) => [w, ...w.split(/[.-]/)]).filter((w) => w.length >= 3));
    const given = (v) => v !== undefined && v !== null && v !== "";
    const fresh = (kind) => (last[kind] && now() - last[kind].at <= LIST_MS ? last[kind].items : []);
    const lists = readLists();
    if (given(site) === given(app)) throw fail('give exactly one of "site" or "app"');
    if (given(site)) {
      const host = cleanSite(site);
      if (!host) throw fail(`"${oneLine(site, 60)}" is not a site name (like moodle.bgu.ac.il)`);
      const known = new Set([...fresh("tab").map((t) => t.host), ...(remove ? lists.sites : [])].filter(Boolean));
      const named = text.includes(host) || (known.has(host) && host.split(".").some((l) => mine.has(l)));
      if (!named) throw fail(`"${host}" is not named in Omri's own message${known.size ? "" : " (with only a short name, Bot needs a recent chrome_tabs list to know the real site)"}. Ask Omri for the full site name, or use the card's "Always allow".`);
      return change({ site: host, remove });
    }
    const exe = cleanApp(app);
    if (!exe) throw fail(`"${oneLine(app, 60)}" is not a program name (like Code.exe)`);
    const base = exe.toLowerCase().replace(/\.exe$/, "");
    const known = new Set([...fresh("window").map((w) => w.exe.toLowerCase()), ...(remove ? lists.apps.map((a) => a.toLowerCase()) : [])]);
    const named = mine.has(base) || text.includes(exe.toLowerCase()) || (known.has(exe.toLowerCase()) && [...mine].some((w) => w.length >= 4 && base.includes(w)));
    if (!named) throw fail(`"${exe}" is not named in Omri's own message. Ask Omri for the program's name, or use the card's "Always allow".`);
    return change({ app: exe, remove });
  }

  // ---- the numbered lists ----
  function keep(kind, items) { last[kind] = { at: now(), items }; return items; }
  // One job for the extension. An old extension answers the new jobs with "unknown job": said as the one step Omri must take.
  async function ask(kind, args) {
    try { return await bridge.ask(kind, args); } catch (error) {
      if (error && error.code === "refused" && /unknown job/i.test(String(error.message))) throw fail(RELOAD_HINT, "offline");
      throw error;
    }
  }
  async function tabs() {
    if (!bridge) throw fail("the Chrome extension is not set up in this Bot", "offline");
    const r = await ask("tabs", {});
    return keep("tab", parseTabs(r && r.data));
  }
  async function windows() {
    return keep("window", parseWindows(await run(scriptArgs("list"))));
  }
  // A number from the LAST list of that kind. Throws with a plain reason.
  function pick(kind, number) {
    const k = kind === "tab" || kind === "window" ? kind : null;
    if (!k) throw fail('"kind" must be "tab" or "window"');
    const n = Number(number);
    const l = last[k];
    const tool = k === "tab" ? "chrome_tabs" : "pc_windows";
    if (!l || now() - l.at > LIST_MS) throw fail(`there is no recent ${k} list: call ${tool} first, then use a number from it`);
    if (!Number.isInteger(n) || n < 1 || n > l.items.length) throw fail(`${oneLine(number, 20)} is not a number on the last ${k} list (1-${l.items.length})`);
    return l.items[n - 1];
  }
  const label = (t) => (t.kind === "tab" ? `the ${t.host || "?"} tab` : `the ${t.exe} window`);
  const nameOf = (t) => (t.kind === "tab" ? t.host || "" : t.exe);
  function listText(kind, items) {
    if (!items.length) return kind === "tab" ? "No Chrome tabs are open (or Chrome is closed)." : "No app has a window open.";
    const lists = readLists();
    const row = (t, i) => {
      const never = t.kind === "tab" ? neverSite(t.url) : neverApp(t.exe, t.title) || (BROWSER_APPS.includes(t.exe.toLowerCase()) ? "browser" : null);
      const state = t.kind === "tab" ? [t.active ? "in front" : "not in front", t.minimized ? "window minimized" : ""] : [t.minimized ? "minimized" : ""];
      const allowed = never ? (never === "browser" ? "look at its tabs instead (chrome_tabs)" : "never looked at") : (t.kind === "tab" ? siteAllowed(t.host, lists) : appAllowed(t.exe, lists)) ? "allowed" : "not on the list (a look asks Omri first)";
      const what = t.kind === "tab" ? `"${t.title}" ${t.url.slice(0, 200)}` : `${t.exe}: "${t.title}"`;
      return `${i + 1}. ${what} [${[...state, allowed].filter(Boolean).join("; ")}]`;
    };
    return items.map(row).join("\n");
  }

  // ---- looking ----
  // Is this target never allowed? (checked before a card, before a look and on what really came back)
  function neverReason(t) {
    if (t.kind === "tab") return neverSite(t.url);
    if (BROWSER_APPS.includes(t.exe.toLowerCase())) return `${t.exe} is a browser: Bot looks at its tabs one by one (chrome_tabs), so a bank or password page in front is never caught in a picture`;
    return neverApp(t.exe, t.title);
  }
  const isAllowed = (t) => (t.kind === "tab" ? siteAllowed(t.host) : appAllowed(t.exe));
  function hourCheck() {
    looks = looks.filter((t) => now() - t < 3600 * 1000);
    if (looks.length >= MAX_PER_HOUR) throw fail(`Bot already looked ${MAX_PER_HOUR} times in the last hour (the limit); try again later`, "limit");
  }
  // Picture folders a crash left behind (Bot deletes each one after its answer; a restart in the middle skips that). Only Bot's own
  // "bot-look-" folders, only older than an hour, so a look still being answered is never touched.
  function sweepStale() {
    let names = [];
    try { names = fs.readdirSync(tmpDir).filter((n) => n.startsWith("bot-look-")); } catch (error) { return; }
    for (const n of names) {
      const p = path.join(tmpDir, n);
      try { if (now() - fs.statSync(p).mtimeMs > STALE_MS) fs.rmSync(p, { recursive: true, force: true }); } catch (error) { /* in use or gone */ }
    }
  }
  // A picture's bytes -> a private folder with a fixed name. Real JPEG/PNG first bytes and 8 MB at most.
  function keepPicture(bytes) {
    if (!Buffer.isBuffer(bytes) || !bytes.length) throw fail("the picture came back empty", "broken");
    if (bytes.length > MAX_PICTURE_BYTES) throw fail("the picture is bigger than 8 MB", "broken");
    const ext = sniffImage(bytes);
    if (ext !== ".jpg" && ext !== ".png") throw fail("the picture is not a real JPEG or PNG", "broken");
    const dir = fs.mkdtempSync(path.join(tmpDir, "bot-look-"));
    const p = path.join(dir, "look" + ext);
    fs.writeFileSync(p, bytes, { flag: "wx" });
    return { path: p, dir, ext };
  }
  // Runs ONE look. how: "text" (a tab only) or "picture". Returns { kind: "text", text } | { kind: "picture", path, dir, ext } |
  // { kind: "unavailable", reason } (minimized, not in front, gone: said plainly, never worked around).
  async function look(t, how) {
    const never = neverReason(t);
    if (never) throw fail(never);
    const h = how === "text" || how === "picture" ? how : null;
    if (!h) throw fail('"how" must be "text" or "picture"');
    if (t.kind === "window" && h === "text") throw fail("a window can only be looked at as a picture");
    // Said plainly, never worked around (Bot does not restore, switch or focus anything).
    if (t.kind === "window" && t.minimized) return { kind: "unavailable", reason: `the ${t.exe} window is minimized, so Bot cannot see it (Bot never restores or switches windows)` };
    if (t.kind === "tab" && h === "picture" && (!t.active || t.minimized)) return { kind: "unavailable", reason: `the ${t.host} tab is not the one in front of a visible Chrome window, so Bot cannot take its picture (Bot never switches tabs). Its page TEXT can be read instead.` };
    if (t.kind === "tab" && !bridge) throw fail("the Chrome extension is not set up in this Bot", "offline");
    hourCheck();
    looks.push(now());
    if (h === "picture") sweepStale();
    log(`[pc-look] looking at ${label(t)} (${h})`); // what was looked at, never what it showed
    if (t.kind === "window") {
      const dir = fs.mkdtempSync(path.join(tmpDir, "bot-look-"));
      const out = path.join(dir, "look.jpg");
      try {
        let res;
        try { res = JSON.parse(String(await run(scriptArgs("shot", ["-Handle", String(t.handle), "-Expect", t.exe, "-Out", out]))).replace(/^\uFEFF/, "").trim()); } catch (error) { throw error.code ? error : fail("the window script answered nonsense", "broken"); }
        if (!res || res.ok !== true) {
          const why = { minimized: `the ${t.exe} window is minimized, so Bot cannot see it`, gone: `the ${t.exe} window is closed now (list again with pc_windows)`, changed: "that window belongs to another program now (list again with pc_windows)", empty: `the ${t.exe} window has no size (hidden?)` }[res && res.code] || "the window could not be captured";
          fs.rmSync(dir, { recursive: true, force: true });
          return { kind: "unavailable", reason: why };
        }
        const bytes = fs.readFileSync(out);
        fs.rmSync(dir, { recursive: true, force: true });
        return { kind: "picture", ...keepPicture(bytes) };
      } catch (error) { fs.rmSync(dir, { recursive: true, force: true }); throw error; }
    }
    let r;
    try { r = await ask(h === "text" ? "tab_text" : "tab_shot", { tabId: t.id }); } catch (error) {
      if (error.code === "unavailable" || error.code === "notfile") return { kind: "unavailable", reason: `${label(t)}: ${oneLine(error.message, 160)}` };
      throw error;
    }
    // What came back must still be the same site (the tab may have moved on since the list) and never a forbidden page.
    const now_ = r && r.data && typeof r.data === "object" ? r.data : {};
    const back = String(now_.url || "");
    const again = neverSite(back);
    if (again) throw fail(again);
    if (hostOf(back) !== t.host) return { kind: "unavailable", reason: `that tab shows another site now (list again with chrome_tabs); nothing of it was read` };
    if (h === "text") return { kind: "text", text: String(now_.text || "").replace(/\u0000/g, "").slice(0, MAX_TEXT), title: oneLine(now_.title, 200) };
    if (!r.file || !r.file.bytes) throw fail("the extension sent no picture", "broken");
    return { kind: "picture", ...keepPicture(r.file.bytes) };
  }
  const drop = (pic) => { if (pic && pic.dir) { try { fs.rmSync(pic.dir, { recursive: true, force: true }); } catch (error) { /* already gone */ } } };

  // ---- the Confirm card (three choices) ----
  function sweep() {
    for (const [id, p] of pending) if (now() - p.at > CARD_MS) pending.delete(id);
    for (const [id, g] of grants) if (now() - g.at > GRANT_MS) grants.delete(id);
  }
  // target: an item of a list (pick). task/questionId: Omri's message, so the look after the tap answers it. Returns the card the page draws.
  function propose(target, how, { task = "", questionId = null, lang = "en" } = {}) {
    sweep();
    const never = neverReason(target);
    if (never) throw fail(never);
    const id = crypto.randomBytes(8).toString("hex");
    pending.set(id, { target: { ...target }, how, task: String(task).slice(0, 4000), questionId, lang, at: now() });
    while (pending.size > MAX_PENDING) pending.delete(pending.keys().next().value);
    // Shown on the page as code made it: the site or program (checked), the title as data, cut.
    return { id, kind: target.kind, name: nameOf(target), title: oneLine(target.title, 120), how, expiresAt: now() + CARD_MS };
  }
  // Omri's tap: "once" | "always" | "cancel". once/always return a grant for ONE look plus the message to answer.
  function decide(id, choice) {
    sweep();
    const p = pending.get(String(id));
    if (!p) throw Object.assign(new Error("this card is no longer waiting (15 minutes pass); ask again"), { status: 404 });
    if (!["once", "always", "cancel"].includes(choice)) throw Object.assign(new Error("choose once, always or cancel"), { status: 400 });
    pending.delete(String(id)); // works once
    if (choice === "cancel") return { cancelled: true };
    let added = null;
    if (choice === "always") {
      const r = change(p.target.kind === "tab" ? { site: p.target.host } : { app: p.target.exe });
      added = r.name;
      log(`[pc-look] Omri added ${r.name} to the allowed ${r.kind}s`);
    }
    const grantId = crypto.randomBytes(8).toString("hex");
    grants.set(grantId, { target: p.target, how: p.how, at: now() });
    return { grantId, task: p.task, questionId: p.questionId, lang: p.lang, added, label: label(p.target) };
  }
  // The brain takes a grant once (a follow-up job for the tapped card).
  function takeGrant(grantId) {
    sweep();
    const g = grants.get(String(grantId || ""));
    if (!g) return null;
    grants.delete(String(grantId));
    return { target: g.target, how: g.how, label: label(g.target) };
  }

  return { readLists, change, allowFromWords, tabs, windows, pick, listText, look, drop, propose, decide, takeGrant, isAllowed, neverReason, label, nameOf };
}

module.exports = { createPcLook, parseTabs, parseWindows, neverSite, neverHost, neverApp, cleanSite, cleanApp, hostOf, scriptArgs, NEVER_SCHEMES, NEVER_HOSTS, NEVER_BANK_HOSTS, OMRI_BANK, RELOAD_HINT, STALE_MS, NEVER_APPS, BROWSER_APPS, MAX_PER_HOUR, MAX_PICTURE_BYTES, LIST_MS, CARD_MS };
