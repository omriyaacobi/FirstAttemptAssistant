// project-folder.js
// A course can have a LINKED FOLDER: the folder on this computer where Omri works on its assignment (the code VS Code has open).
// Bot may LIST it and READ text files in it, so it can see the real Makefile, the real MemoryBlock.cpp, and help like a tool that sits
// in the project. That is all it can do. Everything here is read-only and checked by code:
//   - the folder must be a real folder, not a drive root, not the home folder itself, not a system folder, not Bot's own project;
//   - a file is read only if its real location is inside the linked folder (no "..", no link that points outside);
//   - only text, at most 200 KB a file; secrets by name (.env, keys, credentials) are never read; .git and node_modules are not listed.
// File text is DATA for the model, never instructions. Nothing in this file writes, deletes or runs anything.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const MAX_FILE_BYTES = 200 * 1024;
const MAX_ENTRIES = 400; // files listed at most
const MAX_DEPTH = 6;
const SKIP_DIRS = new Set([".git", "node_modules", "__pycache__", ".idea", ".vs", ".gradle", ".cache"]);
const SECRET_NAME = /^\.env(\..*)?$|\.(pem|key|pfx|p12|kdbx)$|^id_(rsa|dsa|ecdsa|ed25519)|credential|secret|token|password/i;
const BINARY_EXT = /\.(o|a|so|dll|exe|class|pyc|jar|zip|gz|tar|7z|png|jpe?g|gif|webp|ico|pdf|docx?|pptx?|xlsx?|bin|obj|lib|pdb)$/i;

const fail = (message) => new Error(message);
const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const inside = (child, parent) => { const rel = path.relative(parent, child); return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel)); };

// Is this a folder Bot may link? Returns its real absolute path, or throws a plain reason. forbidden: folders Bot must never link (its own project).
// system: folders of the operating system (a parameter so a test can link a temporary folder, which lives under AppData on Windows).
const SYSTEM_DIRS = () => [process.env.SystemRoot, process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.APPDATA, process.env.LOCALAPPDATA, "/etc", "/usr", "/bin", "/var"].filter(Boolean);
function checkFolder(text, { forbidden = [], system = SYSTEM_DIRS() } = {}) {
  const raw = String(text || "").trim().replace(/^["']|["']$/g, "");
  if (!raw || !path.isAbsolute(raw)) throw fail("that is not a full folder path (for example C:\\Users\\me\\projects\\assignment1)");
  let real;
  try { real = fs.realpathSync(raw); } catch (error) { throw fail(`the folder "${raw.slice(0, 120)}" does not exist on this computer`); }
  if (!fs.statSync(real).isDirectory()) throw fail("that path is a file, not a folder");
  if (path.parse(real).root === real) throw fail("a whole drive cannot be linked; choose the assignment's own folder");
  if (same(real, os.homedir())) throw fail("the home folder itself cannot be linked; choose the assignment's own folder");
  if (system.some((s) => inside(real, s))) throw fail("a system folder cannot be linked");
  if (forbidden.some((f) => inside(real, f) || inside(f, real))) throw fail("Bot's own folder cannot be linked");
  return real;
}

// The files of the folder: [{ rel, bytes, mtime }], newest first is NOT applied here (sorted by path). Skips links, hidden tool folders and binaries.
function listFiles(root) {
  const out = [];
  let more = false;
  const walk = (dir, depth) => {
    let names = [];
    try { names = fs.readdirSync(dir); } catch (error) { return; }
    for (const name of names.sort()) {
      if (out.length >= MAX_ENTRIES) { more = true; return; }
      const full = path.join(dir, name);
      let st;
      try { st = fs.lstatSync(full); } catch (error) { continue; }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) { if (!SKIP_DIRS.has(name) && depth < MAX_DEPTH) walk(full, depth + 1); continue; }
      if (!st.isFile() || BINARY_EXT.test(name) || SECRET_NAME.test(name)) continue;
      out.push({ rel: path.relative(root, full).split(path.sep).join("/"), bytes: st.size, mtime: st.mtimeMs });
    }
  };
  walk(root, 0);
  return { files: out, more };
}

// The text of one file of the folder. `rel` is a path inside it ("src/MemoryBlock.cpp"), or just a file name that exists once.
function readFile(root, rel) {
  let want = String(rel || "").trim().replace(/\\/g, "/").replace(/^\.?\//, "");
  if (!want) throw fail("which file?");
  let full = path.resolve(root, want);
  if (!inside(full, root) || !fs.existsSync(full)) {
    const base = want.split("/").pop().toLowerCase();
    const hits = listFiles(root).files.filter((f) => f.rel.toLowerCase() === want.toLowerCase() || f.rel.split("/").pop().toLowerCase() === base);
    if (hits.length !== 1) throw fail(hits.length ? `several files are called "${base}": ${hits.slice(0, 6).map((h) => h.rel).join(", ")}` : `there is no file "${want.slice(0, 120)}" in the linked folder`);
    want = hits[0].rel;
    full = path.resolve(root, want);
  }
  let real;
  try { real = fs.realpathSync(full); } catch (error) { throw fail(`there is no file "${want.slice(0, 120)}" in the linked folder`); }
  if (!inside(real, fs.realpathSync(root))) throw fail("that file is outside the linked folder, so Bot will not read it");
  const st = fs.statSync(real);
  if (!st.isFile()) throw fail("that is a folder, not a file");
  if (SECRET_NAME.test(path.basename(real))) throw fail("Bot never reads files that look like secrets (.env, keys, credentials)");
  if (st.size > MAX_FILE_BYTES) throw fail(`that file is larger than ${MAX_FILE_BYTES / 1024} KB`);
  const bytes = fs.readFileSync(real);
  if (bytes.includes(0)) throw fail("that file is not text");
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch (error) { throw fail("that file is not text"); }
  return { rel: want, text, bytes: st.size, mtime: st.mtimeMs };
}

// THE PARENT FOLDER (2026-11-13). Omri linked .../operation_b7/mission1, moved on to mission2 and said "check my function": the file is
// one folder up, next to the linked one. findInParent looks ONLY in the linked folder's parent (one level, never higher) for files with
// the asked name. It returns { parent, hits: ["mission2/agents.c", ...] } or null. It never links anything: brain.js turns a hit into a
// Confirm card, and only Omri's tap changes the link. The parent must pass checkFolder (no drive root, home, system or Bot folder), and
// a Linux home (/home/<user>, also inside WSL: \\wsl.localhost\<distro>\home\<user>) or /home itself is refused too: too wide to link.
const LINUX_HOME = /^(?:\\\\wsl(?:\.localhost|\$)\\[^\\]+)?[\\/]home(?:[\\/][^\\/]+)?[\\/]?$/i;
function findInParent(root, rel, rules = {}) {
  const want = String(rel || "").trim().replace(/\\/g, "/").replace(/^\.?\//, "").toLowerCase();
  const base = want.split("/").pop();
  if (!base || base === ".." || base === ".") return null;
  let linked;
  try { linked = fs.realpathSync(root); } catch (error) { return null; }
  const parent = path.dirname(linked);
  if (same(parent, linked) || LINUX_HOME.test(parent)) return null;
  let real;
  try { real = checkFolder(parent, rules); } catch (error) { return null; }
  if (LINUX_HOME.test(real)) return null;
  const hits = listFiles(real).files.map((f) => f.rel).filter((r) => r.toLowerCase() === want || r.toLowerCase().endsWith("/" + want) || r.split("/").pop().toLowerCase() === base);
  return hits.length ? { parent: real, hits: hits.slice(0, 6) } : null;
}

// FIND BY CONTENT (2026-11-13): "the file with find_agent". Only inside the linked folder, only files readFile may read (text, 200 KB,
// never secrets), newest first, at most MAX_GREP_BYTES read in all and MAX_GREP_HITS lines back. Plain text, not a regex: a model's
// words can never become a pattern that hangs. Returns { hits: [{ rel, line, text }], files, cut }.
const MAX_GREP_HITS = 40;
const MAX_GREP_BYTES = 5 * 1024 * 1024;
function grepFiles(root, text) {
  const want = String(text || "").replace(/[\u0000-\u001f\u007f]/g, "").trim().toLowerCase().slice(0, 100);
  if (want.length < 2) throw fail("what text should Bot look for? Give at least 2 letters");
  const hits = [];
  const found = new Set();
  let read = 0;
  let cut = false;
  for (const f of [...listFiles(root).files].sort((a, b) => b.mtime - a.mtime)) {
    if (f.bytes > MAX_FILE_BYTES) continue;
    if (read + f.bytes > MAX_GREP_BYTES) { cut = true; break; }
    let body;
    try { body = readFile(root, f.rel).text; } catch (error) { continue; }
    read += f.bytes;
    const lines = body.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].toLowerCase().includes(want)) continue;
      if (hits.length >= MAX_GREP_HITS) { cut = true; break; }
      hits.push({ rel: f.rel, line: i + 1, text: lines[i].replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 200) });
      found.add(f.rel);
    }
    if (cut) break;
  }
  return { hits, files: found.size, cut };
}

// WHERE OMRI WORKS NOW (2026-11-13), from file times only, never a model:
//   inLinked: the top folder inside the linked folder that holds the file changed last ("mission2" when operation_b7 is linked);
//   sibling:  a folder NEXT TO the linked one whose newest file is newer than anything in the linked folder (Omri moved on from
//             mission1 to mission2), with up to 6 of its file NAMES (newest first) so project_read can ask for one, which shows the
//             parent-folder card. Names and times only; contents next to the linked folder are never read here.
// The parent walk is cached for a minute (it is about 0.15 s over WSL). Returns { inLinked, sibling } (each may be null).
const SIBLING_CACHE_MS = 60 * 1000;
const siblingCache = new Map();
function workingNow(root, rules = {}, now = Date.now()) {
  const out = { inLinked: null, sibling: null };
  let linked;
  try { linked = fs.realpathSync(root); } catch (error) { return out; }
  const own = listFiles(linked).files;
  const newestOwn = own.reduce((m, f) => (f.mtime > m.mtime ? f : m), { mtime: 0 });
  if (newestOwn.rel) out.inLinked = { folder: newestOwn.rel.includes("/") ? newestOwn.rel.split("/")[0] : "", rel: newestOwn.rel, mtime: newestOwn.mtime };
  const parent = path.dirname(linked);
  if (same(parent, linked) || LINUX_HOME.test(parent)) return out;
  let real;
  try { real = checkFolder(parent, rules); } catch (error) { return out; }
  const key = real.toLowerCase();
  let files = null;
  const hit = siblingCache.get(key);
  if (hit && now - hit.at < SIBLING_CACHE_MS) files = hit.files; else { files = listFiles(real).files; siblingCache.set(key, { at: now, files }); }
  const mine = path.basename(linked).toLowerCase();
  const bySib = new Map();
  for (const f of files) {
    if (!f.rel.includes("/")) continue;
    const top = f.rel.split("/")[0];
    if (top.toLowerCase() === mine) continue;
    if (!bySib.has(top)) bySib.set(top, []);
    bySib.get(top).push(f);
  }
  let best = null;
  for (const [folder, list] of bySib) {
    const newest = Math.max(...list.map((f) => f.mtime));
    if (newest > newestOwn.mtime && (!best || newest > best.mtime)) best = { folder, mtime: newest, files: list.sort((a, b) => b.mtime - a.mtime).slice(0, 6).map((f) => f.rel) };
  }
  out.sibling = best;
  return out;
}

// Line numbers, so an answer can say "line 42".
const numbered = (text) => String(text).replace(/\r\n/g, "\n").split("\n").map((l, i) => `${i + 1}: ${l}`).join("\n");

module.exports = { checkFolder, listFiles, readFile, findInParent, grepFiles, workingNow, LINUX_HOME, numbered, MAX_GREP_HITS, MAX_FILE_BYTES, MAX_ENTRIES, SKIP_DIRS };
