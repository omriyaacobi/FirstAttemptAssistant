// public/study.js: the "Courses" screen (study notebooks). Loaded by index.html after its main script,
// so it can use that script's helpers ($, el, renderText, openSide, navGo, showView).
// Like the main page, it only ever uses textContent (never innerHTML): file names and model answers are untrusted.
//
// A course screen has two columns (stacked on a phone): SOURCES (the materials: drop files, see each one's status, tick the
// ones the chats may use) and CHATS (start a new one, switch between them). Inside a course chat, the bar above the chat
// has the same lists in a small panel (Chats, Sources, + New chat), so you never have to leave the chat to switch or upload.
(function () {
  const view = $("studyView");
  const body = $("studyBody");
  let courses = [];
  let current = null; // { course, chats } of the open course, or null for the course list
  let timer = null;
  let uploadNote = null; // { text, bad }: kept across redraws too, so a refused file is never wiped off the screen
  let uploads = []; // files being sent or refused right now: { name, text, bad }. Only on this page; the server list has the rest.
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

  // "5 min ago", "yesterday", or the date: so two chats with similar titles can be told apart.
  function ago(ms) {
    if (!ms) return "";
    const s = Math.max(0, (Date.now() - ms) / 1000);
    if (s < 90) return "just now";
    if (s < 3600) return Math.round(s / 60) + " min ago";
    if (s < 86400) return Math.round(s / 3600) + " h ago";
    if (s < 172800) return "yesterday";
    return new Date(ms).toLocaleDateString();
  }

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
  // A tick box is not typing: it must not stop the screen from showing its own result.
  const typingHere = () => { const a = document.activeElement; return !!a && body.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== "checkbox"; };
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

  // focus (optional): { fileId, page }, opens that page of a file in the Sources list (used by the source chips in a chat).
  async function openCourse(id, focus) {
    current = await api("/api/courses/" + id);
    courseNames.set(id, current.course.name);
    uploadNote = null;
    uploads = [];
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
    // The upload messages stay here across redraws, so a refused file is never wiped off the screen.
    const status = el("div", uploadNote && uploadNote.bad ? "status bad" : "status", uploadNote ? uploadNote.text : "");
    status.id = "uploadStatus";
    body.appendChild(status);

    const cols = el("div", "course-cols");
    const sources = el("section");
    sources.appendChild(el("h2", "", `Sources (${course.files.length})`));
    sources.appendChild(dropZone(course));
    sources.appendChild(uploadList());
    sources.appendChild(sourcesList(course, { pages: true }));
    const chats = el("section");
    chats.appendChild(el("h2", "", `Chats (${current.chats.length})`));
    drawChats(chats);
    cols.append(sources, chats);
    body.appendChild(cols);

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

  // The chats of this course. Opening one shows the regular chat screen (index.html), which sends the messages;
  // the ticked materials are used automatically by every chat started here.
  // data: { course, chats } (the course screen's own, or the chat bar panel's). withNew: the + New chat button (the bar has its own).
  function drawChats(into, { data = current, withNew = true, activeId = null, onPick = () => {}, after = refresh } = {}) {
    const { course, chats } = data;
    if (withNew) {
      if (!course.files.some((f) => f.status === "ready")) into.appendChild(el("p", "sub", "No material is ready yet. Add a file (PDF, PowerPoint, Word, photo or text) on the left. You can already start a chat; it will use the materials once they are ready."));
      const start = button("+ New chat", () => { onPick(); newChat(false, { id: course.id, name: course.name }); }, "primary");
      start.id = "newCourseChat";
      const row = el("div", "row");
      row.style.justifyContent = "flex-start";
      row.appendChild(start);
      into.appendChild(row);
    }
    if (!chats.length) into.appendChild(el("p", "sub", "No chats in this course yet. Start one: Bot answers from this course's materials and shows the file and page."));
    const list = el("ul", "files");
    chats.forEach((c) => {
      const li = el("li", "chat-item" + (c.id === activeId ? " active" : ""));
      const open = el("button", "open", c.title);
      open.type = "button";
      open.dir = "auto";
      open.title = c.title;
      const mark = chatMarker(c.id); // the same pulsing dot as the sidebar while Bot thinks in that chat
      if (mark) open.prepend(mark);
      open.addEventListener("click", () => { onPick(); openChat(c.id); });
      const del = el("button", "del", "x");
      del.type = "button";
      del.setAttribute("aria-label", "Delete chat: " + c.title);
      del.addEventListener("click", async () => {
        if (jobState.active.has(c.id)) return fail(new Error("Bot is still working in that chat. Wait for it to finish before deleting it."));
        if (!confirm(`Delete the chat "${c.title}"?`)) return;
        try {
          await api("/api/conversations/" + c.id, { method: "DELETE" });
          if (c.id === activeId) { onPick(); newChat(false, { id: course.id, name: course.name }); } else await after();
        } catch (error) { fail(error); }
      });
      li.append(open, el("span", "when", ago(c.updated)), del);
      list.appendChild(li);
    });
    into.appendChild(list);
  }

  // ---- sources: drop zone, upload rows, the list of files with their tick boxes ----
  function dropZone(course) {
    const zone = el("div", "dropzone");
    zone.id = "dropZone";
    zone.appendChild(button("Choose files", () => picker.click(), "primary"));
    zone.appendChild(el("p", "sub", "or drop files here (several at once). PDF, PowerPoint (.pptx), Word (.docx), photos and text files, up to 50 MB each. Hebrew and scans are fine. A long PDF takes a few minutes to read, in the background."));
    return zone;
  }

  // One row per file that is being sent or was refused. A finished one disappears: the server's list shows it from then on.
  function uploadList() {
    const list = el("ul", "files");
    list.id = "uploadList";
    fillUploads(list);
    return list;
  }
  function fillUploads(list) {
    list.replaceChildren();
    uploads.forEach((u) => {
      const li = el("li", "src");
      const text = el("div", "body");
      const name = el("strong", "name", u.name);
      name.dir = "auto";
      text.append(name, el("div", u.bad ? "sub err" : "sub", u.text));
      li.appendChild(text);
      if (u.bad) li.appendChild(button("Dismiss", () => { uploads = uploads.filter((x) => x !== u); paintUploads(); }));
      list.appendChild(li);
    });
  }
  function paintUploads() {
    const list = $("uploadList");
    if (list) fillUploads(list);
  }

  // The files of a course. Each has a tick: unticked files are left out of the chats of this course (the file stays).
  // pages: true adds the "View text" panel (course screen only, the chat's small panel stays short).
  function sourcesList(course, { pages = false, after = refresh } = {}) {
    const list = el("ul", "files");
    if (!course.files.length) list.appendChild(el("li", "sub", "No materials yet."));
    course.files.forEach((f) => {
      const li = el("li", "src" + (f.use === false ? " off" : ""));
      const tick = el("input");
      tick.type = "checkbox";
      tick.checked = f.use !== false;
      tick.setAttribute("aria-label", "Use in chats: " + f.name);
      tick.title = "Tick: the chats of this course use this file";
      tick.addEventListener("change", async () => {
        try { await post(`/api/courses/${course.id}/files/${f.id}/use`, { use: tick.checked }); f.use = tick.checked; await after(); } catch (error) { tick.checked = !tick.checked; fail(error); }
      });
      const text = el("div", "body");
      const name = el("strong", "name", f.name);
      name.dir = "auto";
      const state = f.status === "ready" ? `ready, ${f.pages} page${f.pages === 1 ? "" : "s"}` : f.status === "failed" ? "could not read" : f.status === "reading" ? "reading... " + f.progress : "waiting";
      text.append(name, el("div", f.status === "failed" ? "sub err" : "sub", state));
      if (f.error) text.appendChild(el("div", "sub err", f.error));
      const actions = el("div", "actions");
      if (pages && f.status === "ready") actions.appendChild(button("View text", () => openFilePages(f.id, 1)));
      if (f.status === "failed" || f.status === "ready") actions.appendChild(button(f.status === "ready" ? "Read again" : "Retry", async () => { try { await post(`/api/courses/${course.id}/files/${f.id}/retry`); await after(); } catch (error) { fail(error); } }));
      actions.appendChild(button("Delete", async () => {
        if (!confirm(`Delete "${f.name}" from this course?`)) return;
        try { await api(`/api/courses/${course.id}/files/${f.id}`, { method: "DELETE" }); await after(); } catch (error) { fail(error); }
      }));
      text.appendChild(actions);
      const panel = pages ? openPages.get(f.id) : null;
      if (panel) text.appendChild(pagesPanel(f, panel));
      li.append(tick, text);
      list.appendChild(li);
    });
    return list;
  }

  const note = (text, bad = false) => {
    uploadNote = { text, bad };
    const s = $("uploadStatus"); // a redraw may have replaced the element
    if (s) { s.textContent = text; s.className = bad ? "status bad" : "status"; }
  };

  // Several files, one after the other (each is a big request). Each gets its own row with its own status.
  let sending = false;
  // Where new files go: the open course screen, or the course of the open chat while its Sources panel is showing.
  const targetCourse = () => (!view.hidden && current ? current.course.id : panel && panel.mode === "sources" ? barCourse : null);
  async function addFiles(fileList) {
    const courseId = targetCourse();
    if (!courseId || sending) return;
    const files = [...fileList];
    if (!files.length) return;
    sending = true;
    let sent = 0;
    for (const [i, file] of files.entries()) {
      const row = { name: file.name, text: "waiting", bad: false };
      uploads.push(row);
      paintUploads();
      note(`Sending file ${i + 1} of ${files.length}...`);
      try {
        await upload(courseId, file, (text) => { row.text = text; paintUploads(); });
        uploads = uploads.filter((x) => x !== row); // it now shows in the list below, with its reading status
        sent++;
      } catch (error) {
        row.text = "not added: " + error.message;
        row.bad = true;
        paintUploads();
      }
    }
    sending = false;
    picker.value = "";
    const refused = uploads.filter((u) => u.bad).length;
    note(sent ? `${sent} file${sent === 1 ? "" : "s"} added, Bot is reading ${sent === 1 ? "it" : "them"}.` + (refused ? ` ${refused} not added (see the list).` : "") : refused ? "No file was added (see the list)." : "", refused > 0 && !sent);
    if (!view.hidden && current) await refresh().catch(fail);
    if (panel) await loadPanel().catch(() => {});
  }
  picker.addEventListener("change", () => addFiles(picker.files));

  // Drag and drop: anywhere on the course screen (PC). The dashed box lights up while files are over the page.
  const hasFiles = (e) => !!e.dataTransfer && [...(e.dataTransfer.types || [])].includes("Files");
  let dragDepth = 0;
  const zoneOn = (on) => { for (const z of [$("dropZone"), $("panelDropZone")]) if (z) z.classList.toggle("over", on); };
  document.addEventListener("dragenter", (e) => { if (targetCourse() && hasFiles(e)) { e.preventDefault(); dragDepth++; zoneOn(true); } });
  document.addEventListener("dragover", (e) => { if (targetCourse() && hasFiles(e)) e.preventDefault(); });
  document.addEventListener("dragleave", (e) => { if (targetCourse() && hasFiles(e) && --dragDepth <= 0) { dragDepth = 0; zoneOn(false); } });
  document.addEventListener("drop", (e) => {
    if (!targetCourse() || !hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    zoneOn(false);
    addFiles(e.dataTransfer.files);
  });

  // The saved text of a file, so you can check what Bot actually read. Opens at page `from`.
  async function openFilePages(fileId, from) {
    try {
      const data = await api(`/api/courses/${current.course.id}/files/${fileId}/pages?from=${from}`);
      openPages.set(fileId, data);
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
      xhr.upload.onprogress = (e) => say(`uploading ${e.lengthComputable ? Math.round((100 * e.loaded) / e.total) + "%" : ""}`);
      xhr.onload = () => {
        let data = {};
        try { data = JSON.parse(xhr.responseText); } catch (error) { /* not JSON */ }
        if (xhr.status >= 200 && xhr.status < 300) { say("uploaded, Bot is reading it"); resolve(data); } else reject(new Error(data.error || "error " + xhr.status));
      };
      xhr.onerror = () => reject(new Error("the upload failed (connection lost?)"));
      xhr.send(file);
    });
  }

  // ---- the bar inside a course chat: Chats, Sources, + New chat ----
  // The panel below the bar shows one of the two lists. It keeps its own copy of the course (fetched when opened and
  // after every change, and every few seconds while open, so a file being read shows its progress).
  let panel = null; // { mode: "chats" | "sources", course, chats } or null when closed
  let panelTimer = null;
  let barCourse = null;
  let barChat = null;
  const holder = () => $("coursePanel");

  function closePanel() {
    clearTimeout(panelTimer);
    panel = null;
    holder().hidden = true;
    holder().replaceChildren();
    for (const id of ["courseChats", "courseSources"]) $(id).setAttribute("aria-expanded", "false");
  }
  async function loadPanel() {
    if (!panel || !barCourse) return;
    const data = await api("/api/courses/" + barCourse);
    if (!panel) return;
    panel.course = data.course;
    panel.chats = data.chats;
    paintPanel();
    clearTimeout(panelTimer);
    if (data.course.files.some((f) => f.status === "queued" || f.status === "reading")) panelTimer = setTimeout(() => loadPanel().catch(() => {}), 3000);
  }
  function paintPanel() {
    const box = holder();
    box.hidden = false;
    box.replaceChildren();
    $("courseChats").setAttribute("aria-expanded", String(panel.mode === "chats"));
    $("courseSources").setAttribute("aria-expanded", String(panel.mode === "sources"));
    if (panel.mode === "chats") {
      drawChats(box, { data: panel, withNew: false, activeId: barChat, onPick: closePanel, after: loadPanel });
    } else {
      box.appendChild(el("h2", "", `Sources (${panel.course.files.length})`));
      const zone = el("div", "dropzone");
      zone.id = "panelDropZone";
      zone.append(button("+ Add material", () => picker.click(), "primary add-material"), el("span", "sub", " or drop files on this page"));
      box.appendChild(zone);
      box.appendChild(sourcesList(panel.course, { after: loadPanel }));
    }
  }
  function openPanel(mode) {
    if (panel && panel.mode === mode) return closePanel();
    panel = { mode, course: { id: barCourse, files: [] }, chats: [] };
    loadPanel().catch(fail);
  }
  $("courseChats").addEventListener("click", () => barCourse && openPanel("chats"));
  $("courseSources").addEventListener("click", () => barCourse && openPanel("sources"));
  $("courseNew").addEventListener("click", () => { if (barCourse) { closePanel(); newChat(false, { id: barCourse, name: courseNames.get(barCourse) || "Course" }); } });
  // index.html calls this whenever the open chat or its course changes.
  window.studyBarChanged = (courseId, chatId) => {
    if (courseId !== barCourse) closePanel();
    barCourse = courseId || null;
    barChat = chatId || null;
    if (panel && panel.mode === "chats") paintPanel();
  };

  // ---- hooks into the main page ----
  window.studyShow = (courseId, focus) => { (courseId ? openCourse(courseId, focus) : loadList()).catch(fail); };
  // A source chip under an answer: open that page of that file in its course.
  window.studyOpenSource = (courseId, fileId, page) => { navGo({ view: "study", id: currentId, course: courseId }); showView("study", courseId, { fileId, page }); };
  window.studyHide = () => { clearTimeout(timer); };
  $("studyBtn").addEventListener("click", () => { navGo({ view: "study", id: currentId }); showView("study"); });
  $("menu3").addEventListener("click", openSide);
})();
