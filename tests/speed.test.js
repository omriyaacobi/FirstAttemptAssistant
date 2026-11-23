// tests/speed.test.js (2026-11-23, experiments/2026-11-23-speed.md)
// The speed changes: the next round's agy spare starts when a call starts (warmagy early), every agy model the brain or the picker
// can put first has a spare (WARM_MODELS), the typing warm-up (brain.warmUp, /api/brain/warm) and the calendar read that overlaps
// the rest of the prompt. A fake agy and made-up data only: no real model, no data/.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-speed-"));
const fake = path.join(dir, "fake-agy.js");
// A fake agy: "init" after FAKE_INIT_MS, then answers one prompt after FAKE_THINK_MS.
fs.writeFileSync(fake, `
const initMs = Number(process.env.FAKE_INIT_MS || 0), thinkMs = Number(process.env.FAKE_THINK_MS || 0);
const out = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
setTimeout(() => out({ event: "init", init: {} }), initMs);
process.stdin.on("data", () => setTimeout(() => out({ event: "result", result: { status: "SUCCESS", response: "ok " + process.pid } }), thinkMs));
`);
const withEnv = async (env, fn) => {
  const before = {};
  for (const k of Object.keys(env)) { before[k] = process.env[k]; process.env[k] = env[k]; }
  try { return await fn(); } finally { for (const k of Object.keys(env)) { if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k]; } }
};

test("early: the spare for the next call starts while the call runs, so a second call right after it does not wait for agy's start", async () => {
  const { createWarmAgy } = require("../warmagy");
  await withEnv({ FAKE_INIT_MS: "300", FAKE_THINK_MS: "1200" }, async () => {
    const timeTwoCalls = async (early) => {
      const p = createWarmAgy({ command: process.execPath, prefixArgs: [fake], early });
      try {
        p.warmUp("m", null);
        await new Promise((r) => setTimeout(r, 1200)); // the first call finds a ready spare (a message after a short pause)
        await p.askText("round 1", "m", () => {});
        const spare = p._spares.get("m|");
        const readyRightAway = Boolean(spare && spare.ready);
        const t = Date.now();
        await p.askText("round 2", "m", () => {});
        return { second: Date.now() - t, readyRightAway };
      } finally { p.closeAll(); }
    };
    const late = await timeTwoCalls(false);
    const early = await timeTwoCalls(true);
    assert.strictEqual(late.readyRightAway, false, "without early the spare is only starting when round 1 ends");
    assert.strictEqual(early.readyRightAway, true, "with early the spare started during round 1 and is ready");
    assert.ok(early.second < late.second - 150, `round 2: early ${early.second} ms vs ${late.second} ms`);
  });
});

test("early: still one process per call (round 2 is answered by a different agy process than round 1)", async () => {
  const { createWarmAgy } = require("../warmagy");
  const p = createWarmAgy({ command: process.execPath, prefixArgs: [fake], early: true });
  try {
    const a = await p.askText("one", "m", () => {});
    const b = await p.askText("two", "m", () => {});
    assert.notStrictEqual(a, b);
    assert.strictEqual(p._spares.size, 1, "one waiting spare, never more per model");
  } finally { p.closeAll(); }
});

test("every agy model the brain or Omri's picker can put first has a warm spare (Neon medium started cold until 2026-11-23)", () => {
  const { WARM_MODELS, CHAIN } = require("../brain");
  const { MODELS } = require("../router");
  const { CHOICES } = require("../model-choice");
  for (const m of CHAIN.filter((x) => x.provider === "agy")) assert.ok(WARM_MODELS.has(m.model), m.model + " (chain)");
  for (const key of Object.keys(CHOICES)) if (MODELS[key].provider === "agy") assert.ok(WARM_MODELS.has(MODELS[key].model), MODELS[key].model + " (picker)");
});

function makeBrain({ choice = null, calendar } = {}) {
  const { createBrain } = require("../brain");
  const warmed = [];
  const asked = [];
  const brain = createBrain({
    courses: { allPages: () => [] },
    courseRoutes: { list: () => [], courseFiles: () => ({ files: [] }), linkFiles: () => [] },
    reminders: { list: () => [] }, memory: { list: () => [] }, cards: { add: () => ({}) },
    readCalendar: calendar || (async () => ({ text: "Monday: Demo lecture" })),
    askOne: async (provider, model, prompt) => { asked.push({ model, prompt }); return "Here is the answer."; },
    chain: [{ provider: "agy", model: "gemini-4-neon-low" }, { provider: "agy", model: "gemini-4-hydrogen-medium" }],
    poolLevels: async () => [], poolRows: async () => [], refreshPools: () => {}, notePoolFailure: () => {},
    modelChoice: choice ? { get: () => choice } : null,
    warmAgy: (model) => warmed.push(model),
  });
  return { brain, warmed, asked };
}

test("warmUp: the chain's first model before any message, then the model that answered last", async () => {
  const { brain, warmed } = makeBrain();
  assert.strictEqual(brain.warmUp(), "gemini-4-neon-low");
  await brain.handle("hello", { history: [] });
  assert.strictEqual(brain.warmUp(), "gemini-4-neon-low");
  assert.deepStrictEqual(warmed, ["gemini-4-neon-low", "gemini-4-neon-low"]);
});

test("warmUp: Omri's picked agy model is warmed; a Claude Code pick warms nothing of its own", () => {
  const { MODELS } = require("../router");
  const picked = makeBrain({ choice: { key: "neonMedium", label: "Neon medium", until: Date.now() + 60000, model: MODELS.neonMedium } });
  assert.strictEqual(picked.brain.warmUp(), "gemini-4-neon-medium");
  const claude = makeBrain({ choice: { key: "claudeSonnet", label: "Claude", until: Date.now() + 60000, model: MODELS.claudeSonnet } });
  assert.strictEqual(claude.brain.warmUp(), "gemini-4-neon-low", "Claude Code needs no agy: the chain's first agy model is warmed");
});

test("warmUp reads the calendar once; the message right after uses that read (no second Google call)", async () => {
  let reads = 0;
  const { brain, asked } = makeBrain({ calendar: async () => { reads++; await new Promise((r) => setTimeout(r, 50)); return { text: "Monday: Demo lecture" }; } });
  brain.warmUp();
  brain.warmUp(); // a second ping while the first read is still running shares it
  await brain.handle("what is on Monday?", { history: [] });
  assert.strictEqual(reads, 1);
  assert.match(asked[0].prompt, /## Calendar and reminders[\s\S]*Monday: Demo lecture/);
});

test("the calendar block keeps its place in the prompt (before the courses), read while the rest is built", async () => {
  const { brain, asked } = makeBrain();
  await brain.handle("hi", { history: [] });
  const p = asked[0].prompt;
  assert.ok(p.indexOf("## Right now") < p.indexOf("## Calendar and reminders"));
  assert.ok(p.indexOf("## Calendar and reminders") < p.indexOf("## Omri's courses in Bot"));
});

test("a general question still has no calendar block", async () => {
  const { brain, asked } = makeBrain();
  await brain.handle("hi", { history: [], route: "general" });
  assert.ok(!asked[0].prompt.includes("## Calendar and reminders"));
});

test("/api/brain/warm: JSON only, warms at most once every 20 s, and never needs the words", async () => {
  const http = require("node:http");
  const { createServer } = require("../server");
  const { createStore } = require("../store");
  let warms = 0;
  const server = createServer({
    store: createStore(fs.mkdtempSync(path.join(os.tmpdir(), "bot-speed-server-"))),
    makeBrain: () => ({ handle: async () => ({ answer: "x" }), warmUp: () => { warms++; return "gemini-4-neon-low"; } }),
    usage: async () => [], claudeUsage: async () => [],
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const post = (headers, body) => new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method: "POST", path: "/api/brain/warm", headers: { Host: `localhost:${port}`, ...headers } }, (res) => {
      let data = ""; res.on("data", (c) => (data += c)); res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error", reject); req.write(body); req.end();
  });
  try {
    const plain = await post({ "Content-Type": "text/plain" }, "{}");
    assert.notStrictEqual(plain.status, 200, "a non-JSON post (what another web site could send) is refused");
    assert.strictEqual(warms, 0);
    const first = await post({ "Content-Type": "application/json" }, "{}");
    assert.strictEqual(first.status, 200);
    assert.deepStrictEqual(JSON.parse(first.body), { warmed: true });
    const again = await post({ "Content-Type": "application/json" }, "{}");
    assert.deepStrictEqual(JSON.parse(again.body), { warmed: false }, "a second ping within 20 s does nothing");
    assert.strictEqual(warms, 1);
  } finally { server.close(); }
});

// ---- Moodle reads kept for a short time (2026-11-23, experiments/2026-11-23-speed-files-moodle.md) ----
function moodleWith({ failEvents = 0 } = {}) {
  const { createMoodleTools } = require("../moodle-tools");
  const asked = [];
  let clock = 1_000_000;
  let eventFails = failEvents;
  // item ids are unique across Moodle, as in the real one
  const items = (c) => [{ id: c * 100 + 1, name: "News", module: "forum", section: 10 }, { id: c * 100 + 2, name: "Sheet 1", module: "resource", section: 10 }];
  const bridge = {
    connected: () => true,
    ask: async (kind, args = {}) => {
      asked.push(kind);
      await new Promise((r) => setTimeout(r, 5));
      if (kind === "courses") return { data: [11, 12, 13, 14].map((id) => ({ id, name: "Demo course " + id, category: "x" })) };
      if (kind === "course") return { data: { sections: [{ id: 10, number: 0, title: "Week 1", cms: items(args.courseid).map((i) => i.id) }], items: items(args.courseid) } };
      if (kind === "events") { if (eventFails-- > 0) throw Object.assign(new Error("slow"), { code: "timeout" }); return { data: [{ name: "Sheet 1 due", courseId: 11, due: 1795000000 }] }; }
      if (kind === "forum") return { data: [{ d: 5, title: "Room change", time: 1794000000 }, { d: 6, title: "Welcome", time: 1793000000 }] };
      if (kind === "posts") return { data: [{ subject: "Room change", author: "TA", created: 1794000000, message: "<p>Room 34</p>", attachments: [] }] };
      throw new Error("unknown " + kind);
    },
  };
  const tools = createMoodleTools({ bridge, dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "bot-speed-moodle-")), courseRoutes: { list: () => [] }, now: () => clock });
  return { tools, asked, tick: (ms) => { clock += ms; } };
}
const count = (asked, kind) => asked.filter((k) => k === kind).length;

test("Moodle: 4 courses at once share ONE course list and ONE deadline list; moodle_news after moodle_course reads nothing twice", async () => {
  const { tools, asked } = moodleWith();
  const texts = await Promise.all(["11", "12", "13", "14"].map((id) => tools.courseText(id)));
  for (const t of texts) assert.match(t, /Newest posts/);
  assert.match(texts[0], /Sheet 1 due/);
  assert.strictEqual(count(asked, "courses"), 1);
  assert.strictEqual(count(asked, "events"), 1, "the deadline list of all courses is read once, not once per course");
  assert.strictEqual(count(asked, "course"), 4);
  assert.strictEqual(count(asked, "forum"), 4);
  await Promise.all(["11", "12", "13", "14"].map((id) => tools.newsText(id, undefined, 1)));
  assert.strictEqual(count(asked, "course"), 4, "contents kept from moodle_course");
  assert.strictEqual(count(asked, "forum"), 4, "forum lists kept from moodle_course");
  assert.strictEqual(count(asked, "posts"), 4, "the posts themselves are read");
});

test("Moodle: a new message a minute later reads the course fresh; deadlines are kept 3 minutes; a failed read is never kept", async () => {
  const { tools, asked, tick } = moodleWith({ failEvents: 1 });
  const first = await tools.courseText("11");
  assert.match(first, /deadlines could not be read/);
  const second = await tools.courseText("11");
  assert.match(second, /Sheet 1 due/, "the failed deadline read was asked again");
  assert.strictEqual(count(asked, "events"), 2);
  tick(61 * 1000);
  await tools.courseText("11");
  assert.strictEqual(count(asked, "course"), 2, "contents older than a minute are read again");
  assert.strictEqual(count(asked, "events"), 2, "deadlines kept for 3 minutes");
  tick(3 * 60 * 1000);
  await tools.courseText("11");
  assert.strictEqual(count(asked, "events"), 3);
});
