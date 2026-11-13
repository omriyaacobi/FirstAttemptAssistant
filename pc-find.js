// pc-find.js
// FIND a folder or a file on Omri's PC by name, "like Claude Code can" (Omri, 2026-11-12), so Omri never has to type a full path.
// Read-only: it only looks at NAMES. Reading what is inside a file stays with project-folder.js (a linked course folder only).
//
// The rules, all in code:
//   - Only under the ROOTS: the top folders Omri agreed to (default: Desktop, Documents, Downloads, OneDrive of this user). Omri adds or
//     removes one from chat (pc_roots); a root is added only when its whole path is in Omri's own message (checked in brain.js).
//     Saved in data/pc-roots.json. Never a whole system drive, the home folder itself, a system folder, AppData, or Bot's own folder.
//   - Never walked into: links and junctions (they could lead outside a root), hidden folders (".git", ".vscode" ...), "$" folders,
//     node_modules and other tool folders, AppData, system folders, Bot's own folder. Names that look like secrets are never listed.
//   - Limits: depth, number of folders, time and results (named constants below). Measured on this PC on 2026-11-12: the whole home
//     folder without AppData is 37 folders (5 ms) and OneDrive 139 folders (12 ms), so the disk is walked fresh each time; no index.
//   - Results are NAMES and PATHS only, numbered, and kept in memory for 2 hours, so Omri can say "open the second one" or "link the
//     first". A model only ever picks a NUMBER from this list; it never hands in a path. Names are untrusted data.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const MAX_DEPTH = 8;
const MAX_DIRS = 20000;
const MAX_MS = 3000;
const MAX_RESULTS = 20;
const MAX_LIST = 100;
const KEEP_MS = 2 * 3600 * 1000;
const SKIP_DIRS = new Set(["node_modules", "__pycache__", "appdata", "venv", "env", "site-packages", "bin", "obj", "build", "dist", "target", "out", "cmake-build-debug", "cmake-build-release"]);
const SECRET_NAME = /^\.env(\..*)?$|\.env$|\.(pem|key|pfx|p12|kdbx)$|^id_(rsa|dsa|ecdsa|ed25519)|credential|secret|token|password/i;

const fail = (message) => Object.assign(new Error(message), { code: "refused" });
const inside = (child, parent) => { const rel = path.relative(parent, child); return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel)); };
const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const oneLine = (s, n = 160) => String(s || "").replace(/[\u0000-\u001f\u007f]+/g, " ").slice(0, n);

const SYSTEM_DIRS = () => [process.env.SystemRoot, process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.ProgramData, process.env.APPDATA, process.env.LOCALAPPDATA, "C:\\Windows", "C:\\Program Files", "C:\\Program Files (x86)", "C:\\ProgramData", "/etc", "/usr", "/bin", "/var", "/proc", "/sys"].filter(Boolean);
const DEFAULT_ROOTS = (home = os.homedir()) => ["Desktop", "Documents", "Downloads", "OneDrive"].map((n) => path.join(home, n));

// Words of a name: "OS_ex3-final" -> ["os", "ex", "3", "final"]; Hebrew letters are kept together.
function tokens(s) {
  return String(s || "").toLowerCase().replace(/([a-z])(\d)|(\d)([a-z])/g, "$1$3 $2$4").split(/[^a-z0-9\u0590-\u05ff]+/).filter(Boolean);
}
function wordHits(word, toks) {
  const w = String(word).toLowerCase();
  return toks.some((t) => t === w || (w.length >= 2 && t.startsWith(w)) || (t.length >= 3 && w.startsWith(t)));
}
// How well a name (and, less, the folders above it) fits the words. 0 = not at all.
function score(words, name, parents) {
  const nameT = tokens(name);
  const pathT = tokens(parents);
  let s = 0;
  let hit = 0;
  for (const w of words) {
    if (wordHits(w, nameT)) { s += 3; hit++; } else if (wordHits(w, pathT)) { s += 1; hit++; }
  }
  if (!nameT.some((t) => words.some((w) => wordHits(w, [t])))) return 0; // the name itself must fit at least one word
  return hit ? s + (hit === words.length ? 2 : 0) : 0;
}

// appDataRule: refuse anything with an "AppData" folder in its path (tests turn it off: their temp folders live under AppData).
function createFinder({ dataDir, forbidden = [], system = SYSTEM_DIRS(), appDataRule = true, home = os.homedir(), now = () => Date.now(), limits = {} }) {
  const L = { depth: MAX_DEPTH, dirs: MAX_DIRS, ms: MAX_MS, results: MAX_RESULTS, list: MAX_LIST, ...limits };
  const file = path.join(dataDir, "pc-roots.json");
  let last = { at: 0, items: [] }; // the numbered list Omri saw last

  // Bot's own folder is blocked, but a root may HOLD it (C:\Claude Code Project): the walk just skips it.
  const blocked = (real) => system.some((s) => inside(real, s)) || forbidden.some((f) => inside(real, f)) || (appDataRule && /[\\/]appdata([\\/]|$)/i.test(real));

  function readRoots() {
    try { const r = JSON.parse(fs.readFileSync(file, "utf8")); if (Array.isArray(r.roots)) return r.roots.map(String); } catch (error) { /* not set yet */ }
    return DEFAULT_ROOTS(home);
  }
  const liveRoots = () => readRoots().map((r) => { try { return fs.realpathSync(r); } catch (error) { return null; } }).filter((r) => r && !blocked(r));

  // Is this a folder Omri may add as a root? Returns its real path or throws a plain reason.
  function checkRoot(text) {
    const raw = String(text || "").trim().replace(/^["']|["']$/g, "");
    if (!raw || !path.isAbsolute(raw)) throw fail("that is not a full folder path (for example D:\\university)");
    let real;
    try { real = fs.realpathSync(raw); } catch (error) { throw fail(`the folder "${oneLine(raw, 120)}" does not exist on this computer`); }
    if (!fs.statSync(real).isDirectory()) throw fail("that path is a file, not a folder");
    const sysDrive = path.parse(process.env.SystemRoot || "C:\\Windows").root.toLowerCase();
    if (path.parse(real).root === real && real.toLowerCase() === sysDrive) throw fail("the whole system drive cannot be a search root; choose a folder in it");
    if (same(real, home)) throw fail("the whole home folder cannot be a root (it holds AppData); add Desktop, Documents or a project folder instead");
    if (blocked(real)) throw fail("a system folder, AppData or Bot's own folder cannot be a search root");
    return real;
  }
  function setRoots(list) {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(file + ".tmp", JSON.stringify({ roots: list }, null, 2)); // a temporary file renamed into place: a crash never leaves half a file
    fs.renameSync(file + ".tmp", file);
  }
  function addRoot(text) {
    const real = checkRoot(text);
    const roots = readRoots();
    if (roots.some((r) => same(r, real))) return { added: false, real, roots };
    setRoots([...roots, real]);
    return { added: true, real, roots: [...roots, real] };
  }
  function removeRoot(text) {
    const want = String(text || "").trim().replace(/^["']|["']$/g, "");
    const roots = readRoots();
    const keep = roots.filter((r) => !same(r, want) && path.basename(r).toLowerCase() !== want.toLowerCase());
    if (keep.length === roots.length) throw fail(`"${oneLine(want, 80)}" is not a search root. The roots: ${roots.join("; ")}`);
    setRoots(keep);
    return { roots: keep };
  }

  // Walk the roots and keep what fits the words. kind: "folder" | "file" | "any".
  function find(words, { kind = "any" } = {}) {
    const ws = [...new Set((Array.isArray(words) ? words : String(words || "").split(/\s+/)).flatMap((w) => tokens(w)))].slice(0, 12);
    if (!ws.length) throw fail("what should Bot look for? Give a few words of the name");
    const t0 = now();
    let dirs = 0;
    let cut = false;
    const hits = [];
    for (const root of liveRoots()) {
      const stack = [[root, 0]];
      while (stack.length) {
        if (dirs >= L.dirs || now() - t0 > L.ms) { cut = true; break; }
        const [dir, depth] = stack.pop();
        let ents;
        try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (error) { continue; }
        dirs++;
        const parents = path.relative(root, dir);
        for (const e of ents) {
          if (e.isSymbolicLink()) continue; // links and junctions are never followed or shown
          const name = e.name;
          if (name.startsWith(".") || name.startsWith("$") || SECRET_NAME.test(name)) continue;
          const full = path.join(dir, name);
          if (e.isDirectory()) {
            if (SKIP_DIRS.has(name.toLowerCase()) || blocked(full)) continue;
            if (kind !== "file") { const s = score(ws, name, parents); if (s) hits.push({ kind: "folder", path: full, name, s, depth }); }
            if (depth < L.depth) stack.push([full, depth + 1]);
          } else if (e.isFile() && kind !== "folder") {
            const s = score(ws, name, parents);
            if (s) hits.push({ kind: "file", path: full, name, s, depth });
          }
        }
      }
    }
    hits.sort((a, b) => b.s - a.s || a.depth - b.depth || a.path.localeCompare(b.path));
    const items = hits.slice(0, L.results).map((h, i) => ({ n: i + 1, kind: h.kind, path: h.path, name: h.name }));
    last = { at: now(), items };
    return { items, more: hits.length > items.length, cut, roots: liveRoots(), ms: now() - t0 };
  }

  // What is inside one folder of the last list (names only). Its entries become the new numbered list.
  function list(n) {
    const item = pick(n);
    if (item.kind !== "folder") throw fail(`number ${n} is a file, not a folder`);
    let ents = [];
    try { ents = fs.readdirSync(item.path, { withFileTypes: true }); } catch (error) { throw fail("that folder could not be read"); }
    const items = [];
    let more = false;
    for (const e of ents.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))) {
      if (e.isSymbolicLink() || e.name.startsWith(".") || e.name.startsWith("$") || SECRET_NAME.test(e.name)) continue;
      const full = path.join(item.path, e.name);
      if (e.isDirectory() && (SKIP_DIRS.has(e.name.toLowerCase()) || blocked(full))) continue;
      if (!e.isDirectory() && !e.isFile()) continue;
      if (items.length >= L.list) { more = true; break; }
      items.push({ n: items.length + 1, kind: e.isDirectory() ? "folder" : "file", path: full, name: e.name });
    }
    last = { at: now(), items };
    return { folder: item.path, items, more };
  }

  // One item of the list Omri saw last, checked AGAIN: still there, still inside a root, still not a link.
  function pick(n) {
    const k = Number(n);
    if (!Number.isInteger(k) || k < 1) throw fail("say which number of the list");
    if (!last.items.length || now() - last.at > KEEP_MS) throw fail("there is no recent search result list; search again first (pc_find)");
    const item = last.items.find((x) => x.n === k);
    if (!item) throw fail(`the last list has only ${last.items.length} item(s)`);
    let real;
    try { real = fs.realpathSync(item.path); } catch (error) { throw fail("that item is no longer on the computer"); }
    if (!same(real, item.path)) throw fail("that item is a link to another place, so Bot will not use it");
    if (blocked(real) || !liveRoots().some((r) => inside(real, r))) throw fail("that item is no longer inside a search root");
    return { ...item, path: real };
  }

  const text = (items) => items.map((x) => `${x.n}. [${x.kind}] ${oneLine(x.name, 120)} - ${oneLine(x.path, 240)}`).join("\n");
  return { find, list, pick, text, roots: readRoots, addRoot, removeRoot, checkRoot };
}

module.exports = { createFinder, tokens, score, DEFAULT_ROOTS, MAX_DEPTH, MAX_DIRS, MAX_MS, MAX_RESULTS };
