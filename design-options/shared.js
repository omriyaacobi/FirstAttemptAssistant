// Shared pieces for the design-option mockups. FAKE data and FAKE progress only: nothing here talks to Bot.
const $ = (s, r = document) => r.querySelector(s);
function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }
const clock = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;

// ---- Fake course data (made up; nothing from the real data/ folder) ----
const COURSES = [
  { id: "ds", name: "Data Structures", progress: 62, last: "Yesterday", next: "Finish the hash tables summary", files: [{ n: "Lecture 7 - Hash tables.pdf", p: 34 }, { n: "Tutorial 5.pdf", p: 12 }, { n: "Exam 2023 A.pdf", p: 9 }, { n: "Notes - trees.md", p: 3 }], topics: [["Arrays and lists", 1], ["Stacks and queues", 1], ["Trees", 1], ["Hash tables", 0], ["Graphs", 0]],
    chat: [["me", "What is the difference between chaining and open addressing?"], ["bot", "Chaining keeps a list in each bucket. Open addressing stores everything in the table and probes for a free slot. (Sample answer, from Lecture 7, page 12.)"]] },
  { id: "la", name: "Linear Algebra", progress: 35, last: "3 days ago", next: "Do exercises 4-6 on eigenvalues", files: [{ n: "Chapter 4 - Eigenvalues.pdf", p: 41 }, { n: "Homework 3.pdf", p: 6 }], topics: [["Vectors", 1], ["Matrices", 1], ["Determinants", 0], ["Eigenvalues", 0]],
    chat: [["me", "Explain eigenvalues in one sentence."], ["bot", "A vector the matrix only stretches, never turns; the stretch is the eigenvalue. (Sample answer.)"]] },
  { id: "os", name: "Operating Systems", progress: 12, last: "Last week", next: "Read about scheduling", files: [{ n: "Intro to processes.pdf", p: 28 }], topics: [["Processes", 1], ["Scheduling", 0], ["Memory", 0], ["Files", 0]],
    chat: [["bot", "Ask me anything about this course. (Sample.)"]] },
];

// ---- Navigation shell: a rail on the PC, a bottom tab bar on the phone ----
function mountShell(app, views, { start = "improve", labels = {} } = {}) {
  const shell = el("div", "shell"), rail = el("nav", "rail"), main = el("div", "main");
  rail.appendChild(Object.assign(el("h1", "grad", "Bot")));
  const names = Object.keys(views), btns = {}, panes = {};
  names.forEach((k) => {
    const b = el("button", "", labels[k] || k); btns[k] = b; rail.appendChild(b);
    const v = el("section", "view"); panes[k] = v; main.appendChild(v); views[k](v);
    b.onclick = () => show(k);
  });
  function show(k) { names.forEach((n) => { btns[n].classList.toggle("on", n === k); panes[n].classList.toggle("on", n === k); }); }
  shell.append(rail, main); app.appendChild(shell); show(start);
  return { show };
}
function banner(letter, idea) {
  const b = el("div", "banner"); b.innerHTML = ""; b.append(Object.assign(el("b", "", `Option ${letter}`)), el("span", "", idea), el("span", "", " · MOCKUP: fake data, nothing here is connected to Bot"));
  document.body.prepend(b); document.title = `Option ${letter} - Bot design`;
}

// ---- A plain chat, so "the regular chat" exists in each mockup ----
function plainChat(root, { onImprove } = {}) {
  const top = el("div", "topline"); top.append(el("strong", "", "New chat"));
  if (onImprove) { const b = el("button", "", "Improve Bot"); b.onclick = onImprove; top.appendChild(b); }
  const t = el("div", "ic-thread"); t.append(el("div", "me", "What should I revise first for the data structures exam?"), el("div", "bot", "Start with hash tables and graphs: they are the topics you have not finished yet. (Sample answer.)"));
  const c = el("div", "ic-composer"); c.append(Object.assign(el("textarea"), { rows: 2, placeholder: "Type a task..." }));
  const row = el("div", "row"); row.append(el("span", "muted small", "gemini/flash · everyday question"), el("button", "primary", "Send")); c.appendChild(row);
  root.append(top, t, c);
}

// ---- The tiny fake Bot used by Preview ----
function previewApp(accent, label) {
  const p = el("div", "pv"); p.style.setProperty("--pv", accent);
  const side = el("div", "pv-side"); side.append(el("b", "", "BOT"), el("div", "pv-item", "+ New chat"), el("div", "pv-item on", "Exam revision"), el("div", "pv-item", "Quota"), el("div", "pv-item", "Courses"));
  const m = el("div", "pv-main"); m.append(el("div", "pv-me", "Explain hash tables"), el("div", "pv-bot", "A table that finds a value by hashing its key. (Sample)"), el("div", "pv-send", "Send"));
  p.append(side, m); if (label) p.title = label; return p;
}
// A "Current / With the change" switch around the preview, so you can compare with the old look.
function previewBox(state) {
  const box = el("div", "stack"); const holder = el("div"); holder.style.minHeight = "280px";
  const seg = el("div", "seg"); const a = el("button", "", "Current Bot"), b = el("button", "on", "With the change");
  const draw = (neu) => { a.classList.toggle("on", !neu); b.classList.toggle("on", neu); holder.replaceChildren(previewApp(neu ? state.accent : "#b57bff")); };
  a.onclick = () => draw(false); b.onclick = () => draw(true); seg.append(a, b); draw(true);
  box.append(seg, holder, el("div", "muted small", "Sample chat. Nothing here is saved, and your real chats are never shown."));
  return box;
}
function openPreviewModal(state) {
  let m = $("#pvModal"); if (!m) { m = el("div", "modal"); m.id = "pvModal"; document.body.appendChild(m); m.onclick = (e) => { if (e.target === m) m.classList.remove("on"); }; }
  const box = el("div", "box"); const h = el("div", "topline"); h.style.padding = "0 0 10px"; const x = el("button", "ghost", "Close"); x.onclick = () => m.classList.remove("on"); h.append(el("strong", "", "Preview of the change"), x);
  box.append(h, previewBox(state)); m.replaceChildren(box); m.classList.add("on");
}

// ---- Improve Bot chat (fake editor). opts: onPreview(state), onChange(state), compact ----
const FAKE_STEPS = [["Making a private copy of Bot to work in...", 700], ["Running Bot's tests before changing anything...", 1400], ["Reading index.html", 800], ["Reading selfedit.js", 600], ["Editing index.html", 1500], ["Writing index.test.js", 900], ["Running the tests on the change (2 files changed)...", 1600]];
function ImproveChat(root, opts = {}) {
  const S = { status: "idle", msgs: [], queue: [], steps: [], pct: 0, t0: 0, accent: "#ff5a6e", files: ["public/index.html", "page.test.js"], round: 0 };
  root.classList.add("ic");
  const thread = el("div", "ic-thread"), comp = el("div", "ic-composer"), ta = el("textarea"); ta.rows = 2;
  const row = el("div", "row"), status = el("span", "muted small"), send = el("button", "primary", "Send");
  row.append(status, send); comp.append(ta, row); root.append(thread, comp);
  let timer = null;
  const change = () => { draw(); opts.onChange && opts.onChange(S); };
  function draw() {
    thread.replaceChildren();
    if (!S.msgs.length && S.status === "idle") {
      const e = el("div", "empty"); e.append(el("p", "", "Tell Bot what to change about itself. It edits a private copy, you watch it work, steer it with more messages, preview the result, and only then approve."));
      const c = el("div", "chips"); (opts.ideas || ["Make the accent color red", "Make the Courses page easier to use", "Add a dark/light switch"]).forEach((t) => { const b = el("button", "", t); b.onclick = () => { ta.value = t; ta.focus(); }; c.appendChild(b); });
      e.appendChild(c); thread.appendChild(e);
    }
    S.msgs.forEach((m) => thread.appendChild(m[0] === "me" ? el("div", "me", m[1]) : el("div", "bot", m[1])));
    S.queue.forEach((q) => { const d = el("div", "me", q); d.append(el("span", "small muted", "waiting for the editor to finish")); thread.appendChild(d); });
    if (S.status === "running") {
      const c = el("div", "bot live"); const h = el("div"); h.append(el("span", "spin"), Object.assign(el("strong", "", "The editor is working "), {}), Object.assign(el("span", "badge", "0:00"), { id: "ic-t" }));
      const last = S.steps[S.steps.length - 1] || "Starting...";
      const ul = el("ul", "steps"); S.steps.slice(-4, -1).forEach((s) => ul.appendChild(el("li", "", s)));
      const bar = el("div", "bar"); bar.appendChild(Object.assign(el("span"), {})); bar.firstChild.style.width = S.pct + "%";
      c.append(h, Object.assign(el("div"), { textContent: last, style: "font-weight:600;margin-top:6px" }), ul, bar, el("div", "muted small", "Works in a private copy: your live Bot is untouched. Write more below; it is sent when the editor finishes."));
      thread.appendChild(c);
    } else if (S.status === "ready") {
      const c = el("div", "card"); const h = el("div", "pill-row"); h.append(el("span", "badge", "ready"), el("span", "", "2 files changed"), el("span", "badge", "tests pass (312)"));
      const act = el("div", "actions"); const pv = el("button", "", "Preview"), ok = el("button", "ok", "Approve"), no = el("button", "danger", "Reject");
      pv.onclick = () => (opts.onPreview || openPreviewModal)(S); ok.onclick = () => { S.status = "approved"; change(); }; no.onclick = () => { S.status = "rejected"; change(); };
      act.append(pv, ok, no);
      const det = el("details"); det.append(el("summary", "muted small", "Show the technical details and code changes"), Object.assign(el("div", "diff"), { innerHTML: `<span class="d">-  --accent: #b57bff;</span>\n<span class="a">+  --accent: ${S.accent};</span>\n\n${S.files.join("\n")}` }));
      c.append(h, el("p", "muted small", "Nothing is changed in your real Bot yet. Preview it, ask for more, then approve or reject."), act, det); thread.appendChild(c);
    } else if (S.status === "approved") {
      const c = el("div", "card"); c.append(el("strong", "", "Merged into your project"), el("p", "muted small", "Commit 9a6664d, on your computer only. Reload the page to see it."), Object.assign(el("button", "", "Reload the page"), { onclick: () => alert("(mockup) the real page would reload") })); thread.appendChild(c);
    } else if (S.status === "rejected") {
      thread.appendChild(Object.assign(el("div", "card"), { textContent: "Thrown away. Your Bot keeps the old look. Write a new request below to try again." }));
    }
    ta.placeholder = S.status === "running" ? "The editor is busy. Write more here: it is sent when it finishes." : S.status === "ready" ? "Ask for another change, or Approve above..." : "Describe a change to Bot...";
    send.textContent = S.status === "running" ? "Queue" : "Send";
    thread.scrollTop = thread.scrollHeight;
  }
  function run(text) {
    S.status = "running"; S.steps = []; S.pct = 0; S.t0 = Date.now(); S.round++;
    if (/green/i.test(text)) S.accent = "#22c55e"; else if (/blue/i.test(text)) S.accent = "#3b82f6"; else if (S.round === 1) S.accent = "#ff5a6e";
    const plan = S.round > 1 ? FAKE_STEPS.slice(2) : FAKE_STEPS; let i = 0;
    change();
    const next = () => {
      if (i >= plan.length) {
        S.status = "ready"; S.msgs.push(["bot", `Done: ${S.round > 1 ? "applied your follow-up" : "changed the accent color and the Send button"}. (Mockup reply)`]);
        change(); if (S.queue.length) { const q = S.queue.splice(0).join("\n\n"); S.msgs.push(["me", q]); run(q); } return;
      }
      S.steps.push(plan[i][0]); S.pct = Math.round(((i + 1) / plan.length) * 100); change(); const d = plan[i][1]; i++; setTimeout(next, d);
    };
    setTimeout(next, 400);
  }
  function submit() {
    const t = ta.value.trim(); if (!t) return; ta.value = "";
    if (S.status === "running") { S.queue.push(t); return change(); }
    if (S.status === "approved" || S.status === "rejected") { S.msgs = []; S.round = 0; S.status = "idle"; }
    S.msgs.push(["me", t]); run(t);
  }
  send.onclick = submit; ta.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey && !matchMedia("(pointer: coarse)").matches) { e.preventDefault(); submit(); } };
  setInterval(() => { const t = $("#ic-t", root); if (t && S.status === "running") t.textContent = clock(Date.now() - S.t0); status.textContent = S.status === "running" ? "Last sign of life: just now" : ""; }, 1000);
  draw();
  return { state: S, submit, setText: (t) => { ta.value = t; } };
}
