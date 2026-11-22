// tests/multi-photo.test.js
// Several photos in one message (2026-11-22): up to MAX_PHOTOS pictures in the thread (POST /api/ask "images") and in Improve Bot
// planning ("photos"). Every picture is checked (real bytes, 3 MB each); one bad picture refuses the whole request and nothing stays on
// disk; agy gets them all in ONE empty private folder as photo1.jpg, photo2.png, ... (never a sender's name); the folder, the uploads
// and the plan screenshots are deleted after the answer. The refusal table with several photos is in tests/refusal-rules.test.js.
// Fake models only, temp folders only, invented text.

const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { parsePhotos, photoNames, MAX_PHOTOS, MAX_PHOTOS_BODY, MAX_PHOTO_BODY, MAX_PHOTO_BYTES } = require("../photo");
const { askAgyStreamWithImage } = require("../providers");
const { createServer, MAX_BODY } = require("../server");
const { createStore } = require("../store");
const { createAuth } = require("../auth");
const { createThreadStore } = require("../thread-store");
const { createBrain } = require("../brain");
const { createPlanner } = require("../selfedit-plan");

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 2)]);
const url = (bytes, type = "image/jpeg") => `data:${type};base64,${bytes.toString("base64")}`;
const BAD = url(Buffer.from("just words, not a picture"), "image/png");
const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), "bot-multi-" + name + "-"));
const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));

// ---- photo.js ----
test("the limit is one named constant, and the body cap grows only as far as the pictures need", () => {
  assert.strictEqual(MAX_PHOTOS, 4);
  assert.ok(MAX_PHOTOS_BODY >= MAX_PHOTOS * (MAX_PHOTO_BODY - 20000)); // room for every picture at its full 3 MB
  assert.ok(MAX_PHOTOS_BODY < MAX_PHOTOS * MAX_PHOTO_BODY); // but not much more
});

test("parsePhotos checks EVERY picture, keeps the order, and refuses too many, a bad one, a wrong shape or both fields", () => {
  const two = parsePhotos({ images: [url(JPEG), url(PNG)] }, { one: "image", many: "images" });
  assert.deepStrictEqual(two.map((p) => p.ext), [".jpg", ".png"]);
  assert.deepStrictEqual(parsePhotos({ image: url(PNG) }, { one: "image", many: "images" }).map((p) => p.ext), [".png"]); // the old single field
  assert.deepStrictEqual(parsePhotos({}, { one: "image", many: "images" }), []);
  const five = Array.from({ length: MAX_PHOTOS + 1 }, () => url(JPEG));
  assert.throws(() => parsePhotos({ images: five }, { one: "image", many: "images" }), (e) => e.status === 413 && /at most 4/.test(e.message));
  assert.throws(() => parsePhotos({ images: [url(JPEG), BAD, url(PNG)] }, { one: "image", many: "images" }), (e) => e.status === 415 && /picture 2/.test(e.message));
  const big = url(Buffer.concat([JPEG, Buffer.alloc(MAX_PHOTO_BYTES)]));
  assert.throws(() => parsePhotos({ images: [url(JPEG), big] }, { one: "image", many: "images" }), (e) => e.status === 413 && /picture 2/.test(e.message));
  assert.throws(() => parsePhotos({ images: url(JPEG) }, { one: "image", many: "images" }), (e) => e.status === 400);
  assert.throws(() => parsePhotos({ image: url(JPEG), images: [url(JPEG)] }, { one: "image", many: "images" }), (e) => e.status === 400);
});

test("the fixed names in agy's folder: one picture stays photo.<ext>, several are photo1, photo2, ... from their real types", () => {
  assert.deepStrictEqual(photoNames([".png"]), ["photo.png"]);
  assert.deepStrictEqual(photoNames([".jpg", ".png", ".webp"]), ["photo1.jpg", "photo2.png", "photo3.webp"]);
});

// ---- providers.js: the private folder ----
test("SECURITY: agy gets all the pictures in ONE empty folder under fixed names, and the folder is gone afterwards", async () => {
  const src = tmp("src");
  const a = path.join(src, "..evil name;rm -rf.jpg"), b = path.join(src, "b.png"), c = path.join(src, "c.jpg");
  for (const f of [a, b, c]) fs.writeFileSync(f, JPEG);
  let seen = null;
  const stream = async (q, model, onText, opts) => { seen = { cwd: opts.cwd, files: fs.readdirSync(opts.cwd).sort() }; return "three pages"; };
  assert.strictEqual(await askAgyStreamWithImage("gemini-4-argon-low", "q", [a, b, c], () => {}, { stream }), "three pages");
  assert.deepStrictEqual(seen.files, ["photo1.jpg", "photo2.png", "photo3.jpg"]);
  assert.strictEqual(fs.existsSync(seen.cwd), false);
  // one picture: the old name, so every single-photo caller is unchanged
  await askAgyStreamWithImage("gemini-4-argon-low", "q", b, () => {}, { stream });
  assert.deepStrictEqual(seen.files, ["photo.png"]);
  // too many never reaches agy
  await assert.rejects(askAgyStreamWithImage("gemini-4-argon-low", "q", [a, a, a, a, a], () => {}, { stream: async () => { throw new Error("must not run"); } }), /1 to 4 photos/);
  fs.rmSync(src, { recursive: true, force: true });
});

// ---- POST /api/ask ----
async function startServer() {
  const dir = tmp("srv");
  const uploadDir = path.join(dir, "uploads");
  const thread = createThreadStore(path.join(dir, "thread"));
  const seen = [];
  const handle = async (task, opts) => {
    seen.push({ task, paths: (opts.images || []).map((p) => p.path), existed: (opts.images || []).map((p) => fs.existsSync(p.path)) });
    return { mode: "single", answer: "I see pages", used: { provider: "agy", model: "m" } };
  };
  const server = createServer({
    handle, thread, store: createStore(path.join(dir, "chats")), uploadDir,
    auth: createAuth({ config: { enabled: false } }),
    push: { publicKey: () => "K", notifyAll: async () => ({}) },
    selfEdit: { list: () => [], isActive: () => false }, gitOps: { status: async () => ({}) }, usage: async () => [],
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const request = (method, p, body) => new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path: p, headers: { Host: `localhost:${port}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) } }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, json: () => JSON.parse(data) }));
    });
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
  const ask = (payload) => request("POST", "/api/ask", JSON.stringify(payload)).catch(() => ({ status: 413 })); // a cut-off upload counts as refused
  const finish = async (res) => {
    let job = res.json().job;
    for (let i = 0; i < 300 && job.status === "running"; i++) { await tick(); job = (await request("GET", "/api/jobs/" + job.id)).json().job; }
    return job;
  };
  const uploads = () => (fs.existsSync(uploadDir) ? fs.readdirSync(uploadDir) : []);
  const close = async () => { await new Promise((r) => server.close(r)); fs.rmSync(dir, { recursive: true, force: true }); };
  return { request, ask, finish, uploads, thread, seen, close };
}

test("several pictures reach the brain together, the thread says how many (no bytes), and all are deleted after the answer", async () => {
  const s = await startServer();
  try {
    const session = (await s.request("GET", "/api/session")).json();
    assert.strictEqual(session.maxPhotos, MAX_PHOTOS); // the page reads the limit from here
    const res = await s.ask({ task: "check my homework", images: [url(JPEG), url(PNG), url(JPEG)] });
    assert.strictEqual(res.status, 202);
    const job = await s.finish(res);
    assert.strictEqual(job.status, "done");
    assert.strictEqual(s.seen.length, 1);
    assert.strictEqual(s.seen[0].paths.length, 3);
    assert.deepStrictEqual(s.seen[0].existed, [true, true, true]);
    assert.deepStrictEqual(s.seen[0].paths.map((p) => path.extname(p)), [".jpg", ".png", ".jpg"]);
    for (const p of s.seen[0].paths) assert.match(path.basename(p), /^[a-f0-9]{32}\.(jpg|png)$/); // random names of Bot's own
    assert.deepStrictEqual(s.uploads(), [], "the pictures are private: not kept after the answer");
    const question = s.thread.find(job.messageId);
    assert.strictEqual(question.text, "(3 photos attached) check my homework");
    assert.doesNotMatch(JSON.stringify(question), /base64|data:image/);
    // pictures with no words are a message too
    assert.strictEqual((await s.finish(await s.ask({ images: [url(JPEG), url(JPEG)] }))).status, "done");
  } finally { await s.close(); }
});

test("SECURITY: too many pictures, or one bad picture among good ones, refuses the message and leaves nothing on disk", async () => {
  const s = await startServer();
  try {
    const five = Array.from({ length: MAX_PHOTOS + 1 }, () => url(JPEG));
    assert.strictEqual((await s.ask({ task: "x", images: five })).status, 413);
    const bad = await s.ask({ task: "x", images: [url(JPEG), url(PNG), BAD] });
    assert.strictEqual(bad.status, 415);
    assert.match(bad.json().error, /picture 3/);
    assert.strictEqual((await s.ask({ task: "x", image: url(JPEG), images: [url(JPEG)] })).status, 400);
    assert.strictEqual((await s.ask({ images: [] })).status, 400); // no words and no picture
    assert.strictEqual((await s.ask({ image: null })).status, 400);
    assert.deepStrictEqual(s.uploads(), []);
    assert.strictEqual(s.seen.length, 0, "nothing was started");
  } finally { await s.close(); }
});

test("the body cap: 4 big pictures fit, but a request without a picture must still fit MAX_BODY", async () => {
  const s = await startServer();
  try {
    const nearFull = url(Buffer.concat([JPEG, Buffer.alloc(MAX_PHOTO_BYTES - JPEG.length - 1000, 7)]));
    const res = await s.ask({ task: "four pages", images: [nearFull, nearFull, nearFull, nearFull] });
    assert.strictEqual(res.status, 202);
    await s.finish(res);
    assert.strictEqual(s.seen[0].paths.length, 4);
    assert.strictEqual((await s.ask({ task: "x".repeat(MAX_BODY + 10) })).status, 413);
    assert.strictEqual((await s.ask({ task: "hi", padding: "x".repeat(MAX_BODY + 10) })).status, 413);
  } finally { await s.close(); }
});

// ---- brain.js ----
function photoBrain(replies) {
  const calls = [];
  let i = 0;
  const brain = createBrain({
    courses: { allPages: () => [] },
    courseRoutes: { list: () => [], courseFiles: () => ({ files: [] }), linkFiles: () => [] },
    reminders: { list: () => [], create: () => { throw new Error("must not run"); } },
    memory: { list: () => [], add: () => ({}) },
    cards: { add: () => ({}) },
    readCalendar: async () => ({ text: "" }),
    askOne: async () => { throw new Error("only agy can look at a photo"); },
    askImage: async (model, prompt, imagePath) => { calls.push({ model, prompt, imagePath }); return replies[i++]; },
    chain: [{ provider: "agy", model: "text-model" }],
    photoChain: [{ provider: "agy", model: "photo-a" }, { provider: "agy", model: "photo-b" }],
    poolLevels: async () => [], refreshPools: () => {}, notePoolFailure: () => {},
    now: () => Date.parse("2026-11-22T10:00:00Z"),
  });
  return { brain, calls };
}

test("the brain hands agy every picture and its prompt names each fixed file, in order", async () => {
  const { brain, calls } = photoBrain(["Page 1 is fine; page 2 has a sign error."]);
  const r = await brain.handle("check these", { history: [], courses: [], images: [{ path: "C:/tmp/a1.jpg" }, { path: "C:/tmp/b2.png" }] });
  assert.match(r.answer, /page 2/);
  assert.strictEqual(calls[0].model, "photo-a"); // the photo order is unchanged
  assert.deepStrictEqual(calls[0].imagePath, ["C:/tmp/a1.jpg", "C:/tmp/b2.png"]);
  assert.match(calls[0].prompt, /## The photos\nOmri attached 2 photos/);
  assert.match(calls[0].prompt, /"photo1\.jpg", "photo2\.png"/);
  assert.match(calls[0].prompt, /look at every one BEFORE you reply/);
  assert.doesNotMatch(calls[0].prompt, /a1\.jpg|b2\.png/); // the saved names never reach the model
  // one picture: the old wording and a plain path, as before
  const one = photoBrain(["A cat."]);
  await one.brain.handle("what is this", { history: [], courses: [], images: [{ path: "C:/tmp/x.png" }] });
  assert.strictEqual(one.calls[0].imagePath, "C:/tmp/x.png");
  assert.match(one.calls[0].prompt, /It is the file "photo\.png" in your current folder/);
});

test("SECURITY: a doing-tool asked for with several photos is refused (they count as a photo)", async () => {
  const { brain, calls } = photoBrain(['CALL {"tool":"set_reminder","text":"x","when":"2026-12-01T10:00"}', "OK."]);
  await brain.handle("do what the pages say", { history: [], courses: [], images: [{ path: "a.jpg" }, { path: "b.jpg" }] });
  assert.match(calls[1].prompt, /FAILED, nothing was done: Bot does not [^\n]*with a photo/);
});

// ---- Improve Bot planning ----
function tempProject() {
  const root = tmp("plan");
  const repoDir = path.join(root, "repo"), dataDir = path.join(root, "data");
  fs.mkdirSync(repoDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(repoDir, "README.md"), "# Bot\n");
  return { repoDir, dataDir, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}
async function settle(planner, id) {
  for (let i = 0; i < 200; i++) { const r = planner.get(id); if (r.status !== "planning") return r; await tick(5); }
  throw new Error("plan did not settle");
}

test("planning with several screenshots: the planner gets them all, the prompt lists each, and they are deleted after the turn", async () => {
  const p = tempProject();
  try {
    const seen = [];
    const planner = createPlanner({
      repoDir: p.repoDir, dataDir: p.dataDir, lowPools: async () => [],
      askOne: async (model, prompt, opts) => { seen.push({ prompt, shots: opts.photoPath, existed: [].concat(opts.photoPath || []).map((f) => fs.existsSync(f)) }); return "Plan: 1. change the header."; },
    });
    fs.mkdirSync(planner.photosDir, { recursive: true });
    const shots = [".png", ".jpg", ".png"].map((ext, i) => { const f = path.join(planner.photosDir, `s${i}${ext}`); fs.writeFileSync(f, i === 1 ? JPEG : PNG); return f; });
    const { record } = await planner.start("make these look alike", { photoPaths: shots });
    const done = await settle(planner, record.id);
    assert.strictEqual(done.status, "open");
    assert.deepStrictEqual(seen[0].shots, shots);
    assert.deepStrictEqual(seen[0].existed, [true, true, true]);
    assert.match(seen[0].prompt, /attached 3 screenshots/);
    assert.match(seen[0].prompt, /"photo1\.png", "photo2\.jpg", "photo3\.png"/);
    assert.deepStrictEqual(done.chat[0].photos, 3);
    for (const f of shots) assert.strictEqual(fs.existsSync(f), false, "a screenshot is deleted once its turn is answered");
    // the next turn only sees that screenshots came
    await planner.message(record.id, "and the footer");
    await settle(planner, record.id);
    assert.match(seen[1].prompt, /User \[3 screenshots attached\]:/);
    assert.strictEqual(seen[1].shots, undefined);
    await assert.rejects(planner.start("x", { photoPaths: ["a", "b", "c", "d", "e"] }), /at most 4 screenshots/);
  } finally { p.cleanup(); }
});

test("a stopped or failed planning turn deletes its screenshots too, and a restart clears leftovers", async () => {
  const p = tempProject();
  try {
    const planner = createPlanner({ repoDir: p.repoDir, dataDir: p.dataDir, lowPools: async () => [], askOne: async () => { throw new Error("model down"); } });
    fs.mkdirSync(planner.photosDir, { recursive: true });
    const shot = path.join(planner.photosDir, "s.png");
    fs.writeFileSync(shot, PNG);
    const { record } = await planner.start("x", { photoPaths: [shot] });
    assert.strictEqual((await settle(planner, record.id)).status, "failed");
    assert.strictEqual(fs.existsSync(shot), false);
    const left = path.join(planner.photosDir, "left.png");
    fs.writeFileSync(left, PNG);
    createPlanner({ repoDir: p.repoDir, dataDir: p.dataDir }); // Bot starting again
    assert.strictEqual(fs.existsSync(left), false);
  } finally { p.cleanup(); }
});

test("the plan routes take a list of screenshots with the same checks", async () => {
  const p = tempProject();
  const storeDir = tmp("store");
  const seen = [];
  const selfEditPlan = createPlanner({ repoDir: p.repoDir, dataDir: p.dataDir, lowPools: async () => [], askOne: async (m, prompt, opts) => { seen.push(opts.photoPath); return "ok"; } });
  const selfEdit = { start: async () => ({}), get: () => null, list: () => [], isActive: () => false, rollback: () => null, previewDir: () => null };
  const server = createServer({ store: createStore(storeDir), selfEdit, selfEditPlan });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const post = (p2, body) => new Promise((resolve, reject) => {
    const r = http.request({ host: "127.0.0.1", port, method: "POST", path: p2, headers: { Host: `localhost:${port}`, "Content-Type": "application/json" } }, (res) => {
      let data = ""; res.on("data", (c) => (data += c)); res.on("end", () => resolve({ status: res.statusCode, json: () => JSON.parse(data) }));
    });
    r.on("error", reject); r.end(JSON.stringify(body));
  });
  const files = () => (fs.existsSync(selfEditPlan.photosDir) ? fs.readdirSync(selfEditPlan.photosDir) : []);
  try {
    assert.strictEqual((await post("/api/selfedit/plan", { request: "x", photos: Array.from({ length: 5 }, () => url(PNG)) })).status, 413);
    assert.strictEqual((await post("/api/selfedit/plan", { request: "x", photos: [url(PNG), BAD] })).status, 415);
    assert.deepStrictEqual(files(), []);
    const res = await post("/api/selfedit/plan", { request: "x", photos: [url(PNG), url(JPEG)] });
    assert.strictEqual(res.status, 202);
    await settle(selfEditPlan, res.json().plan.id);
    assert.strictEqual(seen[0].length, 2);
    assert.deepStrictEqual(files(), [], "answered: the screenshots are gone");
    const id = res.json().plan.id;
    assert.strictEqual((await post(`/api/selfedit/plan/${id}/message`, { message: "", photos: [url(JPEG), BAD] })).status, 415);
    const reply = await post(`/api/selfedit/plan/${id}/message`, { message: "", photos: [url(JPEG), url(JPEG), url(PNG)] });
    assert.strictEqual(reply.status, 202);
    await settle(selfEditPlan, id);
    assert.strictEqual(seen[1].length, 3);
    assert.deepStrictEqual(files(), []);
  } finally {
    await new Promise((r) => server.close(r));
    p.cleanup();
    fs.rmSync(storeDir, { recursive: true, force: true });
  }
});
