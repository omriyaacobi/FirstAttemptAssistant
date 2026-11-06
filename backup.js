// backup.js
// Encrypted backup of data/ (chats, course files, memory, Google login...) into a folder that a sync
// app (OneDrive / Google Drive for desktop) uploads for you, so everything survives if this PC fails.
//
// HOW IT WORKS, in plain English:
//   1. Every file in data/ is read and listed with its size and a SHA-256 fingerprint (a hash: a short
//      number that changes if even one byte of the file changes). Hashes are how we PROVE a restore is exact.
//   2. Everything is packed into ONE buffer, compressed (gzip), then ENCRYPTED with AES-256-GCM.
//      GCM also adds a tag that detects tampering or a wrong passphrase. The key is made from your
//      passphrase with scrypt (a deliberately slow function, so guessing passphrases is slow).
//   3. The result is written as "name.tmp" and renamed when complete, so the sync app never uploads a half file.
//   4. Bot reads the new file back, decrypts it and checks every hash BEFORE it deletes any old copy.
//   5. Only the newest few copies are kept (BOT_BACKUP_KEEP, default 5).
//
// WHY ENCRYPT: data/ holds Google login tokens and private chats, and the cloud folder belongs to a
// third party. With encryption, the cloud only ever sees scrambled bytes. The passphrase lives in .env
// (BOT_BACKUP_PASSPHRASE) - and .env is lost if this PC dies, so ALSO keep the passphrase somewhere else
// (password manager or paper). Without it the backup cannot be opened by anyone, including you.
//
// SAFETY: this module only READS data/. It never deletes or changes anything there (its own status
// file and log are the only things written inside data/). Restore refuses to write into data/ or into
// a folder that already has files. Built-in Node modules only.
//
// Use:  node backup.js run | status | verify | restore <backup-file> <empty-folder>

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const zlib = require("node:zlib");
const { promisify } = require("node:util");

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);
const scrypt = promisify(crypto.scrypt);

const MAGIC = Buffer.from("BOTBK1"); // file type marker + format version
const ARCHIVE_MAGIC = Buffer.from("BKD1");
const SALT_LEN = 16, IV_LEN = 12, TAG_LEN = 16;
const NAME_PATTERN = /^bot-backup-\d{8}-\d{6}\.botbak$/; // only files with this name are ever pruned
const MAX_TOTAL_BYTES = 1024 * 1024 * 1024; // the whole backup is built in memory, so refuse above 1 GB
const MIN_PASSPHRASE = 12;
const DAY_MS = 24 * 60 * 60 * 1000;
const RETRY_MS = 60 * 60 * 1000; // after a failure, try again after an hour
const STATUS_NAME = "backup-status.json";
const LOG_NAME = "backup.log";
const SKIP_NAMES = new Set([STATUS_NAME, LOG_NAME]); // our own bookkeeping, not worth backing up

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

// ---------- settings (.env) ----------

function loadBackupConfig(envFile) {
  let env = {};
  try { env = require("./auth").parseEnv(fs.readFileSync(envFile, "utf8")); } catch (error) { /* no .env */ }
  const dir = String(env.BOT_BACKUP_DIR || "").trim();
  const passphrase = String(env.BOT_BACKUP_PASSPHRASE || "");
  const keepNum = Number(env.BOT_BACKUP_KEEP);
  const keep = Number.isInteger(keepNum) && keepNum >= 1 && keepNum <= 50 ? keepNum : 5;
  if (!dir) return { enabled: false, reason: "BOT_BACKUP_DIR is not set in .env" };
  if (passphrase.length < MIN_PASSPHRASE) return { enabled: false, reason: `BOT_BACKUP_PASSPHRASE must be at least ${MIN_PASSPHRASE} characters in .env` };
  return { enabled: true, dir: path.resolve(dir), passphrase, keep };
}

const isInside = (child, parent) => {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

// The backup folder must never be inside the project (it is a public GitHub repo) or inside data/ itself.
function checkDestination(destDir, { dataDir, repoDir }) {
  if (isInside(destDir, dataDir)) return "the backup folder is inside data/";
  if (repoDir && isInside(destDir, repoDir)) return "the backup folder is inside the Bot project folder (a public GitHub repo)";
  return null;
}

// ---------- packing ----------

async function listFiles(dataDir) {
  const out = [];
  async function walk(rel) {
    const entries = await fsp.readdir(path.join(dataDir, rel), { withFileTypes: true });
    for (const entry of entries) {
      const relPath = rel ? rel + "/" + entry.name : entry.name;
      if (entry.isDirectory()) await walk(relPath);
      else if (entry.isFile() && !(rel === "" && SKIP_NAMES.has(entry.name)) && !entry.name.endsWith(".tmp")) out.push(relPath);
      // links and other special files are skipped on purpose
    }
  }
  await walk("");
  return out.sort();
}

// One buffer: ARCHIVE_MAGIC, manifest length, manifest JSON, then every file's bytes in manifest order.
async function buildArchive(dataDir, now = new Date()) {
  const names = await listFiles(dataDir);
  const files = [], chunks = [];
  let total = 0;
  for (const name of names) {
    let data;
    try { data = await fsp.readFile(path.join(dataDir, name)); } catch (error) {
      if (error.code === "ENOENT") continue; // deleted while we were reading: fine, skip it
      throw error;
    }
    total += data.length;
    if (total > MAX_TOTAL_BYTES) throw new Error("data/ is bigger than 1 GB; the backup is built in memory and refuses this (needs a streaming version)");
    files.push({ path: name, size: data.length, sha256: sha256(data) });
    chunks.push(data);
    await new Promise((resolve) => setImmediate(resolve)); // let Bot answer messages between files
  }
  const manifest = Buffer.from(JSON.stringify({ version: 1, created: now.toISOString(), files }));
  const head = Buffer.alloc(8);
  ARCHIVE_MAGIC.copy(head, 0);
  head.writeUInt32BE(manifest.length, 4);
  return { buffer: Buffer.concat([head, manifest, ...chunks]), fileCount: files.length, totalBytes: total };
}

// Reads the archive back and checks every file's size and hash. Returns the files (path + bytes).
function parseArchive(buf) {
  if (buf.length < 8 || !buf.subarray(0, 4).equals(ARCHIVE_MAGIC)) throw new Error("not a Bot backup (bad inner header)");
  const mlen = buf.readUInt32BE(4);
  if (8 + mlen > buf.length) throw new Error("backup is damaged (manifest cut off)");
  const manifest = JSON.parse(buf.subarray(8, 8 + mlen).toString("utf8"));
  if (!manifest || manifest.version !== 1 || !Array.isArray(manifest.files)) throw new Error("backup has an unknown format");
  let pos = 8 + mlen;
  const files = [];
  for (const f of manifest.files) {
    if (typeof f.path !== "string" || !Number.isInteger(f.size) || f.size < 0) throw new Error("backup manifest is damaged");
    const data = buf.subarray(pos, pos + f.size);
    if (data.length !== f.size) throw new Error(`backup is damaged (file ${f.path} cut off)`);
    if (sha256(data) !== f.sha256) throw new Error(`backup is damaged (checksum mismatch on ${f.path})`);
    files.push({ path: f.path, data });
    pos += f.size;
  }
  if (pos !== buf.length) throw new Error("backup is damaged (extra bytes at the end)");
  return { created: manifest.created, files };
}

// ---------- encryption ----------

async function encrypt(plain, passphrase) {
  const salt = crypto.randomBytes(SALT_LEN), iv = crypto.randomBytes(IV_LEN);
  const key = await scrypt(passphrase, salt, 32);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(MAGIC); // the header is covered by the tag too
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, body, cipher.getAuthTag()]);
}

async function decrypt(file, passphrase) {
  const min = MAGIC.length + SALT_LEN + IV_LEN + TAG_LEN;
  if (file.length < min || !file.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("this is not a Bot backup file");
  let p = MAGIC.length;
  const salt = file.subarray(p, p += SALT_LEN), iv = file.subarray(p, p += IV_LEN);
  const body = file.subarray(p, file.length - TAG_LEN), tag = file.subarray(file.length - TAG_LEN);
  const key = await scrypt(passphrase, salt, 32);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(MAGIC);
  decipher.setAuthTag(tag);
  try { return Buffer.concat([decipher.update(body), decipher.final()]); } catch (error) {
    throw new Error("wrong passphrase, or the backup file is damaged");
  }
}

// ---------- status + log ----------

const readStatus = (dataDir) => {
  try { return JSON.parse(fs.readFileSync(path.join(dataDir, STATUS_NAME), "utf8")); } catch (error) { return {}; }
};

function writeStatus(dataDir, patch) {
  const file = path.join(dataDir, STATUS_NAME);
  const next = { ...readStatus(dataDir), ...patch };
  fs.writeFileSync(file + ".tmp", JSON.stringify(next, null, 2));
  fs.renameSync(file + ".tmp", file);
  return next;
}

function appendLog(dataDir, line) {
  const file = path.join(dataDir, LOG_NAME);
  try {
    let old = "";
    try { old = fs.readFileSync(file, "utf8"); } catch (error) { /* first line */ }
    let lines = (old + `${new Date().toISOString()} ${line}\n`).split("\n");
    if (lines.length > 300) lines = lines.slice(-200); // keep the log short
    fs.writeFileSync(file, lines.join("\n"));
  } catch (error) { /* logging must never break a backup */ }
}

// ---------- run, prune, restore ----------

const stamp = (d) => d.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);

async function listBackups(destDir) {
  try { return (await fsp.readdir(destDir)).filter((n) => NAME_PATTERN.test(n)).sort(); } catch (error) { return []; }
}

// Deletes the oldest copies beyond `keep`. Only files with our own name pattern, only in the backup folder.
async function pruneBackups(destDir, keep) {
  const all = await listBackups(destDir);
  const old = all.slice(0, Math.max(0, all.length - keep));
  for (const name of old) await fsp.rm(path.join(destDir, name), { force: true });
  return old;
}

// Makes one backup. Never throws: the result says ok or not, and the status file/log record it.
async function runBackup({ dataDir, destDir, passphrase, keep = 5, repoDir, now = new Date(), log = () => {} }) {
  const attempt = now.toISOString();
  try {
    const bad = checkDestination(destDir, { dataDir, repoDir });
    if (bad) throw new Error(bad);
    if (typeof passphrase !== "string" || passphrase.length < MIN_PASSPHRASE) throw new Error("passphrase missing or too short");
    // Create only the last folder level: if the drive or cloud folder is missing we want an error, not a stray folder.
    try { await fsp.mkdir(destDir); } catch (error) {
      if (error.code === "EEXIST") { /* fine */ } else if (error.code === "ENOENT") throw new Error("the backup folder's parent does not exist (is the drive or the sync app missing?)");
      else throw error;
    }
    const { buffer, fileCount, totalBytes } = await buildArchive(dataDir, now);
    const packed = await gzip(buffer);
    const encrypted = await encrypt(packed, passphrase);
    const name = `bot-backup-${stamp(now)}.botbak`;
    const finalPath = path.join(destDir, name), tmpPath = finalPath + ".tmp";
    await fsp.writeFile(tmpPath, encrypted);
    await fsp.rename(tmpPath, finalPath);
    // PROVE it: read the file back from disk, decrypt, unzip, check every fingerprint.
    const back = parseArchive(await gunzip(await decrypt(await fsp.readFile(finalPath), passphrase)));
    if (back.files.length !== fileCount) throw new Error("check-back found a different number of files");
    const removed = await pruneBackups(destDir, keep);
    const status = writeStatus(dataDir, { lastAttempt: attempt, lastSuccess: attempt, ok: true, error: null, file: name, bytes: encrypted.length, fileCount, dataBytes: totalBytes, pruned: removed.length });
    const line = `backup ok: ${name}, ${fileCount} files, ${encrypted.length} bytes, ${removed.length} old copies removed`;
    appendLog(dataDir, line); log("[backup] " + line);
    return { ok: true, name, path: finalPath, fileCount, bytes: encrypted.length, status };
  } catch (error) {
    const message = String(error.message || error);
    try { writeStatus(dataDir, { lastAttempt: attempt, ok: false, error: message }); } catch (e) { /* data/ not writable */ }
    appendLog(dataDir, "backup FAILED: " + message); log("[backup] FAILED: " + message);
    return { ok: false, error: message };
  }
}

// Writes the files of one backup into an EMPTY folder that is not data/. Returns the file list.
async function restoreBackup({ file, passphrase, targetDir, dataDir }) {
  const target = path.resolve(targetDir);
  if (dataDir && isInside(target, dataDir)) throw new Error("refusing to restore into data/ (restore into a new empty folder, then copy by hand)");
  try {
    if ((await fsp.readdir(target)).length) throw new Error("the target folder is not empty");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const { files } = parseArchive(await gunzip(await decrypt(await fsp.readFile(file), passphrase)));
  for (const f of files) {
    const out = path.resolve(target, ...f.path.split("/"));
    if (!isInside(out, target) || out === target) throw new Error("backup contains an unsafe path: " + f.path); // blocks "../" tricks
  }
  for (const f of files) {
    const out = path.resolve(target, ...f.path.split("/"));
    await fsp.mkdir(path.dirname(out), { recursive: true });
    await fsp.writeFile(out, f.data);
  }
  return files.map((f) => f.path);
}

// Compares two folders by file list and fingerprints (read-only).
async function compareDirs(a, b) {
  const [fa, fb] = [await listFiles(a), await listFiles(b)];
  const sa = new Set(fa), sb = new Set(fb);
  const same = [], changed = [], onlyA = fa.filter((n) => !sb.has(n)), onlyB = fb.filter((n) => !sa.has(n));
  for (const n of fa) {
    if (!sb.has(n)) continue;
    const [x, y] = [await fsp.readFile(path.join(a, n)), await fsp.readFile(path.join(b, n))];
    (x.equals(y) ? same : changed).push(n);
  }
  return { same, changed, onlyA, onlyB };
}

// ---------- schedule ----------

// Time for a backup? Yes if there has never been one, the last good one is over a day old, and
// (after a failure) an hour has passed since the last try.
function isDue(status, nowMs = Date.now()) {
  const last = Date.parse(status && status.lastSuccess);
  const tried = Date.parse(status && status.lastAttempt);
  if (Number.isFinite(last) && nowMs - last < DAY_MS) return false;
  if (status && status.ok === false && Number.isFinite(tried) && nowMs - tried < RETRY_MS) return false;
  return true;
}

// Starts the schedule inside Bot: first check 2 minutes after start (never delays start-up), then hourly.
// All work is asynchronous (files are read one at a time between event-loop turns), so chats stay responsive.
function createBackupScheduler({ dataDir, repoDir, config, log = console.log, firstDelayMs = 2 * 60 * 1000, checkEveryMs = 60 * 60 * 1000 }) {
  let running = false, timers = [];
  async function tick() {
    if (running || !config.enabled || !isDue(readStatus(dataDir))) return;
    running = true;
    try { await runBackup({ dataDir, destDir: config.dir, passphrase: config.passphrase, keep: config.keep, repoDir, log }); } finally { running = false; }
  }
  const status = () => {
    const s = readStatus(dataDir);
    if (!config.enabled) return { enabled: false, reason: config.reason };
    return { enabled: true, ok: s.ok === undefined ? null : s.ok, lastSuccess: s.lastSuccess || null, lastAttempt: s.lastAttempt || null, error: s.error || null, file: s.file || null, running };
  };
  return {
    status, tick,
    start() {
      if (!config.enabled) { log("[backup] off: " + config.reason); return; }
      const first = setTimeout(() => { tick().catch(() => {}); }, firstDelayMs);
      const every = setInterval(() => { tick().catch(() => {}); }, checkEveryMs);
      first.unref(); every.unref(); timers = [first, every];
    },
    stop() { timers.forEach((t) => { clearTimeout(t); clearInterval(t); }); timers = []; },
  };
}

// ---------- command line ----------

async function main(argv) {
  const repoDir = __dirname, dataDir = path.join(repoDir, "data");
  const config = loadBackupConfig(path.join(repoDir, ".env"));
  const [cmd, a, b] = argv;
  if (cmd === "status") {
    console.log(JSON.stringify(createBackupScheduler({ dataDir, repoDir, config }).status(), null, 2));
    return 0;
  }
  if (!config.enabled) { console.error("Backup is off: " + config.reason); return 2; }
  if (cmd === "run") {
    const r = await runBackup({ dataDir, destDir: config.dir, passphrase: config.passphrase, keep: config.keep, repoDir, log: console.log });
    return r.ok ? 0 : 1;
  }
  if (cmd === "restore") {
    if (!a || !b) { console.error("Usage: node backup.js restore <backup-file> <new-empty-folder>"); return 2; }
    const list = await restoreBackup({ file: path.resolve(a), passphrase: config.passphrase, targetDir: b, dataDir });
    console.log(`Restored ${list.length} files into ${path.resolve(b)}. Nothing in data/ was touched.`);
    return 0;
  }
  if (cmd === "verify") { // restore the newest backup into a temp folder, compare with the real data/, delete the temp folder
    const names = await listBackups(config.dir);
    if (!names.length) { console.error("No backup found in " + config.dir); return 1; }
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "bot-verify-"));
    try {
      const target = path.join(tmp, "restored");
      await restoreBackup({ file: path.join(config.dir, names[names.length - 1]), passphrase: config.passphrase, targetDir: target, dataDir });
      const c = await compareDirs(dataDir, target);
      console.log(`Newest backup: ${names[names.length - 1]}\nIdentical: ${c.same.length} files\nChanged since the backup: ${c.changed.length}\nNew since the backup: ${c.onlyA.length}\nOnly in the backup: ${c.onlyB.length}`);
      return c.onlyB.length ? 1 : 0;
    } finally { await fsp.rm(tmp, { recursive: true, force: true }); }
  }
  console.error("Usage: node backup.js run | status | verify | restore <backup-file> <new-empty-folder>");
  return 2;
}

if (require.main === module) main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (error) => { console.error("Error:", error.message); process.exitCode = 1; });

module.exports = { loadBackupConfig, checkDestination, listFiles, buildArchive, parseArchive, encrypt, decrypt, runBackup, restoreBackup, pruneBackups, listBackups, compareDirs, isDue, createBackupScheduler, readStatus, NAME_PATTERN, STATUS_NAME, LOG_NAME };
