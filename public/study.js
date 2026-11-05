// public/study.js: the "Courses" screen (study notebooks). Loaded by index.html after its main script,
// so it can use that script's helpers ($, el, renderText, openSide, navGo, showView).
// Like the main page, it only ever uses textContent (never innerHTML): file names and model answers are untrusted.
(function () {
  const view = $("studyView");
  const body = $("studyBody");
  let courses = [];
  let current = null; // { course, chats } of the open course, or null for the course list
  let tab = "chats";
  let timer = null;
  let uploadNote = null; // { text, bad }: kept across redraws too, so a refused file is never wiped off the screen
  const openPages = new Map();
  // The file picker lives outside the redrawn area (a redraw while the phone's file dialog is open would
  // otherwise throw the chosen file away). Every "Add material" button just clicks this one.
  const picker = el("input");
  picker.type = "file";
  picker.multiple = true;
  picker.hidden = true; // no "accept" filter: it greys out other files with no explanation. The server says why it refused.
  picker.id = "studyPicker";
  view.appendChild(picker); // file id -> { pages, more } for the "view text" panels

  const api = async (url, options) => {
    const res = await fetch(url, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "error " + res.status);
    return data;
  };
  const post = (url, data) => api(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data || {}) });
  const button = (label, onClick, cls) => { const b = el("button", cls || "ghost", label); b.type = "button"; b.addEventListener("click", onClick); return b; };

  function toast(text) { const s = $("studyStatus"); s.textContent = text; s.className = "status bad"; }
  function fail(error) { toast(error.message); }

  // ---- polling: only while a file is being read or a chat of this course is thinking, and only while this screen is visible ----
  const thinking = () => (current ? current.chats.filter((c) => jobState.active.has(c.id)).map((c) => c.id) : []);
  function busyNow() {
    return current && (thinking().length > 0 || current.course.files.some((f) => f.status === "queued" || f.status === "reading"));
  }
  function schedule() {
    clearTimeout(timer);
    // Keeps going while busy, and also while the screen is waiting for you to stop typing so the news can be drawn.
    if (view.hidden || !current || !(busyNow() || snapshot() !== drawn)) return;
    timer = setTimeout(() => refresh().catch(() => schedule()), 3000);
  }
  // What the screen was last drawn from. A refresh redraws ONLY when this changed, and never while you are typing in
  // a box on this screen: a redraw replaces every element, which would throw away the cursor and what you typed.
  let drawn = "";
  const snapshot = () => JSON.stringify([current, thinking()]);
  const typingHere = () => { const a = document.activeElement; return !!a && body.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName); };
  async function refresh() {
    if (!current) return;
    const id = current.course.id;
    const data = await api("/api/courses/" + id);
    if (!current || current.course.id !== id) return;
    current = data;
    if (snapshot() !== drawn && !typingHere()) draw();
    schedule();
  }

  // ---- screens ----
  async function loadList() {
    current = null;
    ({ courses } = await api("/api/courses"));
    draw();
  }

  // focus (optional): { fileId, page }, opens that page of a file in the Materials tab (used by the source chips in a chat).
  async function openCourse(id, focus) {
    current = await api("/api/courses/" + id);
    courseNames.set(id, current.course.name);
    tab = "chats";
    uploadNote = null;
    openPages.clear();
    draw();
    schedule();
    if (focus) openFilePages(focus.fileId, focus.page);
  }
  const goCourse = (id) => { navGo({ view: "study", id: currentId, course: id }); return openCourse(id).catch(fail); };

  function draw() {
    drawn = snapshot();
    body.replaceChildren();
    $("studyTitle").textContent = current ? current.course.name : "Courses";
    $("studyStatus").textContent = "";
    if (!current) return drawList();
    drawCourse();
  }

  function drawList() {
    body.appendChild(el("p", "sub", "One tab for each course. Upload its slides, exams and notes once, then start chats in it: every chat can use the course materials, and Bot searches only that course and reads only the few pages that matter."));
    const grid = el("div", "course-grid");
    courses.forEach((c) => {
      const card = el("button", "card course-card");
      card.type = "button";
      const name = card.appendChild(el("strong", "", c.name));
      name.dir = "auto";
      card.title = c.name; // the card cuts a long name; the full one shows on hover
      card.appendChild(el("div", "sub", `${c.files} file${c.files === 1 ? "" : "s"}, ${c.pages} pages read` + (c.reading ? `, ${c.reading} being read` : "")));
      card.addEventListener("click", () => goCourse(c.id));
      grid.appendChild(card);
    });
    body.appendChild(grid);
    if (!courses.length) body.appendChild(el("p", "sub", "No courses yet. Add your first one below."));
    const form = el("form", "row");
    const input = el("input");
    input.placeholder = "Add a course (for example: Calculus 2)";
    input.setAttribute("aria-label", "New course name");
    input.dir = "auto";
    input.maxLength = 60;
    form.append(input, el("button", "", "Add course"));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!input.value.trim()) return;
      try { await post("/api/courses", { name: input.value }); await loadList(); } catch (error) { fail(error); }
    });
    body.appendChild(form);
  }

  function drawCourse() {
    const { course } = current;
    const head = el("div", "row");
    head.style.marginTop = "0";
    head.append(button("< All courses", () => { navGo({ view: "study", id: currentId, course: null }); loadList().catch(fail); }), button("+ Add material", () => picker.click(), "primary add-material"));
    body.appendChild(head);
    // The upload messages stay here across redraws, in both tabs, so a refused file is never wiped off the screen.
    const status = el("div", uploadNote && uploadNote.bad ? "status bad" : "status", uploadNote ? uploadNote.text : "");
    status.id = "uploadStatus";
    body.appendChild(status);
    const tabs = el("div", "row");
    tabs.style.justifyContent = "flex-start";
    [["chats", `Chats (${current.chats.length})`], ["files", `Materials (${course.files.length})`]].forEach(([key, label]) => {
      const b = button(label, () => { tab = key; draw(); }, tab === key ? "" : "ghost");
      tabs.appendChild(b);
    });
    body.appendChild(tabs);
    if (tab === "chats") drawChats(); else drawFiles();
  }

  // The chats of this course. Opening one shows the regular chat screen (index.html), which sends the messages;
  // the course materials are used automatically by every chat started here.
  function drawChats() {
    const { course, chats } = current;
    const ready = course.files.filter((f) => f.status === "ready").length;
    if (!ready) body.appendChild(el("p", "sub", "No material is ready yet. Open the Materials tab and upload a file (PDF, photo or text). You can already start a chat; it will use the materials once they are ready."));
    const start = button("+ New chat", () => newChat(false, { id: course.id, name: course.name }), "primary");
    start.id = "newCourseChat";
    const row = el("div", "row");
    row.style.justifyContent = "flex-start";
    row.appendChild(start);
    body.appendChild(row);
    if (!chats.length) body.appendChild(el("p", "sub", "No chats in this course yet. Start one: Bot answers from this course's materials and shows the file and page."));
    const list = el("ul", "files");
    chats.forEach((c) => {
      const li = el("li", "chat-item");
      const open = el("button", "open", c.title);
      open.type = "button";
      open.dir = "auto";
      open.title = c.title;
      const mark = chatMarker(c.id); // the same pulsing dot as the sidebar while Bot thinks in that chat
      if (mark) open.prepend(mark);
      open.addEventListener("click", () => openChat(c.id));
      const del = el("button", "del", "x");
      del.type = "button";
      del.setAttribute("aria-label", "Delete chat: " + c.title);
      del.addEventListener("click", async () => {
        if (jobState.active.has(c.id)) return fail(new Error("Bot is still working in that chat. Wait for it to finish before deleting it."));
        if (!confirm(`Delete the chat "${c.title}"?`)) return;
        try { await api("/api/conversations/" + c.id, { method: "DELETE" }); await refresh(); } catch (error) { fail(error); }
      });
      li.append(open, del);
      list.appendChild(li);
    });
    body.appendChild(list);
  }

  function drawFiles() {
    const { course } = current;
    const form = el("div", "card");
    form.appendChild(el("strong", "", "Add materials"));
    form.appendChild(el("p", "sub", "PDF (slides, exams, notes, Hebrew is fine, scans too), a photo of notes, or a text file. Up to 50 MB each. PowerPoint or Word: save it as PDF first. Bot reads each file once; a long PDF takes a few minutes, in the background."));
    form.appendChild(button("Choose files", () => picker.click(), "primary"));
    body.appendChild(form);

    const list = el("ul", "files");
    course.files.forEach((f) => {
      const li = el("li");
      const head = el("div", "row");
      const name = el("strong", "", f.name);
      name.dir = "auto";
      const state = f.status === "ready" ? `ready, ${f.pages} pages` : f.status === "failed" ? "could not read" : f.status === "reading" ? "reading... " + f.progress : "waiting";
      head.append(name, el("span", "status", state));
      li.appendChild(head);
      if (f.error) li.appendChild(el("div", "sub err", f.error));
      const actions = el("div", "actions");
      if (f.status === "ready") actions.appendChild(button("View text", () => openFilePages(f.id, 1)));
      if (f.status === "failed" || f.status === "ready") actions.appendChild(button(f.status === "ready" ? "Read again" : "Retry", async () => { try { await post(`/api/courses/${course.id}/files/${f.id}/retry`); await refresh(); } catch (error) { fail(error); } }));
      actions.appendChild(button("Delete", async () => {
        if (!confirm(`Delete "${f.name}" from this course?`)) return;
        try { await api(`/api/courses/${course.id}/files/${f.id}`, { method: "DELETE" }); await refresh(); } catch (error) { fail(error); }
      }));
      li.appendChild(actions);
      const panel = openPages.get(f.id);
      if (panel) li.appendChild(pagesPanel(f, panel));
      list.appendChild(li);
    });
    body.appendChild(list);

    const danger = el("div", "actions");
    danger.appendChild(button("Rename course", async () => {
      const name = prompt("New name for this course:", course.name);
      if (!name) return;
      try { await post(`/api/courses/${course.id}/rename`, { name }); await refresh(); } catch (error) { fail(error); }
    }));
    danger.appendChild(button("Delete course", async () => {
      if (!confirm(`Delete the course "${course.name}" with all its files and chats? This cannot be undone.`)) return;
      try { await api("/api/courses/" + course.id, { method: "DELETE" }); await loadList(); } catch (error) { fail(error); }
    }));
    body.appendChild(danger);
  }

  const note = (text, bad = false) => {
    uploadNote = { text, bad };
    const s = $("uploadStatus"); // a redraw may have replaced the element
    if (s) { s.textContent = text; s.className = bad ? "status bad" : "status"; }
  };
  picker.addEventListener("change", async () => {
    if (!current) return;
    const courseId = current.course.id;
    const refused = [];
    for (const file of [...picker.files]) {
      try { await upload(courseId, file, (text) => note(text)); } catch (error) { refused.push(file.name + ": " + error.message); }
    }
    picker.value = "";
    if (refused.length) note(refused.join("; "), true);
    await refresh().catch(fail);
  });

  // The saved text of a file, so you can check what Bot actually read. Opens at page `from`.
  async function openFilePages(fileId, from) {
    try {
      const data = await api(`/api/courses/${current.course.id}/files/${fileId}/pages?from=${from}`);
      openPages.set(fileId, data);
      tab = "files";
      draw();
    } catch (error) { fail(error); }
  }
  function pagesPanel(file, data) {
    const box = el("div", "pages-panel");
    data.pages.forEach((p) => {
      box.appendChild(el("div", "sub", `Page ${p.page}`));
      box.appendChild(renderText(p.text));
    });
    if (data.more && data.pages.length) box.appendChild(button("Next pages", () => openFilePages(file.id, data.pages[data.pages.length - 1].page + 1)));
    box.appendChild(button("Close", () => { openPages.delete(file.id); draw(); }));
    return box;
  }

  // XMLHttpRequest instead of fetch only because it can report upload progress (big files, phone network).
  function upload(courseId, file, say) {
    return new Promise((resolve, reject) => {
      if (file.size > 50 * 1024 * 1024) return reject(new Error("too big (50 MB at most)"));
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `/api/courses/${courseId}/files?name=${encodeURIComponent(file.name)}`);
      xhr.setRequestHeader("Content-Type", "application/octet-stream");
      xhr.upload.onprogress = (e) => say(`${file.name}: uploading ${e.lengthComputable ? Math.round((100 * e.loaded) / e.total) + "%" : ""}`);
      xhr.onload = () => {
        let data = {};
        try { data = JSON.parse(xhr.responseText); } catch (error) { /* not JSON */ }
        if (xhr.status >= 200 && xhr.status < 300) { say(`${file.name}: uploaded, Bot is reading it`); resolve(data); } else reject(new Error(data.error || "error " + xhr.status));
      };
      xhr.onerror = () => reject(new Error("the upload failed (connection lost?)"));
      xhr.send(file);
    });
  }

  // ---- hooks into the main page ----
  window.studyShow = (courseId, focus) => { (courseId ? openCourse(courseId, focus) : loadList()).catch(fail); };
  // A source chip under an answer: open that page of that file in its course.
  window.studyOpenSource = (courseId, fileId, page) => { navGo({ view: "study", id: currentId, course: courseId }); showView("study", courseId, { fileId, page }); };
  window.studyHide = () => { clearTimeout(timer); };
  $("studyBtn").addEventListener("click", () => { navGo({ view: "study", id: currentId }); showView("study"); });
  $("menu3").addEventListener("click", openSide);
})();
