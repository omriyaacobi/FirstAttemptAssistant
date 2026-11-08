// page.test.js
// Checks the layout of the web page (public/index.html) without opening a browser.
// Run with:  node --test

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");

test("the Improve button is the last thing in the sidebar and has its own big style", () => {
  const side = html.slice(html.indexOf('<aside class="side"'), html.indexOf("</aside>"));
  const button = side.indexOf('id="improveBtn"');
  assert.ok(button > 0, "button is inside the sidebar");
  assert.ok(button > side.indexOf('id="quotaBtn"'), "button comes after the quota button");
  assert.match(side.slice(side.lastIndexOf("<button", button), button), /class="improve"/);
  assert.match(html, /button\.improve\s*\{[^}]*margin-top:\s*auto/);
});

test("the page uses a purple accent", () => {
  assert.match(html, /--accent:\s*#9333ea/);
});

test("the dark Midnight design is the default, and the Classic design is kept to switch back to", () => {
  assert.match(html, /<html[^>]*data-theme="midnight"/);
  assert.match(html, /:root\[data-theme="midnight"\]\s*\{[^}]*--bg:\s*#0c0b10/);
  assert.match(html, /:root\[data-theme="midnight"\]\s*\{[^}]*--pink:/);
  // every design in the picker is either Classic (the base styles) or has its own block
  const side = html.slice(html.indexOf('<aside class="side"'), html.indexOf("</aside>"));
  const picker = side.match(/<select id="themePick"[^>]*>([\s\S]*?)<\/select>/);
  assert.ok(picker, "the design picker is in the sidebar");
  const names = [...picker[1].matchAll(/value="([^"]+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(names.slice(0, 2), ["midnight", "classic"]);
  for (const name of names.filter((n) => n !== "classic")) assert.ok(html.includes(`:root[data-theme="${name}"]`), name);
  assert.ok(side.indexOf('id="themePick"') < side.indexOf('id="improveBtn"'), "Improve Bot stays last");
  assert.match(html, /localStorage\.setItem\("botTheme"/);
});

test("the phone's Back button is handled with the History API", () => {
  assert.match(html, /history\.pushState/);
  assert.match(html, /addEventListener\("popstate"/);
  // the base screen is stored first, so Back from it leaves the app instead of looping
  assert.match(html, /history\.replaceState\(navState, ""\);\s*\/\/ the base screen/);
});

test("the sidebar can be closed without choosing a chat: backdrop, close button, swipe", () => {
  assert.match(html, /id="backdrop"/);
  assert.match(html, /id="sideClose"[^>]*aria-label="[^"]+"/);
  assert.match(html, /\$\("backdrop"\)\.addEventListener\("click", closeSide\)/);
  assert.match(html, /\$\("sideClose"\)\.addEventListener\("click", closeSide\)/);
  assert.match(html, /touchend/);
});

test("the Chats button is an accessible 44px icon button", () => {
  for (const id of ["menu", "menu2"]) {
    const tag = html.match(new RegExp(`<button[^>]*id="${id}"[^>]*>`))[0];
    assert.match(tag, /class="iconbtn"/);
    assert.match(tag, /aria-label="Show conversations"/);
  }
  assert.match(html, /\.iconbtn \{[^}]*width: 44px; height: 44px/);
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /env\(safe-area-inset-top\)/);
});

test("the photo button is a round icon button with a preview chip, and photos are shrunk in the page", () => {
  const tag = html.match(/<button[^>]*id="attach"[^>]*>/)[0];
  assert.doesNotMatch(tag, /\bhidden\b/);
  assert.match(tag, /aria-label="Attach a photo"/);
  assert.match(html, /<input type="file" id="photoInput" accept="image\/\*" hidden>/);
  assert.match(html, /button\.attach \{[^}]*width: 44px; height: 44px/);
  assert.match(html, /id="photoChip"/);
  assert.match(html, /createImageBitmap/);
  assert.match(html, /toDataURL\("image\/jpeg"/);
  assert.match(html, /image: attached\.dataUrl/); // the photo travels with the message
});

test("sending a message starts a background job and the page follows it by polling, not by one long request", () => {
  assert.match(html, /fetch\("\/api\/jobs/);
  assert.doesNotMatch(html, /getReader\(\)/);
  // no chat switching or composer lock-out depends on a request being open any more
  assert.doesNotMatch(html, /if \(busy\) return;/);
});

test("the quota is a pop-up opened from a sidebar button, not a panel in the middle of the sidebar", () => {
  const side = html.slice(html.indexOf('<aside class="side"'), html.indexOf("</aside>"));
  assert.match(side, /<button id="quotaBtn"[^>]*aria-haspopup="dialog"/);
  assert.doesNotMatch(side, /id="quota"/); // the numbers live in the dialog, outside the sidebar
  const dialog = html.match(/<dialog class="popup" id="quotaDialog"[\s\S]*?<\/dialog>/);
  assert.ok(dialog, "the dialog exists");
  assert.match(dialog[0], /id="quota"/);
  assert.match(dialog[0], /id="quotaClose"/);
  assert.match(html, /showModal\(\)/);
  assert.match(html, /\[data-theme="midnight"\] dialog\.popup/); // styled in both designs
  assert.match(html, /dialog\.popup \{[^}]*var\(--card\)/);
  assert.match(html, /dialog\.popup \{[^}]*calc\(100vw - 32px\)/); // fits a phone
});

test("Improve Bot is a chat: progress, follow-ups, preview, and simple Approve and Reject buttons", () => {
  const view = html.slice(html.indexOf('<section class="chat" id="improveView"'), html.indexOf("<script>"));
  for (const id of ["improveThread", "improveText", "improveStart", "newImprove", "previewFrame"]) assert.ok(view.includes(`id="${id}"`), id);
  assert.match(view, /<iframe id="previewFrame"[^>]*sandbox="allow-scripts"/); // no allow-same-origin
  assert.doesNotMatch(view, /allow-same-origin/);
  assert.ok(html.includes("`/api/selfedit/${p.id}/message`")); // a follow-up goes to the same proposal
  assert.ok(html.includes("`/api/selfedit/${id}/preview`"));
  assert.match(html, /"approve", "Approve"/);
  assert.match(html, /"danger", "Reject"/);
  assert.match(html, /Show the technical details and code changes/); // the diff is folded away, not removed
  assert.match(html, /Last sign of life/); // so it is clear the editor is alive
  assert.match(html, /queued\.push/); // messages typed while it works wait their turn
  assert.match(html, /\.preview-box \{/); // Preview is a popup over the dimmed chat, not a full page
});

test("the list of what Bot knows about me is folded until you open it", () => {
  assert.match(html, /<details>\s*<summary[^>]*><strong>What Bot knows about me<\/strong><\/summary>\s*<div id="memory"/);
});

const study = fs.readFileSync(path.join(__dirname, "..", "public", "study.js"), "utf8");

test("every course card is exactly the same size, and a long name is cut instead of growing the card", () => {
  assert.match(html, /\.course-grid \{[^}]*grid-auto-rows: 112px/);
  assert.match(html, /\.course-card strong \{[^}]*-webkit-line-clamp: 2/);
  assert.match(study, /card\.title = c\.name/); // the full name stays reachable
});

test("course cards and pages show only real data (no invented progress, percentages or next steps)", () => {
  for (const invented of ["conic-gradient", "% studied", "Continue where", "last studied", "Next step"]) assert.ok(!new RegExp(invented, "i").test(study), invented);
  assert.ok(study.includes("${c.pages} pages read")); // name, files, pages read, files being read: what /api/courses gives
});

test("Add material is on every course screen, and one picker outside the redrawn area keeps the chosen file", () => {
  assert.match(study, /"\+ Add material"/);
  assert.match(study, /picker\.id = "studyPicker"/);
  assert.match(study, /view\.appendChild\(picker\)/);
  assert.match(study, /status\.id = "uploadStatus"/); // the upload message is drawn from uploadNote on every redraw
  assert.match(html, /<button id="quotaBtn"/); // Quota is in the sidebar, which is the phone's menu too
  assert.match(html, /id="attach"[^>]*aria-label="Attach a photo"/); // the camera button stays in the chat
});

// ---- course chats: the typing bug and the chat screen ----

// A tiny fake page, just enough to run public/study.js and count how often it rebuilds the screen.
function fakeStudyPage({ course }) {
  const vm = require("node:vm");
  const counts = { redraws: 0 };
  const timers = [];
  const make = (tag) => ({
    tag, tagName: tag.toUpperCase(), children: [], className: "", textContent: "", style: {}, hidden: false, listeners: {},
    appendChild(c) { this.children.push(c); return c; },
    append(...cs) { cs.forEach((c) => this.children.push(c)); },
    prepend(c) { this.children.unshift(c); },
    replaceChildren() { if (this === body) counts.redraws++; this.children = []; },
    addEventListener(type, fn) { this.listeners[type] = fn; },
    setAttribute() {}, click() {}, remove() {},
    contains(n) { return n === this || this.children.some((c) => c.contains && c.contains(n)); },
  });
  const byId = { sourceDialog: make("dialog"), sourceClose: make("button"), studyView: make("section"), studyBody: make("div"), studyTitle: make("h1"), studyStatus: make("span"), studyBtn: make("button"), menu3: make("button"), courseChats: make("button"), courseSources: make("button"), courseNew: make("button"), coursePanel: make("div") };
  const body = byId.studyBody;
  const document = { activeElement: null, createTextNode: (t) => ({ text: t }), addEventListener() {} };
  const state = { course: JSON.parse(JSON.stringify(course)) };
  const sandbox = {
    document, window: {}, console, JSON, Promise, Map, Set, Error, RegExp, Math, String, Number, Array, Object,
    $: (id) => byId[id], el: (tag, cls, text) => { const e = make(tag); e.className = cls || ""; if (text !== undefined) e.textContent = text; return e; },
    renderText: (t) => ({ text: t }), navGo() {}, showView() {}, openSide() {}, newChat() {}, openChat() {}, chatMarker: () => null,
    currentId: null, courseNames: new Map(), jobState: { active: new Map() }, confirm: () => true, prompt: () => null,
    XMLHttpRequest: function () {},
    setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1] = null; },
    fetch: async (url) => ({ ok: true, status: 200, json: async () => (url.endsWith("/api/courses") ? { courses: [] } : { course: state.course, chats: [] }) }),
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "public", "study.js"), "utf8"), sandbox);
  const firePoll = async () => { const t = timers.filter(Boolean).pop(); timers.length = 0; if (t) await t(); await new Promise((r) => setImmediate(r)); return !!t; };
  return { sandbox, body, document, counts, state, firePoll, pending: () => timers.filter(Boolean).length, make };
}

test("the course screen is never redrawn while you type, or when nothing changed (the old box lost its cursor every poll)", async () => {
  const reading = { id: "0123456789abcdef", name: "Calc", files: [{ id: "fedcba9876543210", name: "a.pdf", status: "reading", pages: 0, progress: "page 3" }] };
  const page = fakeStudyPage({ course: reading });
  page.sandbox.window.studyShow(reading.id);
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(page.counts.redraws, 1);
  assert.strictEqual(page.pending(), 1, "a file is being read, so the screen keeps checking");

  assert.ok(await page.firePoll());
  assert.strictEqual(page.counts.redraws, 1, "nothing changed: the screen must not be rebuilt");

  const box = page.make("input"); // you are typing in a box on this screen while the file finishes
  page.body.appendChild(box);
  page.document.activeElement = box;
  page.state.course.files[0].status = "ready";
  await page.firePoll();
  assert.strictEqual(page.counts.redraws, 1, "something changed, but you are typing: the box must keep its cursor");

  page.document.activeElement = null; // you stopped typing: now the news is drawn
  page.state.course.files[0].pages = 7;
  assert.strictEqual(page.pending(), 1);
  await page.firePoll();
  assert.strictEqual(page.counts.redraws, 2);
  assert.strictEqual(page.pending(), 0, "nothing is being read any more, so the checking stops");
});

test("a course chat is the regular chat screen: same box, same messages, plus a way back to the course", () => {
  assert.ok(!/<textarea/.test(study) && !study.includes('"studyQ"'), "the course screen has no question box of its own any more");
  assert.match(html, /id="courseBar"[^>]*hidden/); // only shown inside a course chat
  assert.match(html, /\.coursebar\[hidden\] \{ display: none; \}/);
  assert.ok(html.includes("courseId: currentCourse.id")); // a new chat in a course says which course
  assert.ok(html.includes("if (c.courseId) return;")); // course chats are listed in their course, not in the sidebar
  assert.match(html, /result\.mode === "course"/); // the answer shows the file and page chips
  assert.match(html, /studyOpenSource\(result\.courseId, s\.fileId, s\.file, s\.page\)/);
  assert.match(html, /id="sourceDialog"/, "a source opens in a popup over the chat, so the chat stays where it is");
  assert.match(study, /id = "newCourseChat"|start\.id = "newCourseChat"/);
  assert.match(study, /Delete the chat/);
  // model and file text only ever through textContent
  assert.doesNotMatch(study, /\.innerHTML\s*=|insertAdjacentHTML|document\.write\(/);
});

test("the phone's Back button works inside a course: a course opened or left is a history step", () => {
  assert.ok(html.includes('showView("study", s.course)')); // Back to a study entry reopens that course
  assert.ok(html.includes("sameCourse(target.course, here.course)"));
  assert.match(study, /navGo\(\{ view: "study", id: currentId, course: id \}\)/);
});

test("the course screen has Sources beside Chats: drop zone, per-file status, tick boxes; the chat bar has Chats, Sources and + New chat", () => {
  assert.match(study, /dropzone/);
  assert.match(study, /document\.addEventListener\("drop"/); // drag and drop
  assert.match(study, /picker\.multiple = true/); // several files at once
  assert.match(study, /\/use`, \{ use: tick\.checked \}/); // the tick
  assert.match(study, /Use in chats: /); // the tick has an accessible name
  assert.match(html, /id="courseNew"/);
  assert.match(html, /id="courseChats"/);
  assert.match(html, /id="courseSources"/);
  assert.match(html, /\.course-cols \{[^}]*grid-template-columns/);
  assert.ok(!html.includes('$("attach").hidden = !!currentCourse'), "the camera button stays in course chats");
  assert.doesNotMatch(study, /\.innerHTML\s*=|insertAdjacentHTML|document\.write\(/);
});

test("the page polls fast (0.6 s) during the first 40 s of a task, so a front desk reply is not shown up to 2 s late", () => {
  assert.match(html, /FAST_POLL_WINDOW_MS\s*=\s*40000/);
  const poll = html.slice(html.indexOf("async function pollJobs"), html.indexOf("window.addEventListener(\"focus\", pollJobs)"));
  assert.match(poll, /Date\.now\(\) \+ jobState\.offset - j\.startedAt < FAST_POLL_WINDOW_MS/); // the age of the job, by the server's clock
  assert.match(poll, /\? 600 : jobState\.active\.size \? 2000 : 10000/); // fast, then slow while something long runs, then idle
});

test("the message box stays on screen: the page's row cannot grow with the sidebar or a long chat", () => {
  assert.match(html, /\.app \{[^}]*grid-template-rows: minmax\(0, 1fr\)/);
});

test("a course answer shows when it is not only from the files, and web sources apart from the file chips (text only)", () => {
  assert.match(html, /result\.outside/);
  assert.match(html, /"sub web-sources", "Web: " \+ result\.web\.sources\.join/);
  assert.match(html, /result\.web\.failed/);
});

test("the page shows the quota note under an answer when quota changed the route", () => {
  assert.match(html, /function quotaNote\(parent, result\)/);
  assert.match(html, /quotaNote\(card, result\)/);
  assert.match(html, /quotaNote\(wrap, result\)/);
});
