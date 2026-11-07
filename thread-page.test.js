// thread-page.test.js
// Checks the one-conversation part of the web page (public/index.html) without opening a browser:
// the pure helpers are run on their own, and the rest is checked as text. (The real look was checked in a browser by hand.)
// Run with:  node --test

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "public", "index.html"), "utf8");
const threadScript = (html.match(/<script id="threadScript">([\s\S]*?)<\/script>/) || [])[1] || "";
const pure = (threadScript.match(/\/\/ <thread-pure>([\s\S]*?)\/\/ <\/thread-pure>/) || [])[1] || "";

// The helpers have no page in them, so they run in an empty sandbox.
function helpers() {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(pure + "\nthis.out = { tDayKey, tDayLabel, tDayOpen, tRoute, tAskAgainText, tStudyLines, T_PAGE };", sandbox);
  return sandbox.out;
}
const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();

test("the thread script is its own block, it compiles, and it only starts when the server says so", () => {
  assert.ok(threadScript.length > 1000, "the thread script is in the page");
  assert.doesNotThrow(() => new vm.Script(threadScript));
  assert.match(html, /if \(session\.thread && window\.botThread\) window\.botThread\.start\(\);\s*else \{ showEmpty\(\); loadChats\(\); pollJobs\(\); \}/);
  // with the switch off nothing of the thread runs: the old poller is also guarded, so the two never both follow jobs
  assert.match(html, /async function pollJobs\(\) \{\s*if \(session\.thread\) return;/);
  // start() is the only thing that changes the page: nothing at the top level of the thread script touches the DOM
  const outside = threadScript.replace(/window\.botThread = \(\(\) => \{[\s\S]*\}\)\(\);/, "");
  assert.doesNotMatch(outside, /document\.|\$\(/);
});

test("the thread script puts text in with textContent only (no innerHTML)", () => {
  assert.doesNotMatch(threadScript, /\.innerHTML\s*=|insertAdjacentHTML|document\.write\(|outerHTML/);
});

test("the Restart Bot button exists before the script that wires it (the old page had it after the script)", () => {
  const button = html.indexOf('id="restartTop"');
  assert.ok(button > 0);
  assert.ok(button < html.indexOf("<script>"), "the button comes before the first script");
});

test("days: today and yesterday are open, older days are folded away, labels are plain", () => {
  const h = helpers();
  const now = at(2026, 11, 7);
  assert.strictEqual(h.tDayKey(at(2026, 11, 7, 0)), "2026-11-07");
  assert.strictEqual(h.tDayLabel("2026-11-07", now), "Today");
  assert.strictEqual(h.tDayLabel("2026-11-06", now), "Yesterday");
  assert.match(h.tDayLabel("2026-11-03", now), /Tue.*3.*Nov/);
  assert.match(h.tDayLabel("2025-12-24", now), /2025/); // another year shows the year
  assert.strictEqual(h.tDayOpen("2026-11-07", now), true);
  assert.strictEqual(h.tDayOpen("2026-11-06", now), true);
  assert.strictEqual(h.tDayOpen("2026-11-05", now), false);
  assert.strictEqual(h.T_PAGE, 50);
});

test("the route chip: a course name, Calendar, Study, an earlier chat, or General", () => {
  const h = helpers();
  const courses = new Map([["c1", "Calculus 2"]]);
  assert.deepStrictEqual({ ...h.tRoute({ topic: "course:c1" }, courses) }, { label: "Calculus 2", wrong: true });
  assert.strictEqual(h.tRoute({ topic: "course:zzz" }, courses).label, "Course"); // a course that is gone
  assert.strictEqual(h.tRoute({ topic: "course:zzz", result: { courseName: "Old name" } }, courses).label, "Old name");
  assert.strictEqual(h.tRoute({ topic: "calendar" }, courses).label, "Calendar");
  assert.strictEqual(h.tRoute({ topic: "study" }, courses).label, "Study");
  assert.deepStrictEqual({ ...h.tRoute({ topic: "general" }, courses) }, { label: "General", wrong: false });
  assert.deepStrictEqual({ ...h.tRoute({ topic: "general", imported: { title: "x" } }, courses) }, { label: "Earlier chat", wrong: false });
  assert.deepStrictEqual({ ...h.tRoute({}, courses) }, { label: "General", wrong: false });
  // a topic that is not text is never trusted
  assert.strictEqual(h.tRoute({ topic: { x: 1 } }, courses).label, "General");
});

test("'ask again normally' keeps the question and says in plain words what to change", () => {
  const h = helpers();
  const text = h.tAskAgainText("What is a pointer?");
  assert.ok(text.endsWith("What is a pointer?"));
  assert.match(text, /ordinary question/);
});

test("Study page lines come from the tracker's numbers, from ready-made text, or say 'not known'", () => {
  const h = helpers();
  const a = h.tStudyLines({ held: 6, understood: 1, behind: [1, 2], position: { known: true, n: 5, note: "by parts" }, assignments: [{ title: "HW3", due: "2026-11-20" }, { nope: 1 }], topicsDue: 2, question: "Start HW3?" });
  assert.strictEqual(a.should, "6 lectures held so far");
  assert.strictEqual(a.at, "Lecture 5, by parts");
  assert.deepStrictEqual([...a.due], ["HW3 (due 2026-11-20)", "2 topics to review"]);
  assert.strictEqual(a.question, "Start HW3?");
  const b = h.tStudyLines({ shouldBe: "Lecture 7", youAre: "Lecture 4", due: [{ title: "Quiz" }], openQuestion: "Which topic?" });
  assert.strictEqual(b.should, "Lecture 7");
  assert.strictEqual(b.at, "Lecture 4");
  assert.deepStrictEqual([...b.due], ["Quiz"]);
  assert.strictEqual(b.question, "Which topic?");
  const c = h.tStudyLines({ held: 0, understood: 3, behind: [1] });
  assert.strictEqual(c.should, "No lectures held yet");
  assert.match(c.at, /3 lectures checked as understood, 1 behind/);
  const empty = h.tStudyLines({});
  assert.strictEqual(empty.should, null);
  assert.strictEqual(empty.at, null);
  assert.deepStrictEqual([...empty.due], []);
  assert.strictEqual(empty.question, null);
  // junk and huge values are cut or ignored
  const junk = h.tStudyLines({ shouldBe: 5, youAre: "x".repeat(1000), assignments: "no" });
  assert.strictEqual(junk.should, null);
  assert.strictEqual(junk.at.length, 300);
  assert.deepStrictEqual([...junk.due], []);
});

test("the page keeps what the task asked for: composer open, trash, notice, older messages, study page, files", () => {
  // the composer is never locked while a job runs: only the moment of sending disables Send
  assert.match(threadScript, /updateComposer = \(\) => \{ \$\("send"\)\.disabled = T\.busy; \}/);
  // answers sit under their own question
  assert.match(threadScript, /m\.replyTo && T\.msgs\.has\(m\.replyTo\)/);
  // trash: delete and restore use the server routes
  assert.match(threadScript, /\/api\/thread\/" \+ m\.id, \{ method: "DELETE" \}/);
  assert.match(threadScript, /\/api\/thread\/\$\{m\.id\}\/restore/);
  // paging: older messages by "before"
  assert.match(threadScript, /before=\$\{T\.oldest\}/);
  // the first-use notice says how to go back
  assert.match(threadScript, /BOT_THREAD=off/);
  assert.match(threadScript, /botThreadNotice/);
  // the Study page exists and reaches the old Courses screen for files
  assert.match(html, /id="tstudyView"/);
  assert.match(threadScript, /showView\("study", c\.id\)/);
  // a file that is not a picture goes to a course through the existing upload route
  assert.match(threadScript, /\/api\/courses\/\$\{pick\.value\}\/files\?name=/);
  // old Courses code is still there for the switch-off mode
  assert.match(html, /<script src="\/study\.js"><\/script>/);
});

test("phone: no sideways scroll rules and 44 px tap targets for the new buttons", () => {
  for (const sel of [".tdayhead", ".tagain", ".tready", ".tolderrow button", ".ttrash button", ".tproposal button"]) {
    const rule = new RegExp(sel.replace(/[.]/g, "\\.") + "[^{]*\\{[^}]*min-height:\\s*44px");
    assert.match(html, rule, sel);
  }
  assert.match(html, /\.tmsg\.sel \.tdel[^{]*\{[^}]*min-height:\s*44px/);
  assert.match(html, /body\.thread button\.chip \{ min-height: 44px; \}/);
  // the Study grid shrinks to one column on a phone
  assert.match(html, /\.tstudy-grid \{[^}]*minmax\(min\(100%, 300px\), 1fr\)/);
});

test("Study page lines read the REAL /api/study shape (copied from a running server in the night check)", () => {
  const h = helpers();
  const real = { id: "1c0bd5cbbdcdc210", name: "Calculus 2", tracked: true, shouldBe: { held: 6, lastLecture: { n: 6, date: "2026-11-04" }, nextLecture: { n: 7, date: "2026-11-09" } }, you: { positionKnown: true, position: { seenThrough: "2026-11-02", note: "" }, withMaterial: 6, understood: 0 }, behind: [{ date: "2026-11-02", n: 5, hasMaterial: true, topic: "" }, { date: "2026-11-04", n: 6, hasMaterial: true, topic: "" }], due: [], assignments: [], questions: ["Where are you in Calculus 2?", "Lecture 1 has no material."] };
  const r = h.tStudyLines(real);
  assert.match(r.should, /^6 lectures held so far, last: lecture 6 \(.*4 Nov\)\. Next: lecture 7 \(.*9 Nov\)$/);
  assert.match(r.at, /^Up to lecture 5 \(.*2 Nov\)\. 0 lectures checked as understood$/);
  assert.strictEqual(r.question, "Where are you in Calculus 2? (+1 more)");
  const none = h.tStudyLines({ ...real, you: { positionKnown: false, position: null, withMaterial: 0, understood: 0 } });
  assert.match(none.at, /^You have not told Bot yet/);
});
