// tests/course-work.test.js
// "Already worked on in this course" (course-work.js). 2026-11-16: in a long tutoring evening Bot offered exercises done hours
// earlier as "the next part" three times. Code now lists Bot's own formulas of that course from the last 2 days. Made-up data.
const test = require("node:test");
const assert = require("node:assert");
const { workDone, MAX_CHARS } = require("../course-work");
const { createBrain } = require("../brain");

const NOW = Date.UTC(2026, 10, 16, 17, 35); // 19:35 in Israel
const H = 3600 * 1000;
const ans = (at, text, courseId = "calc") => ({ role: "assistant", at, text, result: { brain: true, courseId } });

test("lists Bot's formulas of that course, oldest first, once each, with the time", () => {
  const list = workDone([
    ans(NOW - 4.5 * H, "Try this:\n$$\\int x e^x \\, dx$$\nWhat is u?"),
    ans(NOW - 4 * H, "Another one: $$\\int \\sin^2(x)\\,dx$$"),
    ans(NOW - 3 * H, "Again $$\\int x e^x\\,dx$$ (same as before)"),
    ans(NOW - 2 * H, "Other course $$\\int_0^1 y\\,dy$$", "other"),
    { role: "user", at: NOW - H, text: "$$\\int 1\\,dx$$" },
    ans(NOW - 50 * H, "Too old $$a^2+b^2$$"),
  ], "calc", { now: NOW, timeZone: "Asia/Jerusalem" });
  const lines = list.split("\n");
  assert.strictEqual(lines.length, 2, list);
  assert.match(lines[0], /^- today 15:05: \$\\int x e\^x \\, dx\$$/);
  assert.match(lines[1], /sin\^2/);
  assert.ok(!/y\\,dy|a\^2|\\int 1/.test(list), "other courses, Omri's own text and old answers are not listed");
});

test("nothing for an unknown course, and the list never grows past its cap", () => {
  assert.strictEqual(workDone([ans(NOW - H, "$$x$$")], "", { now: NOW }), "");
  const many = Array.from({ length: 60 }, (_, i) => ans(NOW - H + i, `$$\\int x^{${i}} ${"y".repeat(130)}\\,dx$$`));
  const list = workDone(many, "calc", { now: NOW, timeZone: "Asia/Jerusalem" });
  assert.ok(list.length <= MAX_CHARS);
  assert.match(list, /x\^\{59\}/, "the newest is kept");
});

test("an exercise given inside a sentence (an inline integral) is listed too; ordinary inline symbols are not", () => {
  const list = workDone([ans(NOW - H, "Right, $u = x$ and $v' = e^x$. What would you choose in $\\int \\ln(x) \\, dx$? And then:\n$$\\int x e^x\\,dx$$")], "calc", { now: NOW, timeZone: "Asia/Jerusalem" });
  assert.match(list, /\\int \\ln\(x\)/);
  assert.match(list, /\\int x e\^x/);
  assert.ok(!/u = x/.test(list) && !/v' = e\^x/.test(list));
  assert.strictEqual(list.split("\n").length, 2);
});

test("the brain shows the list for the course the talk is in", async () => {
  const prompts = [];
  const COURSES = [{ id: "calc", name: "Calculus 2" }];
  const brain = createBrain({
    courses: { allPages: () => [] },
    courseRoutes: { list: () => COURSES, courseFiles: () => ({ files: [] }), linkFiles: () => [] },
    coach: { tracker: { refsFor: (l) => l.map((c) => ({ key: c.id, courseId: c.id, name: c.name })), course: (r) => ({ key: r.key, assignments: [], position: {} }), save: () => {}, getSession: () => null, timetable: () => ({ courses: [] }) }, pendingProposal: () => null, answerStudy: async () => ({ answer: "x" }) },
    reminders: { list: () => [], create: () => ({}) },
    memory: { list: () => [], add: () => ({}) },
    cards: { add: () => ({}) },
    readCalendar: async () => ({ text: "" }),
    askOne: async (p, m, prompt) => { prompts.push(prompt); return "ok"; },
    chain: [{ provider: "agy", model: "fake-model" }],
    poolLevels: async () => [], refreshPools: () => {}, notePoolFailure: () => {},
    now: () => Date.now(),
    folderRules: { system: [] },
    courseWork: (id) => (id === "calc" ? "- today 15:05: $\\int x e^x dx$" : ""),
  });
  await brain.handle("what is left in Calculus 2 lecture 4?", { history: [], courses: COURSES });
  assert.match(prompts[0], /## Already worked on in Calculus 2 \(last 2 days\)[\s\S]*do not offer one of them again as new[\s\S]*\\int x e\^x dx/);
});
