// Tests for backup.js. Everything happens in temporary folders; the real data/ is never touched.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const nodeCrypto = require("node:crypto");
const zlib = require("node:zlib");
const b = require("./backup");

const PASS = "correct horse battery staple";
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bot-backup-test-"));
const rm = (d) => fs.rmSync(d, { recursive: true, force: true });

function fakeData() {
  const d = tmp();
  fs.mkdirSync(path.join(d, "conversations"));
  fs.mkdirSync(path.join(d, "courses", "c1"), { recursive: true });
  fs.writeFileSync(path.join(d, "memory.json"), '{"facts":["likes tea"]}');
  fs.writeFileSync(path.join(d, "google-token.json"), '{"refresh_token":"SECRET-TOKEN-123"}');
  fs.writeFileSync(path.join(d, "conversations", "a.json"), "שלום chat");
  fs.writeFileSync(path.join(d, "courses", "c1", "notes.pdf"), nodeCrypto.randomBytes(200000));
  fs.writeFileSync(path.join(d, "stale.tmp"), "half written");
  return d;
}

test("encrypt/decrypt round trip; wrong passphrase and tampering are rejected", async () => {
  const enc = await b.encrypt(Buffer.from("hello"), PASS);
  assert.strictEqual((await b.decrypt(enc, PASS)).toString(), "hello");
  await assert.rejects(b.decrypt(enc, PASS + "x"), /wrong passphrase/);
  const bad = Buffer.from(enc); bad[bad.length - 20] ^= 1;
  await assert.rejects(b.decrypt(bad, PASS), /wrong passphrase|damaged/);
  await assert.rejects(b.decrypt(Buffer.from("not a backup at all, really not"), PASS), /not a Bot backup/);
});

test("the backup file does not contain readable secrets", async () => {
  const data = fakeData(), root = tmp(), dest = path.join(root, "out");
  try {
    const r = await b.runBackup({ dataDir: data, destDir: dest, passphrase: PASS });
    assert.ok(r.ok, r.error);
    const raw = fs.readFileSync(r.path);
    assert.ok(!raw.includes("SECRET-TOKEN-123") && !raw.includes("likes tea"));
  } finally { rm(data); rm(root); }
});

test("real backup then restore into a temp folder gives identical files", async () => {
  const data = fakeData(), root = tmp(), dest = path.join(root, "cloud"), target = path.join(root, "restored");
  try {
    const r = await b.runBackup({ dataDir: data, destDir: dest, passphrase: PASS });
    assert.ok(r.ok, r.error);
    assert.strictEqual(r.fileCount, 4);
    const files = await b.restoreBackup({ file: r.path, passphrase: PASS, targetDir: target, dataDir: data });
    assert.deepStrictEqual(files.sort(), ["conversations/a.json", "courses/c1/notes.pdf", "google-token.json", "memory.json"]);
    // data/ now also holds backup-status.json and backup.log (not backed up) and stale.tmp (skipped on purpose)
    const c = await b.compareDirs(data, target);
    assert.strictEqual(c.same.length, 4);
    assert.deepStrictEqual(c.changed, []);
    assert.deepStrictEqual(c.onlyB, []);
    assert.ok(c.onlyA.every((n) => n === "stale.tmp" || n.startsWith("backup")));
    // restoring again into a non-empty folder is refused
    await assert.rejects(b.restoreBackup({ file: r.path, passphrase: PASS, targetDir: target, dataDir: data }), /not empty/);
    // restoring into data/ is refused
    await assert.rejects(b.restoreBackup({ file: r.path, passphrase: PASS, targetDir: path.join(data, "sub"), dataDir: data }), /refusing/);
    await assert.rejects(b.restoreBackup({ file: r.path, passphrase: "wrong wrong wrong", targetDir: path.join(root, "x"), dataDir: data }), /wrong passphrase/);
  } finally { rm(data); rm(root); }
});

test("the real data/ is only read: its files are unchanged, only status and log are added", async () => {
  const data = fakeData(), root = tmp();
  try {
    const before = await b.listFiles(data);
    const snap = Object.fromEntries(before.map((n) => [n, fs.readFileSync(path.join(data, n)).toString("hex")]));
    await b.runBackup({ dataDir: data, destDir: path.join(root, "o"), passphrase: PASS });
    for (const n of before) assert.strictEqual(fs.readFileSync(path.join(data, n)).toString("hex"), snap[n]);
    assert.deepStrictEqual(fs.readdirSync(data).sort(), ["backup-status.json", "backup.log", "conversations", "courses", "google-token.json", "memory.json", "stale.tmp"]);
  } finally { rm(data); rm(root); }
});

test("keeps only the newest N copies and only prunes files with its own name pattern", async () => {
  const data = fakeData(), root = tmp(), dest = path.join(root, "o");
  try {
    fs.mkdirSync(dest);
    fs.writeFileSync(path.join(dest, "my-holiday-photo.jpg"), "x");
    for (let i = 0; i < 4; i++) {
      const r = await b.runBackup({ dataDir: data, destDir: dest, passphrase: PASS, keep: 2, now: new Date(Date.UTC(2026, 10, 1 + i, 3, 0, 0)) });
      assert.ok(r.ok, r.error);
    }
    assert.deepStrictEqual(fs.readdirSync(dest).sort(), ["bot-backup-20261103-030000.botbak", "bot-backup-20261104-030000.botbak", "my-holiday-photo.jpg"]);
  } finally { rm(data); rm(root); }
});

test("failure keeps old copies, writes status + log, and never throws", async () => {
  const data = fakeData(), root = tmp(), dest = path.join(root, "o");
  try {
    const ok = await b.runBackup({ dataDir: data, destDir: dest, passphrase: PASS });
    assert.ok(ok.ok);
    const missing = await b.runBackup({ dataDir: data, destDir: path.join(root, "no", "such", "o"), passphrase: PASS });
    assert.strictEqual(missing.ok, false);
    assert.match(missing.error, /parent does not exist/);
    const short = await b.runBackup({ dataDir: data, destDir: dest, passphrase: "short" });
    assert.strictEqual(short.ok, false);
    const st = b.readStatus(data);
    assert.strictEqual(st.ok, false);
    assert.ok(st.lastSuccess, "the last success time is kept");
    const log = fs.readFileSync(path.join(data, "backup.log"), "utf8");
    assert.match(log, /FAILED/);
    assert.ok(!log.includes(PASS));
    assert.strictEqual((await b.listBackups(dest)).length, 1);
  } finally { rm(data); rm(root); }
});

test("refuses a destination inside data/ or inside the project folder", async () => {
  const data = fakeData();
  try {
    assert.match(b.checkDestination(path.join(data, "bk"), { dataDir: data, repoDir: path.resolve("/x/repo") }), /inside data/);
    assert.match(b.checkDestination(path.resolve("/x/repo/backups"), { dataDir: data, repoDir: path.resolve("/x/repo") }), /public GitHub/);
    assert.strictEqual(b.checkDestination(path.resolve("/elsewhere/OneDrive/bk"), { dataDir: data, repoDir: path.resolve("/x/repo") }), null);
    const r = await b.runBackup({ dataDir: data, destDir: path.join(data, "bk"), passphrase: PASS });
    assert.strictEqual(r.ok, false);
  } finally { rm(data); }
});

test("a damaged inner archive is detected by checksums", async () => {
  const data = fakeData();
  try {
    const { buffer } = await b.buildArchive(data);
    b.parseArchive(buffer);
    const bad = Buffer.from(buffer); bad[bad.length - 5] ^= 1;
    assert.throws(() => b.parseArchive(bad), /checksum mismatch/);
    assert.throws(() => b.parseArchive(buffer.subarray(0, buffer.length - 10)), /cut off/);
  } finally { rm(data); }
});

test("restore refuses dot-dot paths inside a forged backup", async () => {
  const evil = Buffer.from("evil");
  const manifest = Buffer.from(JSON.stringify({ version: 1, files: [{ path: "../escape.txt", size: 4, sha256: nodeCrypto.createHash("sha256").update(evil).digest("hex") }] }));
  const head = Buffer.alloc(8); Buffer.from("BKD1").copy(head); head.writeUInt32BE(manifest.length, 4);
  const root = tmp(), file = path.join(root, "forged.botbak");
  try {
    fs.writeFileSync(file, await b.encrypt(zlib.gzipSync(Buffer.concat([head, manifest, evil])), PASS));
    await assert.rejects(b.restoreBackup({ file, passphrase: PASS, targetDir: path.join(root, "t") }), /unsafe path/);
    assert.ok(!fs.existsSync(path.join(root, "escape.txt")));
  } finally { rm(root); }
});

test("isDue: first run, daily rhythm, hourly retry after a failure", () => {
  const now = Date.parse("2026-11-06T12:00:00Z"), h = 3600e3;
  assert.ok(b.isDue({}, now));
  assert.ok(!b.isDue({ ok: true, lastSuccess: new Date(now - 5 * h).toISOString() }, now));
  assert.ok(b.isDue({ ok: true, lastSuccess: new Date(now - 25 * h).toISOString() }, now));
  const failed = (ago) => ({ ok: false, lastSuccess: new Date(now - 30 * h).toISOString(), lastAttempt: new Date(now - ago * h).toISOString() });
  assert.ok(!b.isDue(failed(0.5), now));
  assert.ok(b.isDue(failed(2), now));
});

test("loadBackupConfig: needs a folder and a long passphrase; keep is bounded", () => {
  const d = tmp(), f = path.join(d, ".env");
  try {
    assert.strictEqual(b.loadBackupConfig(f).enabled, false);
    fs.writeFileSync(f, "BOT_BACKUP_DIR=C:\\Drive\\bk\nBOT_BACKUP_PASSPHRASE=short\n");
    assert.match(b.loadBackupConfig(f).reason, /at least 12/);
    fs.writeFileSync(f, `BOT_BACKUP_DIR=${d}\nBOT_BACKUP_PASSPHRASE=${PASS}\nBOT_BACKUP_KEEP=99\n`);
    const c = b.loadBackupConfig(f);
    assert.ok(c.enabled);
    assert.strictEqual(c.keep, 5);
  } finally { rm(d); }
});

test("scheduler: runs once when due, skips when not due, status reflects it", async () => {
  const data = fakeData(), root = tmp();
  try {
    const config = { enabled: true, dir: path.join(root, "o"), passphrase: PASS, keep: 3 };
    const s = b.createBackupScheduler({ dataDir: data, repoDir: path.resolve("/nowhere"), config, log: () => {} });
    assert.strictEqual(s.status().ok, null);
    await Promise.all([s.tick(), s.tick()]); // the second call must be ignored while the first runs
    assert.strictEqual((await b.listBackups(config.dir)).length, 1);
    assert.strictEqual(s.status().ok, true);
    await s.tick(); // not due any more
    assert.strictEqual((await b.listBackups(config.dir)).length, 1);
    assert.strictEqual(b.createBackupScheduler({ dataDir: data, config: { enabled: false, reason: "nope" } }).status().enabled, false);
  } finally { rm(data); rm(root); }
});

test("GET /api/backup shows status only (no folder, no passphrase) and is off without a scheduler", async () => {
  const http = require("node:http");
  const { createServer } = require("./server");
  const { createStore } = require("./store");
  const dir = tmp();
  const fake = { status: () => ({ enabled: true, ok: false, lastSuccess: "2026-11-05T10:00:00.000Z", lastAttempt: "2026-11-06T10:00:00.000Z", error: "drive missing", running: false, dir: "C:\secret-folder", passphrase: "nope" }) };
  const get = (server, p) => new Promise((resolve) => {
    http.get({ port: server.address().port, host: "127.0.0.1", path: p, headers: { host: "localhost:" + server.address().port } }, (res) => {
      let body = ""; res.on("data", (c) => { body += c; }); res.on("end", () => resolve({ status: res.statusCode, body }));
    });
  });
  const withBackup = createServer({ store: createStore(dir), backup: fake });
  const without = createServer({ store: createStore(dir) });
  await Promise.all([withBackup, without].map((s) => new Promise((r) => s.listen(0, "127.0.0.1", r))));
  try {
    const a = await get(withBackup, "/api/backup");
    assert.strictEqual(a.status, 200);
    assert.ok(a.body.includes("drive missing") && !a.body.includes("secret-folder") && !a.body.includes("nope"));
    assert.notStrictEqual((await get(without, "/api/backup")).status, 200);
  } finally { withBackup.close(); without.close(); rm(dir); }
});
