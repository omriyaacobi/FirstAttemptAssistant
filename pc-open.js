// pc-open.js
// OPEN something on Omri's PC: a web page in Chrome, a document in its normal app, code in VS Code, a folder in Explorer.
// Omri asked for this on 2026-11-12 ("open this on my Chrome", "open the last lecture of Calculus 2").
//
// Opening must NEVER become running a program. The rules, all in code:
//   - A closed list of types. Documents and pictures open in their normal app (OPEN_DEFAULT). Text and code files open ONLY in VS Code
//     (or Notepad), never with Windows' default action, because the default action of .py, .js, .vbs, .ps1 ... can RUN them (OPEN_EDITOR).
//     Everything else is refused: programs, scripts, shortcuts (.lnk, .url), installers, web pages saved on disk, and any type not listed.
//   - The type is judged on the file's REAL location (fs.realpathSync): a link or a shortcut-like trick called "notes.pdf" that really
//     points to cmd.exe is caught. Only plain local paths "C:\..." are accepted: no network paths (\\server\...), no "x.pdf:stream".
//   - Web pages: https only (linkfetch.checkUrl: no password in the address, no local or private hosts). Always in CHROME, where Omri is
//     logged in to Moodle (the PC's default browser may be another one).
//   - No shell. The program is started directly (child_process.spawn with shell:false and the target as ONE separate argument), so
//     characters like & | > " in a name mean nothing: there is no command line for them to break out of. Targets that start with "-"
//     or hold a quote or a control character are refused anyway, so they can never look like a switch to the program.
//   - The window opens normally on Omri's desktop even though Bot itself runs hidden: Bot's hidden console belongs to Bot only.
// WHERE a target may come from (Omri's words, a result Bot showed, Bot's own records) is checked by the brain (brain.js open_on_pc).
// Nothing here writes, deletes or changes Omri's files; a course file is opened from a COPY in a private temp folder.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn: realSpawn } = require("node:child_process");
const linkfetch = require("./linkfetch");

// Documents and pictures: opened with Windows' normal app for the type (through explorer.exe). Macro files (docm, xlsm, pptm) are NOT here.
const OPEN_DEFAULT = new Set(["pdf", "doc", "docx", "ppt", "pptx", "xls", "xlsx", "odt", "ods", "odp", "rtf", "csv", "png", "jpg", "jpeg", "gif", "webp", "bmp"]);
// Text and code: opened ONLY in an editor (VS Code, else Notepad). Their Windows default could run them.
const OPEN_EDITOR = new Set(["txt", "md", "log", "json", "yaml", "yml", "toml", "ini", "cfg", "xml", "c", "h", "cpp", "hpp", "cc", "cxx", "hh", "java", "kt", "py", "js", "mjs", "cjs", "ts", "tsx", "jsx", "css", "html", "htm", "go", "rs", "rb", "php", "cs", "sql", "s", "asm", "sh", "makefile", "cmake", "gradle", "tex", "r", "m", "hs", "scala", "swift", "lua", "pl", "vue", "svelte"]);
const NAMED_TEXT = new Set(["makefile", "dockerfile", "readme", "license", "cmakelists.txt"]);

const fail = (message, code = "refused") => Object.assign(new Error(message), { code });
const hasBad = (s) => /["\u0000-\u001f\u007f]/.test(s);
const extOf = (p) => path.extname(p).slice(1).toLowerCase();

// The programs Bot may start. Found once; a missing one is null.
function findPrograms(env = process.env, exists = fs.existsSync) {
  const first = (list) => list.filter(Boolean).find((p) => { try { return exists(p); } catch (error) { return false; } }) || null;
  const pf = env.ProgramFiles || "C:\\Program Files";
  const pf86 = env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  const local = env.LOCALAPPDATA || "";
  const win = env.SystemRoot || "C:\\Windows";
  return {
    chrome: first([path.join(pf, "Google", "Chrome", "Application", "chrome.exe"), path.join(pf86, "Google", "Chrome", "Application", "chrome.exe"), local && path.join(local, "Google", "Chrome", "Application", "chrome.exe")]),
    code: first([local && path.join(local, "Programs", "Microsoft VS Code", "Code.exe"), path.join(pf, "Microsoft VS Code", "Code.exe")]),
    notepad: first([path.join(win, "System32", "notepad.exe")]),
    explorer: first([path.join(win, "explorer.exe")]),
  };
}

// What a local path is and how it may be opened. Returns { real, kind: "folder" | "default" | "editor", name } or throws a plain reason.
function checkLocal(target) {
  const raw = String(target || "").trim();
  if (!raw) throw fail("which file or folder?");
  if (hasBad(raw)) throw fail("that path holds a character Bot does not open (a quote or a control character)");
  if (!/^[A-Za-z]:[\\/]/.test(raw)) throw fail("only a full local path like C:\\... can be opened (no network paths)");
  if (raw.indexOf(":", 2) !== -1) throw fail("that path has a hidden part after a ':', so Bot will not open it");
  let real;
  try { real = fs.realpathSync(raw); } catch (error) { throw fail("that file or folder does not exist on this computer", "missing"); }
  if (!/^[A-Za-z]:\\/.test(real) || real.indexOf(":", 2) !== -1 || hasBad(real)) throw fail("that path really points somewhere Bot does not open");
  const st = fs.statSync(real);
  const name = path.basename(real);
  if (st.isDirectory()) return { real, kind: "folder", name };
  if (!st.isFile()) throw fail("that is not a normal file");
  const ext = extOf(real);
  if (OPEN_DEFAULT.has(ext)) return { real, kind: "default", name };
  if (OPEN_EDITOR.has(ext) || NAMED_TEXT.has(name.toLowerCase())) return { real, kind: "editor", name };
  throw fail(`Bot does not open ".${ext || name}" files: it opens documents, pictures, text and code files and folders, never programs, scripts or shortcuts`);
}

// A web address Bot may open in Chrome: https, checked by linkfetch.checkUrl. Returns the normalized address.
function checkWeb(url) {
  const u = String(url || "").trim();
  if (hasBad(u) || /\s/.test(u)) throw fail("that address holds spaces or quotes");
  linkfetch.checkUrl(u); // https only, no user:password, no local or private hosts (throws with a plain reason)
  const href = new URL(u).href;
  if (!href.startsWith("https://")) throw fail("only https addresses are opened");
  return href;
}

function createOpener({ spawn = realSpawn, programs = null, tempRoot = path.join(os.tmpdir(), "bot-open"), log = () => {}, now = () => Date.now() } = {}) {
  let found = programs;
  const prog = () => (found = found || findPrograms());
  // Start a program directly: no shell, the target as one argument, not tied to Bot (detached) and not waited for.
  const start = (exe, target) => {
    if (!exe) throw fail("the program for this is not installed", "missing");
    if (String(target).startsWith("-")) throw fail("that target looks like a switch, so Bot will not pass it on");
    const child = spawn(exe, [target], { shell: false, detached: true, stdio: "ignore", windowsHide: false });
    if (child && typeof child.on === "function") child.on("error", (error) => log(`[open] ${path.basename(exe)} failed: ${error.message}`));
    if (child && typeof child.unref === "function") child.unref();
  };

  function openUrl(url) {
    const href = checkWeb(url);
    const p = prog();
    if (p.chrome) { start(p.chrome, href); return { how: "Chrome", target: href }; }
    start(p.explorer, href); // no Chrome on this PC: the default browser
    return { how: "the default browser (Chrome was not found)", target: href };
  }

  function openLocal(target) {
    const c = checkLocal(target);
    const p = prog();
    if (c.kind === "folder") { start(p.explorer, c.real); return { how: "Explorer", target: c.real, kind: c.kind }; }
    if (c.kind === "default") { start(p.explorer, c.real); return { how: "its normal app", target: c.real, kind: c.kind }; }
    if (p.code) { start(p.code, c.real); return { how: "VS Code", target: c.real, kind: c.kind }; }
    start(p.notepad, c.real);
    return { how: "Notepad", target: c.real, kind: c.kind };
  }

  // A course file Bot keeps under a random name: a COPY with its real name goes into a fresh private temp folder, and that copy opens.
  // Copies older than a day are removed the next time. Nothing of Bot's own files is ever handed to another program.
  function openCopy(original, niceName) {
    const ext = extOf(niceName) || extOf(original);
    if (!OPEN_DEFAULT.has(ext) && !OPEN_EDITOR.has(ext)) throw fail(`Bot does not open ".${ext}" files`);
    const base = String(niceName || "file").replace(/[\u0000-\u001f\u007f"<>|?*:\\/,]+/g, "_").replace(/^[-.\s]+/, "").slice(0, 120) || "file";
    const clean = extOf(base) === ext ? base : `${base}.${ext}`;
    try { // old copies go
      for (const d of fs.readdirSync(tempRoot)) { const full = path.join(tempRoot, d); try { if (now() - fs.statSync(full).mtimeMs > 24 * 3600 * 1000) fs.rmSync(full, { recursive: true, force: true }); } catch (error) { /* in use */ } }
    } catch (error) { /* no folder yet */ }
    const dir = path.join(tempRoot, crypto.randomBytes(6).toString("hex"));
    fs.mkdirSync(dir, { recursive: true });
    const copy = path.join(dir, clean);
    fs.copyFileSync(original, copy);
    const r = openLocal(copy);
    return { ...r, target: clean };
  }

  return { openUrl, openLocal, openCopy };
}

const MOODLE = "https://moodle.bgu.ac.il/moodle";
// The address of a Moodle course or item, built by CODE from whole numbers and a module name of plain letters (never from model text).
function moodleUrl({ courseId = null, cmid = null, module = null }) {
  if (cmid != null) {
    if (!Number.isInteger(cmid) || cmid <= 0 || !/^[a-z]{2,20}$/.test(String(module))) throw fail("that Moodle item is not a real item");
    return `${MOODLE}/mod/${module}/view.php?id=${cmid}`;
  }
  if (!Number.isInteger(courseId) || courseId <= 0) throw fail("that Moodle course is not a real course");
  return `${MOODLE}/course/view.php?id=${courseId}`;
}

module.exports = { createOpener, checkLocal, checkWeb, findPrograms, moodleUrl, OPEN_DEFAULT, OPEN_EDITOR, MOODLE };
