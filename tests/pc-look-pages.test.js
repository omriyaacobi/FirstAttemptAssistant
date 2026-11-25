// tests/pc-look-pages.test.js
// NOTABILITY PAGES (2026-11-25, t40; experiments/2026-11-25-notability-pages.md): Bot reads pages of a Notability note in Chrome.
// The extension SCROLLS the note (the one kind of control Omri allowed), takes one picture per page and scrolls back.
// FAKES only: a fake Chrome (the note's numbers as measured on 2026-11-25), a fake bridge, fake models. No real browser or note.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createPcLook, checkPages, isNoteUrl } = require("../pc-look");
const { createBrain } = require("../brain");

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, 1)]);
const NOTE = "https://notability.com/app/note/0000-test";
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "pclook-pages-"));

// ---- the model's argument ----
test("pages: 'last', one page, a range; whole numbers 1-300, at most 4 pages, never backwards", () => {
  assert.deepStrictEqual(checkPages("last"), { last: true });
  assert.deepStrictEqual(checkPages(" LAST "), { last: true });
  assert.deepStrictEqual(checkPages(3), { from: 3, to: 3 });
  assert.deepStrictEqual(checkPages("3"), { from: 3, to: 3 });
  assert.deepStrictEqual(checkPages("3-5"), { from: 3, to: 5 });
  assert.deepStrictEqual(checkPages("3 to 6"), { from: 3, to: 6 });
  assert.deepStrictEqual(checkPages([2, 4]), { from: 2, to: 4 });
  assert.deepStrictEqual(checkPages({ from: 7, to: 8 }), { from: 7, to: 8 });
  for (const bad of ["5-3", 0, "0", 1.5, "301", "first", "3,5", "", null, true, { from: "x" }, [1, 2, 3], "1-2-3"]) assert.throws(() => checkPages(bad), /"pages" must be/, String(JSON.stringify(bad)));
  assert.throws(() => checkPages("1-5"), /at most 4 pages at a time/);
});

test("only a Notability note address counts as a note", () => {
  assert.ok(isNoteUrl(NOTE));
  assert.ok(isNoteUrl("https://www.notability.com/app/note/x"));
  for (const u of ["http://notability.com/app/note/x", "https://notability.com/", "https://notability.com.evil.example/app/note/x", "https://evil.example/app/note/x", "chrome://settings"]) assert.ok(!isNoteUrl(u), u);
});

// ---- pc-look.js: a page series through a fake extension ----
function world({ tabs, answer } = {}) {
  const dir = tmp();
  const calls = [];
  const T = tabs || [
    { id: 21, title: "Note", url: NOTE, active: true, windowState: "normal" },
    { id: 22, title: "Moodle", url: "https://moodle.bgu.ac.il/x", active: true, windowState: "normal" },
    { id: 23, title: "Note behind", url: NOTE, active: false, windowState: "normal" },
  ];
  const bridge = {
    ask: async (kind, args) => {
      calls.push({ kind, args });
      if (kind === "tabs") return { data: T };
      if (kind === "tab_pages") {
        if (answer) return answer(args);
        const shown = args.from === 0 ? [10] : Array.from({ length: args.to - args.from + 1 }, (_, i) => args.from + i);
        return { data: { url: NOTE, pages: 11, shown }, files: shown.map(() => ({ bytes: JPEG })) };
      }
      throw new Error("unexpected " + kind);
    },
  };
  let clock = Date.parse("2026-11-25T12:00:00Z");
  const pc = createPcLook({ dataDir: dir, bridge, run: async () => "[]", tmpDir: dir, now: () => clock });
  return { pc, dir, calls, tick: (ms) => { clock += ms; } };
}

test("a page series: numbers only to the extension, every picture checked and kept privately, deleted by drop", async () => {
  const w = world();
  await w.pc.tabs();
  const r = await w.pc.look(w.pc.pick("tab", 1), "pages", { from: 2, to: 3 });
  assert.strictEqual(r.kind, "pictures");
  assert.deepStrictEqual(r.pictures.map((p) => p.page), [2, 3]);
  assert.strictEqual(r.of, 11);
  assert.deepStrictEqual(w.calls[1], { kind: "tab_pages", args: { tabId: 21, from: 2, to: 3 } });
  for (const p of r.pictures) { assert.ok(fs.existsSync(p.path)); assert.strictEqual(path.basename(p.path), "look.jpg"); }
  r.pictures.forEach(w.pc.drop);
  assert.ok(r.pictures.every((p) => !fs.existsSync(p.dir)));
  const last = await w.pc.look(w.pc.pick("tab", 1), "pages", { last: true });
  assert.deepStrictEqual(w.calls[2].args, { tabId: 21, from: 0, to: 0 }, "'last' is from 0");
  assert.deepStrictEqual(last.pictures.map((p) => p.page), [10]);
  last.pictures.forEach(w.pc.drop);
});

test("pages only on a Notability note in front; another site is refused, a tab behind is said plainly", async () => {
  const w = world();
  await w.pc.tabs();
  await assert.rejects(w.pc.look(w.pc.pick("tab", 2), "pages", { last: true }), /only on a Notability note/);
  const behind = await w.pc.look(w.pc.pick("tab", 3), "pages", { last: true });
  assert.strictEqual(behind.kind, "unavailable");
  assert.match(behind.reason, /not the one in front/);
  await assert.rejects(w.pc.look(w.pc.pick("tab", 1), "pages", { from: 1, to: 9 }), /at most 4 pages/);
  assert.deepStrictEqual(w.calls.map((c) => c.kind), ["tabs"], "nothing was asked of the extension");
});

test("what comes back is checked: the same note, the asked pages, real pictures; otherwise nothing is kept", async () => {
  const cases = [
    [() => ({ data: { url: "https://moodle.bgu.ac.il/x", pages: 11, shown: [2] }, files: [{ bytes: JPEG }] }), /something else now/, "unavailable"],
    [() => ({ data: { url: NOTE, pages: 11, shown: [7] }, files: [{ bytes: JPEG }] }), /other pages than were asked/],
    [() => ({ data: { url: NOTE, pages: 11, shown: [2, 3] }, files: [{ bytes: JPEG }] }), /broken shape/],
    [() => ({ data: { url: NOTE, pages: 11, shown: [2] }, files: [{ bytes: Buffer.from("not a picture at all") }] }), /not a real JPEG or PNG/],
  ];
  for (const [answer, why, soft] of cases) {
    const w = world({ answer });
    await w.pc.tabs();
    if (soft) assert.match((await w.pc.look(w.pc.pick("tab", 1), "pages", { from: 2, to: 2 })).reason, why);
    else await assert.rejects(w.pc.look(w.pc.pick("tab", 1), "pages", { from: 2, to: 2 }), why);
    assert.deepStrictEqual(fs.readdirSync(w.dir).filter((n) => n.startsWith("bot-look-")), [], "no picture kept");
  }
  // a picture that is good, then a bad one: the good one is deleted too
  const w = world({ answer: () => ({ data: { url: NOTE, pages: 11, shown: [2, 3] }, files: [{ bytes: JPEG }, { bytes: Buffer.from("junk") }] }) });
  await w.pc.tabs();
  await assert.rejects(w.pc.look(w.pc.pick("tab", 1), "pages", { from: 2, to: 3 }), /not a real JPEG/);
  assert.deepStrictEqual(fs.readdirSync(w.dir).filter((n) => n.startsWith("bot-look-")), []);
});

test("the hour limit counts every page: 28 looks + 3 pages is refused, 2 pages still fit", async () => {
  const w = world();
  await w.pc.tabs();
  const t = w.pc.pick("tab", 1);
  for (let i = 0; i < 14; i++) (await w.pc.look(t, "pages", { from: 1, to: 2 })).pictures.forEach(w.pc.drop); // 28 pictures
  await assert.rejects(w.pc.look(t, "pages", { from: 1, to: 3 }), (e) => e.code === "limit" && /3 pages would pass the limit of 30/.test(e.message));
  (await w.pc.look(t, "pages", { from: 1, to: 2 })).pictures.forEach(w.pc.drop);
  await assert.rejects(w.pc.look(t, "pages", { last: true }), (e) => e.code === "limit");
  w.tick(3600 * 1000 + 1);
  assert.strictEqual((await w.pc.look(t, "pages", { last: true })).kind, "pictures");
});

test("the card carries the pages to the grant ('Just this once' reads the same pages)", async () => {
  const w = world();
  await w.pc.tabs();
  const card = w.pc.propose(w.pc.pick("tab", 1), "pages", { task: "read pages 3-4", pages: { from: 3, to: 4 } });
  assert.strictEqual(card.how, "pages");
  assert.strictEqual(card.pages, "pages 3-4");
  const g = w.pc.takeGrant(w.pc.decide(card.id, "once").grantId);
  assert.deepStrictEqual(g.pages, { from: 3, to: 4 });
  assert.throws(() => w.pc.propose(w.pc.pick("tab", 1), "pages", { pages: { from: 1, to: 6 } }), /at most 4 pages/);
});

// ---- the bridge ----
test("the bridge: tab_pages takes whole numbers only; a list of at most 4 pictures comes back, only for tab_pages", async () => {
  const { createBridge, checkArgs } = require("../moodle-bridge");
  assert.deepStrictEqual(checkArgs("tab_pages", { tabId: 5, from: 0, to: 0 }), { tabId: 5, from: 0, to: 0 });
  assert.throws(() => checkArgs("tab_pages", { tabId: 5, from: "3-5", to: 5 }), /whole number from/);
  assert.throws(() => checkArgs("tab_pages", { tabId: 5, from: 1 }), /whole number to/);
  const b = createBridge();
  b.next({});
  const b64 = JPEG.toString("base64");
  const run = async (kind, args, body) => { const p = b.ask(kind, args); const job = b.next({}); b.result({ id: job.id, ok: true, ...body }); return p; };
  const ok = await run("tab_pages", { tabId: 5, from: 1, to: 2 }, { data: { shown: [1, 2] }, files: [{ base64: b64 }, { base64: b64 }] });
  assert.strictEqual(ok.files.length, 2);
  assert.ok(ok.files[0].bytes.equals(JPEG));
  await assert.rejects(run("tab_pages", { tabId: 5, from: 1, to: 2 }, { files: Array(5).fill({ base64: b64 }) }), /at most 4 pictures/);
  await assert.rejects(run("tab_pages", { tabId: 5, from: 1, to: 2 }, { files: [{ base64: "@@not base64@@" }] }), /came back broken/);
  await assert.rejects(run("tab_shot", { tabId: 5 }, { files: [{ base64: b64 }] }), /only for tab_pages/);
});

// ---- the extension (fake chrome; the note's numbers as measured on 2026-11-25) ----
function loadExtension(chrome, globals) {
  const file = require.resolve("../moodle-extension/background.js");
  delete require.cache[file];
  const saved = {};
  for (const k of ["chrome", ...Object.keys(globals)]) saved[k] = global[k];
  global.chrome = chrome;
  Object.assign(global, globals);
  const ext = require(file);
  delete require.cache[file];
  Object.assign(ext.PACE, { gap: 0, settle: 0, poll: 1, wait: 20 });
  return { ext, restore: () => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete global[k]; else global[k] = v; } } };
}
const WHITE = new Uint8ClampedArray(4 * 1000).fill(255);
const GRID = (() => { const a = new Uint8ClampedArray(WHITE); for (let i = 0; i < a.length; i += 64) a.set([195, 210, 240, 255], i); return a; })();
const INK = (() => { const a = new Uint8ClampedArray(GRID); for (let i = 0; i < a.length; i += 160) a.set([30, 70, 200, 255], i); return a; })();

// stale: Chrome stopped painting (a fully covered window): every capture is the frame from where the note was (page 5).
// blankSame: empty screens look exactly alike wherever they are. hidden: the page reports visibilityState "hidden".
function fakeNote({ inkPages = [10], url = NOTE, active = true, failCapture = false, moveAfter = 0, stale = false, blankSame = false, hidden = false } = {}) {
  const s = { hidden, top: 4300, height: 10882, view: 759, pages: 11, page: 5, vw: 1920, canvas: { top: 88, bottom: 855, left: 320, right: 1920 }, pageLeft: 738, pageRight: 1503, toolbarTop: 770 };
  const pitch = s.height / s.pages;
  const done = [];
  let tabUrl = url;
  let captures = 0;
  const chrome = {
    windows: { get: async () => ({ id: 1, state: "normal" }) },
    tabs: {
      get: async (id) => ({ id, windowId: 1, active, url: tabUrl, title: "Note" }),
      captureVisibleTab: async () => {
        captures++;
        if (failCapture) throw new Error("capture failed");
        if (moveAfter && captures >= moveAfter) tabUrl = "https://notability.com/app/note/other";
        done.push(["shot", s.top]);
        const frame = stale ? "4300" : blankSame && !inkPages.includes(Math.floor((s.top + 1) / pitch) + 1) ? "blank" : String(s.top);
        return "data:text/plain;base64," + Buffer.from(frame).toString("base64");
      },
      update: async () => done.push(["update"]), create: async () => done.push(["create"]),
    },
    scripting: {
      executeScript: async ({ args }) => {
        const target = args && args[0];
        if (typeof target === "number") { s.top = Math.max(0, Math.min(target, s.height - s.view)); done.push(["scroll", s.top]); return [{ result: { top: s.top } }]; }
        return [{ result: JSON.parse(JSON.stringify(s)) }];
      },
    },
  };
  // The picture work, faked: a capture "is" its scroll position; a page has ink when a screen of an inked page was drawn on it.
  class OffscreenCanvas {
    constructor(w, h) { this.width = w; this.height = h; this.tops = []; }
    getContext() {
      return {
        fillRect: () => {}, set fillStyle(v) {},
        drawImage: (bmp, sx, sy, sw, sh, dx) => { this.tops.push(bmp.top); },
        getImageData: () => ({ data: this.tops.some((t) => inkPages.includes(Math.floor((t + 1) / pitch) + 1)) ? INK : GRID }),
      };
    }
    async convertToBlob() { return new Blob([JPEG]); }
  }
  const globals = { OffscreenCanvas, createImageBitmap: async (blob) => ({ width: 1920, top: Number(await blob.text()) }) };
  return { chrome, globals, s, done, pitch };
}

test("extension: slices cover a page screen by screen, never past the end; ink is told from paper and grid", () => {
  const { ext, restore } = loadExtension(fakeNote().chrome, {});
  try {
    assert.deepStrictEqual(ext.slices(0, 989, 676, 10123), [{ scroll: 0, from: 0, to: 676 }, { scroll: 676, from: 676, to: 989 }]);
    assert.deepStrictEqual(ext.slices(0, 500, 676, 10123), [{ scroll: 0, from: 0, to: 500 }], "a short page is one screen");
    const end = ext.slices(9893, 10882, 676, 10123);
    assert.deepStrictEqual(end, [{ scroll: 9893, from: 9893, to: 10569 }, { scroll: 10123, from: 10569, to: 10799 }], "the last page stops where the note cannot scroll");
    assert.ok(ext.inkShare(WHITE) === 0 && ext.inkShare(GRID) === 0, "paper and grid lines are not ink");
    assert.ok(ext.inkShare(INK) > 0.0005, "blue handwriting is ink");
    assert.ok(ext.isNote(NOTE) && !ext.isNote("https://notability.com/"));
  } finally { restore(); }
});

test("extension: pages 2-3 are scrolled to, one joined picture each, and the note is scrolled back", async () => {
  const f = fakeNote();
  const { ext, restore } = loadExtension(f.chrome, f.globals);
  try {
    const r = await ext.JOBS.tab_pages({ tabId: 7, from: 2, to: 3 });
    assert.deepStrictEqual(r.data, { url: NOTE, pages: 11, shown: [2, 3] });
    assert.deepStrictEqual(r.files.map((x) => x.name), ["page2.jpg", "page3.jpg"]);
    assert.strictEqual(Buffer.from(r.files[0].base64, "base64").subarray(0, 3).toString("hex"), "ffd8ff");
    assert.deepStrictEqual(f.done.filter(([k]) => k === "shot").length, 5, "one first picture where the note is, then two screens per page");
    assert.strictEqual(f.s.top, 4300, "scrolled back where it was");
    assert.deepStrictEqual(f.done.filter(([k]) => k === "update" || k === "create"), [], "no tab was changed, switched or opened");
  } finally { restore(); }
});

test("extension: 'last' skips the empty last page; all empty is said plainly; still scrolled back", async () => {
  const f = fakeNote({ inkPages: [10] });
  let { ext, restore } = loadExtension(f.chrome, f.globals);
  try {
    const r = await ext.JOBS.tab_pages({ tabId: 7, from: 0, to: 0 });
    assert.deepStrictEqual(r.data.shown, [10]);
    assert.strictEqual(r.files.length, 1);
    assert.strictEqual(f.s.top, 4300);
  } finally { restore(); }
  const e = fakeNote({ inkPages: [] });
  ({ ext, restore } = loadExtension(e.chrome, e.globals));
  try {
    await assert.rejects(ext.JOBS.tab_pages({ tabId: 7, from: 0, to: 0 }), (x) => x.code === "unavailable" && /last 4 pages of the note look empty/.test(x.message));
    assert.strictEqual(e.s.top, 4300);
  } finally { restore(); }
});

test("extension: only a note, only in front; a page past the end; leaving the note or a failed capture stops and scrolls back", async () => {
  const check = async (opts, args, why) => {
    const f = fakeNote(opts);
    const { ext, restore } = loadExtension(f.chrome, f.globals);
    try {
      await assert.rejects(ext.JOBS.tab_pages(args), why);
      if (f.done.some(([k]) => k === "scroll")) assert.strictEqual(f.s.top, 4300, "scrolled back");
      return f;
    } finally { restore(); }
  };
  const other = await check({ url: "https://moodle.bgu.ac.il/x" }, { tabId: 7, from: 1, to: 1 }, (e) => e.code === "refused");
  assert.deepStrictEqual(other.done, [], "another site: nothing scrolled or captured");
  await check({ active: false }, { tabId: 7, from: 1, to: 1 }, (e) => e.code === "unavailable" && /not the one in front/.test(e.message));
  await check({}, { tabId: 7, from: 12, to: 12 }, (e) => e.code === "unavailable" && /only 11 pages/.test(e.message));
  await check({ moveAfter: 1 }, { tabId: 7, from: 1, to: 2 }, (e) => e.code === "unavailable" && /left the note/.test(e.message));
  await check({ failCapture: true }, { tabId: 7, from: 1, to: 1 }, /capture failed/);
});

// ---- the brain ----
function brainSetup(replies, { lists = { sites: ["notability.com"], apps: [] }, image = null } = {}) {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "pc-look.json"), JSON.stringify(lists));
  const asked = [];
  const pc = createPcLook({
    dataDir: dir, tmpDir: dir, run: async () => "[]",
    bridge: { ask: async (kind, args) => { asked.push({ kind, args }); if (kind === "tabs") return { data: [{ id: 21, title: "Note", url: NOTE, active: true }, { id: 22, title: "Moodle", url: "https://moodle.bgu.ac.il/x", active: true }] }; const shown = args.from === 0 ? [9] : Array.from({ length: args.to - args.from + 1 }, (_, i) => args.from + i); return { data: { url: NOTE, pages: 11, shown }, files: shown.map(() => ({ bytes: JPEG })) }; } },
  });
  const prompts = [];
  const imageCalls = [];
  let i = 0;
  const next = async (prompt) => { prompts.push(prompt); const r = replies[i++]; if (r === undefined) throw new Error("no more scripted replies"); return r; };
  const brain = createBrain({
    courses: { allPages: () => [] }, courseRoutes: { list: () => [], courseFiles: () => ({ files: [] }), linkFiles: () => [] }, coach: null,
    reminders: { list: () => [] }, memory: { list: () => [], add: () => ({}) }, cards: { add: () => ({}) }, readCalendar: async () => ({ text: "" }),
    askOne: (p, m, prompt) => next(prompt),
    askImage: (model, prompt, pics) => { imageCalls.push({ pics: [].concat(pics), exist: [].concat(pics).map((p) => fs.existsSync(p)) }); return next(prompt); },
    chain: [{ provider: "agy", model: "fake-agy" }], photoChain: [{ provider: "agy", model: "fake-agy" }],
    poolLevels: async () => [], poolRows: async () => [], refreshPools: () => {}, notePoolFailure: () => {},
    now: () => Date.parse("2026-11-25T10:00:00Z"), pcLook: pc,
  });
  return { brain, pc, dir, prompts, imageCalls, asked, all: () => prompts.join("\n"), image };
}

test("brain: pages 3-5 are ONE look with three pictures, each named by page, seen together, deleted after the answer", async () => {
  const s = brainSetup(['CALL {"tool":"chrome_tabs"}', 'CALL {"tool":"pc_look","kind":"tab","number":1,"pages":"3-5"}', "Page 3 has the integral."]);
  const r = await s.brain.handle("read pages 3-5 of my notability note", { history: [], courses: [] });
  assert.deepStrictEqual(s.asked[1], { kind: "tab_pages", args: { tabId: 21, from: 3, to: 5 } });
  assert.strictEqual(s.imageCalls.length, 1);
  assert.strictEqual(s.imageCalls[0].pics.length, 3);
  assert.deepStrictEqual(s.imageCalls[0].exist, [true, true, true]);
  assert.match(s.prompts[2], /"photo1\.jpg" = the notability\.com tab, page 3 of 11; "photo2\.jpg" = the notability\.com tab, page 4 of 11; "photo3\.jpg" = the notability\.com tab, page 5 of 11/);
  assert.match(s.all(), /Bot scrolled the Notability note in the notability\.com tab and took 3 pictures, one per page: pages 3, 4, 5 of 11/);
  assert.deepStrictEqual(r.pcLooks, ["the notability.com tab (pages 3, 4, 5 of 11)"]);
  assert.ok(s.imageCalls[0].pics.every((p) => !fs.existsSync(p)), "deleted after the answer");
});

test("brain: 'last' reads the last page with writing; the series counts as ONE of the 3 looks a message", async () => {
  const look = 'CALL {"tool":"pc_look","kind":"tab","number":1,"pages":"last"}';
  const s = brainSetup(['CALL {"tool":"chrome_tabs"}', [look, look, look, look].join("\n"), "Done."]);
  await s.brain.handle("what did I write last, four times", { history: [], courses: [] });
  assert.strictEqual(s.asked.filter((a) => a.kind === "tab_pages").length, 3);
  assert.match(s.all(), /the last page with writing/);
  assert.match(s.all(), /Bot looks at most 3 times in one message/);
});

test("brain: a message holds at most 4 pictures; pages need a note tab; a card carries the pages", async () => {
  const two = 'CALL {"tool":"pc_look","kind":"tab","number":1,"pages":"1-3"}';
  const s = brainSetup(['CALL {"tool":"chrome_tabs"}', two + "\n" + two, "Done."]);
  await s.brain.handle("read pages 1-3 twice", { history: [], courses: [] });
  assert.match(s.all(), /one message holds at most 4 pictures \(3 taken already\)/);
  assert.strictEqual(s.asked.filter((a) => a.kind === "tab_pages").length, 1);
  const moodle = brainSetup(['CALL {"tool":"chrome_tabs"}', 'CALL {"tool":"pc_look","kind":"tab","number":2,"pages":"last"}', "Done."], { lists: { sites: ["moodle.bgu.ac.il"], apps: [] } });
  await moodle.brain.handle("read the last page of my moodle tab", { history: [], courses: [] });
  assert.match(moodle.all(), /"pages" works only on a Chrome tab with a Notability note/);
  const card = brainSetup(['CALL {"tool":"chrome_tabs"}', 'CALL {"tool":"pc_look","kind":"tab","number":1,"pages":"2"}', "A card asks first."], { lists: { sites: [], apps: [] } });
  const r = await card.brain.handle("read page 2 of my note", { history: [], courses: [], messageId: "q1" });
  assert.strictEqual(r.pcLookCard.how, "pages");
  assert.strictEqual(r.pcLookCard.pages, "page 2");
  assert.ok(!card.asked.some((a) => a.kind === "tab_pages"), "nothing scrolled before the tap");
  const bad = brainSetup(['CALL {"tool":"chrome_tabs"}', 'CALL {"tool":"pc_look","kind":"tab","number":1,"pages":"the end"}', "Done."]);
  await bad.brain.handle("read the end of my note", { history: [], courses: [] });
  assert.match(bad.all(), /"pages" must be "last", a page number, or a range/);
});

// ---- a fully covered note window (measured 2026-11-25: Chrome stops painting it and returns the old frame) ----
test("extension: a stale frame (the same picture at another scroll position) is refused, never labelled as a page; scrolled back", async () => {
  for (const args of [{ tabId: 7, from: 3, to: 4 }, { tabId: 7, from: 0, to: 0 }, { tabId: 7, from: 5, to: 5 }]) {
    const f = fakeNote({ stale: true, inkPages: [5, 10] });
    const { ext, restore } = loadExtension(f.chrome, f.globals);
    try {
      await assert.rejects(ext.JOBS.tab_pages(args), (e) => e.code === "unavailable" && e.message === "the note's window is fully covered, so Chrome isn't drawing it; leave a strip of it visible, or put it beside Bot", JSON.stringify(args));
      assert.strictEqual(f.s.top, 4300, "scrolled back");
    } finally { restore(); }
  }
});

test("extension: empty grid screens that look alike are NOT taken for a stale frame ('last' still skips empty pages)", async () => {
  const f = fakeNote({ blankSame: true, inkPages: [9] });
  const { ext, restore } = loadExtension(f.chrome, f.globals);
  try {
    const r = await ext.JOBS.tab_pages({ tabId: 7, from: 0, to: 0 });
    assert.deepStrictEqual(r.data.shown, [9]);
  } finally { restore(); }
});

test("extension: a page Chrome reports as hidden is refused before anything is scrolled or captured", async () => {
  const f = fakeNote({ hidden: true });
  const { ext, restore } = loadExtension(f.chrome, f.globals);
  try {
    await assert.rejects(ext.JOBS.tab_pages({ tabId: 7, from: 1, to: 1 }), /fully covered, so Chrome isn't drawing it/);
    assert.deepStrictEqual(f.done.filter(([k]) => k === "scroll" || k === "shot"), []);
  } finally { restore(); }
});
