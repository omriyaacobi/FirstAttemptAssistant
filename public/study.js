// public/study.js: the "Courses" screen (study notebooks). Loaded by index.html after its main script,
// so it can use that script's helpers ($, el, renderText, openSide, navGo, showView).
// Like the main page, it only ever uses textContent (never innerHTML): file names and model answers are untrusted.
(function () {
  const view = $("studyView");
  const body = $("studyBody");
  let courses = [];
  let current = null; // { course, chat, asking } of the open course, or null for the course list
  let tab = "chat";
  let timer = null;
  let deeper = false;
  let draft = ""; // what is typed in the question box, kept across redraws
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

  // ---- polling: only while something is happening, and only while this screen is visible ----
  function busyNow() {
    return current && (current.asking || current.course.files.some((f) => f.status === "queued" || f.status === "reading"));
  }
  function schedule() {
    clearTimeout(timer);
    if (view.hidden || !busyNow()) return;
    timer = setTimeout(() => refresh().catch(() => schedule()), 3000);
  }
  async function refresh() {
    if (!current) return;
    const id = current.course.id;
    const data = await api("/api/courses/" + id);
    if (!current || current.course.id !== id) return;
    current = data;
    draw();
    schedule();
  }

  // ---- screens ----
  async function loadList() {
    current = null;
    ({ courses } = await api("/api/courses"));
    draw();
  }

  async function openCourse(id) {
    current = await api("/api/courses/" + id);
    tab = "chat";
    uploadNote = null;
    openPages.clear();
    draw();
    schedule();
  }

  function draw() {
    const keep = $("studyQ");
    if (keep) draft = keep.value;
    body.replaceChildren();
    $("studyTitle").textContent = current ? current.course.name : "Courses";
    $("studyStatus").textContent = "";
    if (!current) return drawList();
    drawCourse();
  }

  function drawList() {
    body.appendChild(el("p", "sub", "One tab for each course. Upload its slides, exams and notes once, then ask Bot about it: Bot searches only that course and reads only the few pages that matter."));
    const grid = el("div", "course-grid");
    courses.forEach((c) => {
      const card = el("button", "card course-card");
      card.type = "button";
      const name = card.appendChild(el("strong", "", c.name));
      name.dir = "auto";
      card.title = c.name; // the card cuts a long name; the full one shows on hover
      card.appendChild(el("div", "sub", `${c.files} file${c.files === 1 ? "" : "s"}, ${c.pages} pages read` + (c.reading ? `, ${c.reading} being read` : "")));
      card.addEventListener("click", () => openCourse(c.id).catch(fail));
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
    head.append(button("< All courses", () => loadList().catch(fail)), button("+ Add material", () => picker.click(), "primary add-material"));
    body.appendChild(head);
    // The upload messages stay here across redraws, in both tabs, so a refused file is never wiped off the screen.
    const status = el("div", uploadNote && uploadNote.bad ? "status bad" : "status", uploadNote ? uploadNote.text : "");
    status.id = "uploadStatus";
    body.appendChild(status);
    const tabs = el("div", "row");
    tabs.style.justifyContent = "flex-start";
    [["chat", "Chat"], ["files", `Materials (${course.files.length})`]].forEach(([key, label]) => {
      const b = button(label, () => { tab = key; draw(); }, tab === key ? "" : "ghost");
      tabs.appendChild(b);
    });
    body.appendChild(tabs);
    if (tab === "chat") drawChat(); else drawFiles();
  }

  function drawChat() {
    const { course, chat, asking } = current;
    const ready = course.files.filter((f) => f.status === "ready").length;
    if (!ready) body.appendChild(el("p", "sub", "No material is ready yet. Open the Materials tab and upload a file (PDF, photo or text)."));
    const thread = el("div", "study-thread");
    thread.style.cssText = "display:flex;flex-direction:column;gap:8px;margin:12px 0";
    chat.forEach((m) => {
      const box = el("div", m.role === "user" ? "me" : "bot");
      box.appendChild(renderText(m.text));
      if (m.sources && m.sources.length) {
        const src = el("div", "sources");
        src.appendChild(el("span", "sub", "From: "));
        m.sources.forEach((s) => src.appendChild(button(`${s.file}, p.${s.page}`, () => { tab = "files"; openFilePages(s.fileId, s.page); }, "ghost chip")));
        box.appendChild(src);
      }
      if (m.role !== "user" && m.model) box.appendChild(el("div", "sub", `${m.model}, ${m.seconds} s, searched ${m.searched} pages of this course only`));
      thread.appendChild(box);
    });
    if (asking) thread.appendChild(el("div", "bot", "Bot is thinking... you can leave this screen, the answer will be saved here."));
    body.appendChild(thread);

    const form = el("form");
    const q = el("textarea");
    q.id = "studyQ";
    q.dir = "auto";
    q.value = draft;
    q.setAttribute("aria-label", "Your question about this course");
    q.placeholder = "Ask about this course, or say: give me an exercise on ... (Enter sends)";
    q.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
    const row = el("div", "row");
    const label = el("label");
    const cb = el("input");
    cb.type = "checkbox";
    cb.checked = deeper;
    cb.addEventListener("change", () => { deeper = cb.checked; });
    label.append(cb, document.createTextNode(" Think harder (slower, stronger model)"));
    row.append(label, el("span", "status"), button("Clear chat", async () => { try { await post(`/api/courses/${course.id}/chat/clear`); await refresh(); } catch (error) { fail(error); } }));
    const send = el("button", "", "Send");
    send.disabled = !!asking;
    row.appendChild(send);
    form.append(q, row);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = q.value.trim();
      if (!text) return;
      try {
        await post(`/api/courses/${course.id}/ask`, { text, deeper });
        draft = "";
        await refresh();
      } catch (error) { fail(error); }
    });
    body.appendChild(form);
    thread.scrollTop = thread.scrollHeight;
  }

  function drawFiles() {
    const { course } = current;
    const form = el("div", "card");
    form.appendChild(el("strong", "", "Add materials"));
    form.appendChild(el("p", "sub", "PDF (slides, exams, notes, Hebrew is fine, scans too), a photo of notes, or a text file. Up to 40 MB each. PowerPoint or Word: save it as PDF first. Bot reads each file once; a long PDF takes a few minutes, in the background."));
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
      if (!confirm(`Delete the course "${course.name}" with all its files and chat? This cannot be undone.`)) return;
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
      if (file.size > 40 * 1024 * 1024) return reject(new Error("too big (40 MB at most)"));
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
  window.studyShow = () => { loadList().catch(fail); };
  window.studyHide = () => { clearTimeout(timer); };
  $("studyBtn").addEventListener("click", () => { navGo({ view: "study", id: currentId }); showView("study"); });
  $("menu3").addEventListener("click", openSide);
})();
