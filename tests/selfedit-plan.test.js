// selfedit-plan.test.js
// Tests Improve Bot's planning mode (selfedit-plan.js), its server routes and security checks,
// and the planning UI in public/index.html. Uses fake models and temporary folders only.
// Run with:  node --test tests/selfedit-plan.test.js

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const {
  createPlanner,
  safeReadFile,
  parseReadCall,
  buildProjectContext,
  buildImplementationRequest,
  MAX_PLAN_REQUEST_CHARS,
  MAX_FILES_PER_ROUND,
  PLANNER_CHAIN,
} = require("../selfedit-plan");
const { createServer } = require("../server");
const { createStore } = require("../store");

function tempProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bot-plan-test-"));
  const repoDir = path.join(root, "repo");
  const dataDir = path.join(root, "data");
  fs.mkdirSync(path.join(repoDir, "public"), { recursive: true });
  fs.mkdirSync(path.join(repoDir, "tests"), { recursive: true });
  fs.mkdirSync(path.join(repoDir, "data"), { recursive: true });
  fs.mkdirSync(path.join(repoDir, ".git"), { recursive: true });
  fs.writeFileSync(path.join(repoDir, "README.md"), "# Bot\nA small personal assistant.\n");
  fs.writeFileSync(path.join(repoDir, "morning.js"), "line1\nline2\nline3\nline4\nline5\n");
  fs.writeFileSync(path.join(repoDir, "public", "index.html"), "<!doctype html><title>Bot</title>\n");
  fs.writeFileSync(path.join(repoDir, "tests", "morning.test.js"), "// test\n");
  fs.writeFileSync(path.join(repoDir, "data", "secret.json"), '{"token":"nope"}\n');
  fs.writeFileSync(path.join(repoDir, ".git", "config"), "[core]\n");
  fs.writeFileSync(path.join(repoDir, ".hidden"), "secret\n");
  fs.writeFileSync(path.join(repoDir, "pic.png"), "not text");
  return { root, repoDir, dataDir, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test("safeReadFile reads project text files with line numbers and refuses traversal, hidden files, guard prefixes and binaries", () => {
  const p = tempProject();
  try {
    const ok = safeReadFile(p.repoDir, { path: "morning.js", start: 2, end: 4 });
    assert.strictEqual(ok.ok, true);
    assert.strictEqual(ok.start, 2);
    assert.strictEqual(ok.end, 4);
    assert.strictEqual(ok.content, "2: line2\n3: line3\n4: line4");

    assert.strictEqual(safeReadFile(p.repoDir, { path: "../outside.js" }).ok, false);
    assert.strictEqual(safeReadFile(p.repoDir, { path: path.join(p.repoDir, "morning.js") }).ok, false);
    assert.strictEqual(safeReadFile(p.repoDir, { path: ".hidden" }).ok, false);
    assert.strictEqual(safeReadFile(p.repoDir, { path: ".git/config" }).ok, false);
    assert.strictEqual(safeReadFile(p.repoDir, { path: "data/secret.json" }).ok, false);
    assert.strictEqual(safeReadFile(p.repoDir, { path: "pic.png" }).ok, false);
    assert.strictEqual(safeReadFile(p.repoDir, { path: "missing.js" }).ok, false);
  } finally { p.cleanup(); }
});

test("parseReadCall parses READ JSON requests, caps file count, and ignores normal text", () => {
  const many = Array.from({ length: 10 }, (_, i) => ({ path: `f${i}.js`, start: 1, end: 50 }));
  const parsed = parseReadCall(`READ ${JSON.stringify({ files: many })}`);
  assert.strictEqual(parsed.length, MAX_FILES_PER_ROUND);
  assert.strictEqual(parsed[0].path, "f0.js");
  assert.strictEqual(parseReadCall("1. Feasibility: Yes, this is possible."), null);
  assert.strictEqual(parseReadCall("READ {not valid json}"), null);
});

test("parseReadCall ignores stray text after the JSON (seen live: ...]}modern)", () => {
  const live = 'READ {"files":[{"path":"selfedit-plan.js","start":1,"end":250},{"path":"photo.js","start":1,"end":120}]}modern';
  assert.deepStrictEqual(parseReadCall(live).map((f) => f.path), ["selfedit-plan.js", "photo.js"]);
  assert.strictEqual(parseReadCall('READ {"files":[]}modern'), null);
  assert.strictEqual(parseReadCall('Sure. READ {"files":[{"path":"a.js"}]}'), null, "READ must still open the reply");
});

test("buildProjectContext lists real files, guard files, sensitive files, and Argon's page-only limit", () => {
  const p = tempProject();
  try {
    const ctxNeon = buildProjectContext(p.repoDir, "neon");
    assert.match(ctxNeon, /morning\.js/);
    assert.match(ctxNeon, /public\/index\.html/);
    assert.match(ctxNeon, /tests\/morning\.test\.js/);
    assert.match(ctxNeon, /Guard files[^\n]*selfedit\.js/);
    assert.match(ctxNeon, /Sensitive files[^\n]*server\.js/);
    assert.match(ctxNeon, /A small personal assistant/);

    const ctxArgon = buildProjectContext(p.repoDir, "argon");
    assert.match(ctxArgon, /CAN ONLY edit files inside public\//);
  } finally { p.cleanup(); }
});

test("buildImplementationRequest combines goal, clarifications, plan and note and stays within the length cap", () => {
  const plan = {
    request: "add dark mode toggle",
    chat: [
      { role: "user", text: "add dark mode toggle" },
      { role: "bot", text: "First draft plan" },
      { role: "user", text: "keep it in the sidebar" },
      { role: "bot", text: "Final agreed plan: " + "step ".repeat(2000) },
    ],
  };
  const req = buildImplementationRequest(plan, "keep phone tap targets big");
  assert.ok(req.length <= MAX_PLAN_REQUEST_CHARS, `length ${req.length} <= ${MAX_PLAN_REQUEST_CHARS}`);
  assert.match(req, /add dark mode toggle/);
  assert.match(req, /keep it in the sidebar/);
  assert.match(req, /keep phone tap targets big/);
  assert.match(req, /Final agreed plan:/);
});

test("planner happy path: reads requested files safely, replies with plan, supports multi-turn and start/discard", async () => {
  const p = tempProject();
  try {
    const seenPrompts = [];
    let call = 0;
    const planner = createPlanner({
      repoDir: p.repoDir,
      dataDir: p.dataDir,
      lowPools: async () => [],
      askOne: async (model, prompt) => {
        seenPrompts.push({ model: model.model, prompt });
        call++;
        if (call === 1) return 'READ {"files":[{"path":"morning.js","start":1,"end":5}]}';
        if (call === 2) return "Feasibility: Yes.\nPlan:\n1. Update morning.js.\n2. Update tests/morning.test.js.";
        return "Updated plan with your tweak:\n1. Also update public/index.html.";
      },
    });

    const { record, finished } = await planner.start("improve the morning brief", { model: "neon" });
    assert.strictEqual(record.status, "planning");
    const done = await finished;
    assert.strictEqual(done.status, "open");
    assert.strictEqual(done.chat.length, 2);
    assert.deepStrictEqual(done.chat[1].filesRead, ["morning.js"]);
    assert.match(seenPrompts[1].prompt, /1: line1/);
    assert.strictEqual(seenPrompts[0].model, PLANNER_CHAIN[0].model);

    // Multi-turn refinement
    const follow = await (await planner.message(done.id, "also show a badge on the page", { model: "sonnet" })).finished;
    assert.strictEqual(follow.status, "open");
    assert.strictEqual(follow.model, "sonnet");
    assert.strictEqual(follow.chat.length, 4);
    assert.strictEqual(planner.latestOpen().id, done.id);

    // Prepare handoff to selfEdit.start
    const ready = planner.prepareStart(done.id);
    assert.strictEqual(ready.model, "sonnet");
    assert.match(ready.request, /improve the morning brief/);
    assert.match(ready.request, /also show a badge on the page/);
    assert.match(ready.request, /Updated plan with your tweak/);

    const started = planner.markStarted(done.id, "0123456789abcdef", "sonnet");
    assert.strictEqual(started.status, "started");
    assert.strictEqual(started.proposalId, "0123456789abcdef");
    assert.strictEqual(planner.latestOpen(), null);

    // Discard on a second plan
    const second = await (await planner.start("another idea", { model: "argon" })).finished;
    assert.strictEqual(planner.latestOpen().id, second.id);
    const discarded = planner.discard(second.id);
    assert.strictEqual(discarded.status, "discarded");
    assert.strictEqual(planner.latestOpen(), null);
  } finally { p.cleanup(); }
});

test("planner falls back within Gemini Models pool and never calls Claude when Gemini quota is low", async () => {
  const p = tempProject();
  try {
    const modelsTried = [];
    const planner = createPlanner({
      repoDir: p.repoDir,
      dataDir: p.dataDir,
      lowPools: async () => [],
      noteFailure: () => {},
      askOne: async (model) => {
        modelsTried.push(model.model);
        if (modelsTried.length === 1) throw new Error("temporary error");
        return "Fallback plan from Hydrogen.";
      },
    });
    const done = await (await planner.start("small tweak")).finished;
    assert.strictEqual(done.status, "open");
    assert.deepStrictEqual(modelsTried, [PLANNER_CHAIN[0].model, PLANNER_CHAIN[1].model]);

    // When Gemini Models pool is low, refuse immediately without calling any model
    let called = false;
    const lowPlanner = createPlanner({
      repoDir: p.repoDir,
      dataDir: p.dataDir,
      lowPools: async () => [{ pool: "Gemini Models", remaining: 8 }],
      askOne: async () => { called = true; return "nope"; },
    });
    await assert.rejects(lowPlanner.start("small tweak"), /Gemini Models pool.*8% left.*Nothing was sent to Claude/);
    assert.strictEqual(called, false);
  } finally { p.cleanup(); }
});

test("server plan routes work end-to-end and enforce Host, Origin, Sec-Fetch-Site and JSON checks", async () => {
  const p = tempProject();
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-plan-store-"));
  const editCalls = [];
  const selfEdit = {
    start: async (request, opts) => { editCalls.push({ request, model: opts.model }); return { record: { id: "abcdef0123456789", status: "running", request, model: opts.model } }; },
    get: () => null,
    list: () => [],
    approve: async () => ({}),
    reject: async () => ({}),
    undo: async () => ({}),
    rollback: () => null,
    followUp: async () => ({}),
    previewDir: () => null,
    isActive: () => false,
  };
  const selfEditPlan = createPlanner({
    repoDir: p.repoDir,
    dataDir: p.dataDir,
    lowPools: async () => [],
    askOne: async () => "Feasibility: Yes.\n1. Edit public/index.html.",
  });
  const server = createServer({ store: createStore(storeDir), selfEdit, selfEditPlan });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;

  const req = (method, urlPath, { headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const r = http.request({ host: "127.0.0.1", port, method, path: urlPath, headers: { Host: `localhost:${port}`, ...headers } }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    r.on("error", reject);
    if (body !== undefined) r.write(body);
    r.end();
  });
  const post = (urlPath, body, headers = {}) => req("POST", urlPath, { headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

  try {
    // Security checks
    assert.strictEqual((await post("/api/selfedit/plan", { request: "hi" }, { Origin: "https://evil.example.com" })).status, 403);
    assert.strictEqual((await post("/api/selfedit/plan", { request: "hi" }, { "Sec-Fetch-Site": "cross-site" })).status, 403);
    assert.strictEqual((await req("POST", "/api/selfedit/plan", { headers: { "Content-Type": "text/plain" }, body: "{}" })).status, 415);
    assert.strictEqual((await req("GET", "/api/selfedit/plan/0123456789abcdef", { headers: { Host: "evil.example.com" } })).status, 403);

    // Start a plan
    const created = await post("/api/selfedit/plan", { request: "make button rounder", model: "neon" });
    assert.strictEqual(created.status, 202);
    const planId = JSON.parse(created.body).plan.id;

    // Wait for background turn to finish
    let plan;
    for (let i = 0; i < 40; i++) {
      plan = JSON.parse((await req("GET", `/api/selfedit/plan/${planId}`)).body).plan;
      if (plan.status !== "planning") break;
      await new Promise((r) => setTimeout(r, 15));
    }
    assert.strictEqual(plan.status, "open");
    assert.strictEqual(JSON.parse((await req("GET", "/api/selfedit")).body).activePlan.id, planId);

    // Start editing from the plan
    const started = await post(`/api/selfedit/plan/${planId}/start`, { model: "argon" });
    assert.strictEqual(started.status, 202);
    const startedBody = JSON.parse(started.body);
    assert.strictEqual(startedBody.proposal.id, "abcdef0123456789");
    assert.strictEqual(startedBody.plan.status, "started");
    assert.strictEqual(editCalls.length, 1);
    assert.strictEqual(editCalls[0].model, "argon");
    assert.match(editCalls[0].request, /make button rounder/);
    assert.match(editCalls[0].request, /Edit public\/index\.html/);
  } finally {
    await new Promise((r) => server.close(r));
    p.cleanup();
    fs.rmSync(storeDir, { recursive: true, force: true });
  }
});

test("planner accepts photoPath in start and message, passes it to askOne, and stores only safe metadata", async () => {
  const p = tempProject();
  try {
    const shot1 = path.join(p.root, "shot1.png");
    const shot2 = path.join(p.root, "shot2.jpg");
    fs.writeFileSync(shot1, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]));
    fs.writeFileSync(shot2, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]));
    const calls = [];
    const planner = createPlanner({
      repoDir: p.repoDir,
      dataDir: p.dataDir,
      lowPools: async () => [],
      askOne: async (model, prompt, opts) => {
        calls.push({ prompt, photoPath: opts && opts.photoPath });
        return calls.length === 1 ? "I see the button in the screenshot. Plan: 1. Adjust CSS." : "Updated plan from your second screenshot.";
      },
    });

    const first = await (await planner.start("make this button rounder", { model: "neon", photoPath: shot1 })).finished;
    assert.strictEqual(first.status, "open");
    assert.strictEqual(first.chat[0].hasPhoto, true);
    assert.strictEqual(calls[0].photoPath, shot1);
    assert.match(calls[0].prompt, /photo\.png/);
    assert.match(calls[0].prompt, /\[screenshot attached\]/);

    // Photo-only reply (empty text allowed when a screenshot is attached)
    const second = await (await planner.message(first.id, "", { photoPath: shot2 })).finished;
    assert.strictEqual(second.status, "open");
    assert.strictEqual(second.chat[2].text, "(screenshot attached)");
    assert.strictEqual(second.chat[2].hasPhoto, true);
    assert.strictEqual(calls[1].photoPath, shot2);
    assert.match(calls[1].prompt, /photo\.jpg/);

    // Saved JSON never leaks disk paths or raw image data
    const savedJson = fs.readFileSync(path.join(p.dataDir, "selfedit-plans", first.id + ".json"), "utf8");
    assert.doesNotMatch(savedJson, /shot1\.png|shot2\.jpg|data:image/i);
  } finally { p.cleanup(); }
});

test("server plan routes validate and save screenshots, pass photoPath to planner, delete them after the turn, and reject invalid photos", async () => {
  const p = tempProject();
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-plan-photo-store-"));
  const seenPhotos = [];
  const selfEdit = {
    start: async () => ({ record: { id: "abcdef0123456789", status: "running" } }),
    get: () => null, list: () => [], approve: async () => ({}), reject: async () => ({}),
    undo: async () => ({}), rollback: () => null, followUp: async () => ({}), previewDir: () => null, isActive: () => false,
  };
  const selfEditPlan = createPlanner({
    repoDir: p.repoDir,
    dataDir: p.dataDir,
    lowPools: async () => [],
    askOne: async (model, prompt, opts) => {
      const shot = opts && opts.photoPath ? opts.photoPath : null;
      seenPhotos.push(shot ? { path: shot, existed: fs.existsSync(shot) } : null);
      return "Looks good based on the screenshot.";
    },
  });
  const server = createServer({ store: createStore(storeDir), selfEdit, selfEditPlan });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;

  const post = (urlPath, body) => new Promise((resolve, reject) => {
    const r = http.request({ host: "127.0.0.1", port, method: "POST", path: urlPath, headers: { Host: `localhost:${port}`, "Content-Type": "application/json" } }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    r.on("error", reject);
    r.end(JSON.stringify(body));
  });
  const get = (urlPath) => new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: urlPath, headers: { Host: `localhost:${port}` } }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    }).on("error", reject);
  });

  const validPng = "data:image/png;base64," + Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString("base64");
  const fakePng = "data:image/png;base64," + Buffer.from("not actually a png").toString("base64");

  try {
    // Reject bad photo payloads (magic bytes and format)
    assert.strictEqual((await post("/api/selfedit/plan", { request: "hi", photo: "not-a-data-url" })).status, 400);
    assert.strictEqual((await post("/api/selfedit/plan", { request: "hi", photo: fakePng })).status, 415);
    // Still rejects oversized body without a photo field
    assert.strictEqual((await post("/api/selfedit/plan", { request: "x".repeat(25000) })).status, 413);

    // Accept valid PNG on plan start
    const created = await post("/api/selfedit/plan", { request: "fix this layout", model: "neon", photo: validPng });
    assert.strictEqual(created.status, 202);
    const planId = JSON.parse(created.body).plan.id;
    let plan;
    for (let i = 0; i < 40; i++) {
      plan = JSON.parse((await get(`/api/selfedit/plan/${planId}`)).body).plan;
      if (plan.status !== "planning") break;
      await new Promise((r) => setTimeout(r, 15));
    }
    assert.strictEqual(plan.status, "open");
    assert.strictEqual(plan.chat[0].hasPhoto, true);
    assert.ok(seenPhotos[0] && seenPhotos[0].path.endsWith(".png") && seenPhotos[0].existed);
    assert.strictEqual(fs.existsSync(seenPhotos[0].path), false); // 2026-11-22: deleted once the turn is answered

    // Reject bad photo on plan message, accept valid PNG on plan message
    assert.strictEqual((await post(`/api/selfedit/plan/${planId}/message`, { message: "also this", photo: fakePng })).status, 415);
    const reply = await post(`/api/selfedit/plan/${planId}/message`, { message: "", photo: validPng });
    assert.strictEqual(reply.status, 202);
    for (let i = 0; i < 40; i++) {
      plan = JSON.parse((await get(`/api/selfedit/plan/${planId}`)).body).plan;
      if (plan.status !== "planning") break;
      await new Promise((r) => setTimeout(r, 15));
    }
    assert.strictEqual(plan.status, "open");
    assert.strictEqual(plan.chat[2].hasPhoto, true);
    assert.ok(seenPhotos[1] && seenPhotos[1].path.endsWith(".png") && seenPhotos[1].existed);
    assert.strictEqual(fs.existsSync(seenPhotos[1].path), false);
  } finally {
    await new Promise((r) => server.close(r));
    p.cleanup();
    fs.rmSync(storeDir, { recursive: true, force: true });
  }
});

test("public/index.html has Planning mode controls, screenshot attach/paste UI, uses textContent only, and keeps existing Improve Bot UI", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
  assert.match(html, /id="improvePlanMode"/);
  assert.match(html, /id="improvePhotoChip"/);
  assert.match(html, /id="improveAttach"/);
  assert.match(html, /id="improvePhotoInput"/);
  assert.match(html, /id="improvePhotoRemove"/);
  assert.match(html, /setupImprovePaste\(\);/);
  assert.match(html, /Plan first/);
  assert.match(html, /Start editing with this plan/);
  assert.match(html, /Discard plan/);
  assert.match(html, /\/api\/selfedit\/plan/);
  assert.doesNotMatch(html.slice(html.indexOf("<script>")), /\.innerHTML\s*=/);
});
