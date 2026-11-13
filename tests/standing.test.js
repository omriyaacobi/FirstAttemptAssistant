// standing.test.js: step 4 of the "where am I" plan. The reader (a model proposes) and the validator (code decides). Made-up text and fake models only.
const test = require("node:test");
const assert = require("node:assert");
const plan = require("../study-plan");
const { buildOutline } = require("../outline");
const { contextFor, checkStanding } = require("../standing");

const TODAY = "2026-11-08";
const filler = (n) => Array.from({ length: n }, (_, i) => `Made-up sentence ${i} about the topic at hand.`).join("\n");
const held = (k) => Array.from({ length: k }, (_, i) => ({ n: i + 1, date: plan.addDays("2026-09-27", 7 * (i + 1)) }));
// ONE big document, headings only (the real-world shape): one page, six headings
const BIG = [{ fileId: "big", fileName: "all-notes.html", page: 1, text: ["# Intro", filler(40), "# Memory management", filler(40), "# Paging", filler(40), "# Scheduling", filler(40), "# Files", filler(40), "# Security", filler(40)].join("\n") }];
// a 12-page file with real pages and lecture headings
const PAGED = Array.from({ length: 12 }, (_, i) => ({ fileId: "pg", fileName: "slides.pdf", page: i + 1, text: `${i % 3 === 0 ? `Lecture ${i / 3 + 1}: Topic ${i / 3 + 1}\n` : ""}${filler(8)}` }));
const ctxOf = (o = {}) => contextFor({ held: held(6), nextSlot: { n: 7, date: TODAY }, outline: buildOutline(BIG), today: TODAY, lang: "en", ...o });
const check = (raw, o) => checkStanding(raw, ctxOf(o));

test("valid reading: closed fields kept, a fraction becomes a REAL heading", () => {
  const r = check({ mode: "selfStudy", pace: "behind", depth: "shaky", goal: "concepts", focus: "memory management", where: { type: "fraction", value: 0.5 } });
  assert.deepStrictEqual(r.dropped, []);
  assert.strictEqual(r.fields.mode, "selfStudy");
  assert.strictEqual(r.fields.where.type, "section");
  assert.ok(["Paging", "Scheduling", "Memory management"].includes(r.fields.where.name), r.fields.where.name);
  assert.strictEqual(r.fields.goal, "concepts");
  assert.strictEqual(r.fields.depth, "shaky");
  assert.strictEqual(r.any, true);
});

test("an invented section, a page of a one-page file, page 9999 and a future date are dropped with a reason, never stored", () => {
  const a = check({ where: { type: "section", name: "Quantum chapter" }, mode: "selfStudy" });
  assert.strictEqual(a.fields.where, undefined);
  assert.strictEqual(a.fields.mode, "selfStudy"); // the valid part stays
  assert.match(a.dropped[0].why, /no heading/);
  const b = check({ where: { type: "pages", from: 1, to: 38 } }); // the big file has no real pages
  assert.strictEqual(b.fields.where, undefined);
  assert.match(b.dropped[0].why, /no real page numbers/);
  const c = check({ where: { type: "pages", from: 1, to: 9999 } }, { outline: buildOutline(PAGED) });
  assert.strictEqual(c.fields.where, undefined);
  assert.match(c.dropped[0].why, /12 pages/);
  const d = check({ where: { type: "date", date: "2026-12-30" } });
  assert.strictEqual(d.fields.where, undefined);
  assert.match(d.dropped[0].why, /not come yet/);
  const e = check({ where: { type: "date", date: "2026-02-31" } });
  assert.strictEqual(e.fields.where, undefined);
  assert.strictEqual(e.dropped.length, 1);
});

test("real pages are accepted and name the section they fall in", () => {
  const r = check({ where: { type: "pages", from: 1, to: 7 } }, { outline: buildOutline(PAGED) });
  assert.deepStrictEqual(r.fields.where, { type: "pages", from: 1, to: 7 });
  assert.strictEqual(r.notes.section.lecture, 3);
  assert.strictEqual(r.notes.pageCount, 12);
});

test("'lecture N' against the held lectures: held is kept; N = held + 1 with a lecture today means 'in progress'; further is dropped", () => {
  assert.deepStrictEqual(check({ where: { type: "lecture", n: 4 } }).fields.where, { type: "lecture", n: 4 });
  const now = check({ where: { type: "lecture", n: 7 } });
  assert.deepStrictEqual(now.fields.where, { type: "lecture", n: 6 });
  assert.strictEqual(now.notes.inProgress, 7);
  const far = check({ where: { type: "lecture", n: 12 } });
  assert.strictEqual(far.fields.where, undefined);
  assert.match(far.dropped[0].why, /6 held/);
  const noSlot = check({ where: { type: "lecture", n: 7 } }, { nextSlot: { n: 7, date: plan.addDays(TODAY, 9) } }); // the next lecture is far away: not believed
  assert.strictEqual(noSlot.fields.where, undefined);
  // the NOTES hold a lecture 7 heading although the timetable does not: that is a real place
  const withLec = check({ where: { type: "lecture", n: 7 } }, { nextSlot: null, outline: buildOutline([{ fileId: "l", fileName: "x.pdf", page: 1, text: Array.from({ length: 8 }, (_, i) => `Lecture ${i + 1}: T${i + 1}\n${filler(6)}`).join("\n") }]) });
  assert.strictEqual(withLec.fields.where.type, "section");
});

test("'N lectures behind' and 'N weeks behind' are COMPUTED from the timetable (the model's own place is not used)", () => {
  const a = check({ mode: "attending", behindBy: { unit: "lectures", amount: 2 } });
  assert.deepStrictEqual(a.fields.where, { type: "lecture", n: 4 });
  assert.strictEqual(a.fields.pace, "behind");
  assert.strictEqual(a.notes.derived, true);
  const b = check({ behindBy: { unit: "weeks", amount: 3 } });
  assert.deepStrictEqual(b.fields.where, { type: "lecture", n: 3 }); // 3 weeks before 2026-11-08 is 2026-10-18, lecture 3
  const c = check({ mode: "selfStudy", behindBy: { unit: "weeks", amount: 3 } }); // not attending: nothing to count from the timetable
  assert.strictEqual(c.fields.where, undefined);
  const d = check({ behindBy: { unit: "lectures", amount: 99 } }); // above the cap: dropped
  assert.strictEqual(d.fields.behindBy, undefined);
  assert.strictEqual(d.dropped.length, 1);
});

test("closed enums: a value outside the lists is dropped; 'understood' has no field at all", () => {
  const r = check({ mode: "genius", pace: "warp", depth: "understood", goal: "everything", understood: true, understoodLectures: [1, 2], x: "y" });
  assert.deepStrictEqual(r.fields, {});
  assert.strictEqual(r.any, false);
  assert.ok(r.dropped.length >= 4);
  assert.strictEqual(JSON.stringify(r).includes("understood\":true"), false);
});

test("gaps: only held lectures and real headings; control characters and long text are cleaned", () => {
  const r = check({ gaps: [{ kind: "lecture", n: 4 }, { kind: "lecture", n: 40 }, { kind: "section", name: "Paging" }, { kind: "section", name: "Nope" }], focus: "old\u0000 exercises\n" + "y".repeat(300) });
  assert.deepStrictEqual(r.fields.gaps, [{ kind: "lecture", n: 4 }, { kind: "section", name: "Paging" }]);
  assert.strictEqual(r.dropped.length, 2);
  assert.ok(r.fields.focus.length <= 80);
  assert.doesNotMatch(r.fields.focus, /[\u0000-\u001f]/);
});

test("the exam is only PROPOSED: a date computed by code from 'in N days'; a bad number is dropped", () => {
  assert.strictEqual(check({ examInDays: 14 }).exam.date, "2026-11-22");
  assert.strictEqual(check({ examInDays: 0 }).exam, null);
  assert.strictEqual(check({ examInDays: 5000 }).exam, null);
  assert.strictEqual(check({ examInDays: "soon" }).exam, null);
  assert.strictEqual(check({ examDate: "2026-12-01" }).exam, null); // a date written by the model is not used
});

test("a missed section that is also the place reached is a contradiction: dropped with a reason; 'at the start' with no notes is not an error", () => {
  const a = check({ where: { type: "section", name: "Paging" }, gaps: [{ kind: "section", name: "Paging" }, { kind: "section", name: "Files" }] });
  assert.deepStrictEqual(a.fields.gaps, [{ kind: "section", name: "Files" }]);
  assert.match(a.dropped[0].why, /both the place you reached and a missed part/);
  const b = check({ where: { type: "fraction", value: 0 } }, { outline: { files: [] } });
  assert.deepStrictEqual(b.dropped, []);
  const c = check({ where: { type: "fraction", value: 0.4 } }, { outline: { files: [] } });
  assert.strictEqual(c.dropped.length, 1); // a real place with no notes to point at is still said
});

test("garbage from the model never throws", () => {
  for (const raw of [null, undefined, "text", 5, [], { where: "lecture 4" }, { where: { type: "lecture", n: "four" } }, { where: { type: "pages", from: "a" } }, { behindBy: 3 }, { gaps: "all" }]) assert.doesNotThrow(() => check(raw));
});

