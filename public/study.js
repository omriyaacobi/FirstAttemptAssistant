// public/study.js: the "Courses" screen (study notebooks). Loaded by index.html after its main script,
// so it can use that script's helpers ($, el, renderText, openSide, navGo, showView).
// Like the main page, it only ever uses textContent (never innerHTML): file names and model answers are untrusted.
//
// A course screen shows its SOURCES (the materials: drop files, see each one's status, tick the ones Bot may use).
// (Until 2026-11-13 it also listed the course's own chats; Bot is one conversation now, so that list was removed.)
(function () {
  const view = $("studyView");
  const body = $("studyBody");
  let courses = [];
  let current = null; // { course } of the open course, or null for the course list
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

  // ---- polling: only while a file is being read, and only while this screen is visible ----
  function busyNow() {
    return current && current.course.files.some((f) => f.status === "queued" || f.status === "reading");
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
  const snapshot = () => JSON.stringify(current);
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
  const goCourse = (id) => { navGo({ view: "study", id: null, course: id }); return openCourse(id).catch(fail); };

  function draw() {
    drawn = snapshot();
    body.replaceChildren();
    $("studyTitle").textContent = current ? current.course.name : "Courses";
    $("studyStatus").textContent = "";
    if (!current) return drawList();
    drawCourse();
  }

  function drawList() {
    body.appendChild(el("p", "sub", "One tab for each course. Upload its slides, exams and notes once, then ask in the conversation: Bot uses the course materials, searches only that course and reads only the few pages that matter."));
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
    head.append(button("< All courses", () => { navGo({ view: "study", id: null, course: null }); loadList().catch(fail); }), button("+ Add material", () => picker.click(), "primary add-material"));
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
    cols.append(sources);
    body.appendChild(cols);

    const danger = el("div", "actions");
    danger.appendChild(button("Rename course", async () => {
      const name = prompt("New name for this course:", course.name);
      if (!name) return;
      try { await post(`/api/courses/${course.id}/rename`, { name }); await refresh(); } catch (error) { fail(error); }
    }));
    danger.appendChild(button("Delete course", async () => {
      if (!confirm(`Delete the course "${course.name}" with all its files? This cannot be undone.`)) return;
      try { await api("/api/courses/" + course.id, { method: "DELETE" }); await loadList(); } catch (error) { fail(error); }
    }));
    body.appendChild(danger);
  }

  // ---- sources: drop zone, upload rows, the list of files with their tick boxes ----
  // "Add from link": the address is sent to the PC, which downloads it itself (linkfetch.js: https only, public sites, size limits, no login) and files
  // it in this course through the same checks as an upload. A GitHub repo, a GitHub file, or a direct link to a PDF / slides / Word / text / zip.
  function linkBox(courseId) {
    const wrap = el("div", "linkbox");
    const input = el("input");
    input.type = "url";
    input.placeholder = "Add from link: a GitHub repo or a direct file link (https://...)";
    input.setAttribute("aria-label", "Link to download into this course");
    input.maxLength = 2000;
    input.style.cssText = "width:100%;box-sizing:border-box;margin:8px 0 4px";
    const go = async () => {
      const url = input.value.trim();
      if (!url || go.busy) return;
      go.busy = true;
      const row = { name: url.slice(0, 80), text: "downloading...", bad: false };
      uploads.push(row);
      paintUploads();
      try {
        const data = await post("/api/courses/" + courseId + "/link", { url });
        row.text = data.link.summary; row.keep = true; row.bad = data.link.filedCount === 0;
        input.value = "";
      } catch (error) { row.text = "not added: " + error.message; row.bad = true; row.keep = true; }
      go.busy = false;
      paintUploads();
      if (!view.hidden && current) await refresh().catch(fail);
    };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } });
    wrap.append(input, button("Add from link", go, "ghost"), el("p", "sub", "Bot downloads it itself. Public links only: it never logs in anywhere."));
    return wrap;
  }
  function dropZone(course) {
    const zone = el("div", "dropzone");
    zone.id = "dropZone";
    zone.appendChild(button("Choose files", () => picker.click(), "primary"));
    zone.appendChild(el("p", "sub", "or drop files here (several at once). PDF, PowerPoint (.pptx), Word (.docx), photos and text files, up to 50 MB each. A .zip (up to 200 MB) works too: Bot unpacks it and checks the files one by one. Hebrew and scans are fine. A long PDF takes a few minutes to read, in the background."));
    zone.appendChild(linkBox(course.id));
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
      const line = el("div", u.bad ? "sub err" : "sub", u.text);
      if (u.keep) line.style.whiteSpace = "pre-line"; // the summary of a zip has one line per skipped file
      text.append(name, line);
      li.appendChild(text);
      if (u.bad || u.keep) li.appendChild(button("Dismiss", () => { uploads = uploads.filter((x) => x !== u); paintUploads(); }));
      list.appendChild(li);
    });
  }
  function paintUploads() {
    const list = $("uploadList");
    if (list) fillUploads(list);
  }

  // How far a long read has got, and that its pages can be used already. The time left comes from the real speed of this read.
  function readingBar(f) {
    const box = el("div", "read-bar");
    const fill = box.appendChild(el("div", "read-fill"));
    fill.style.width = Math.round((100 * f.pages) / f.pagesTotal) + "%";
    box.setAttribute("role", "progressbar");
    box.setAttribute("aria-valuenow", String(f.pages));
    box.setAttribute("aria-valuemax", String(f.pagesTotal));
    const wrap = el("div");
    wrap.appendChild(box);
    const done = f.pages - (f.readFromPages || 0);
    const minutes = done > 0 && f.readStarted ? Math.ceil((((Date.now() - f.readStarted) / done) * (f.pagesTotal - f.pages)) / 60000) : 0;
    if (f.pages > 0) wrap.appendChild(el("div", "sub", "Chats can use these pages already." + (minutes ? ` About ${minutes} min left.` : "")));
    return wrap;
  }

  // The files of a course. Each has a tick: unticked files are left out of Bot's answers about this course (the file stays).
  // pages: true adds the "View text" panel.
  function sourcesList(course, { pages = false, after = refresh } = {}) {
    const list = el("ul", "files");
    if (!course.files.length) list.appendChild(el("li", "sub", "No materials yet."));
    course.files.forEach((f) => {
      const li = el("li", "src" + (f.use === false ? " off" : ""));
      const tick = el("input");
      tick.type = "checkbox";
      tick.checked = f.use !== false;
      tick.setAttribute("aria-label", "Use in answers: " + f.name);
      tick.title = "Tick: Bot uses this file when it answers about this course";
      tick.addEventListener("change", async () => {
        try { await post(`/api/courses/${course.id}/files/${f.id}/use`, { use: tick.checked }); f.use = tick.checked; await after(); } catch (error) { tick.checked = !tick.checked; fail(error); }
      });
      const text = el("div", "body");
      const name = el("strong", "name", f.name);
      name.dir = "auto";
      const state = f.status === "ready" ? `ready, ${f.pages} page${f.pages === 1 ? "" : "s"}` : f.status === "failed" ? "could not read" : f.status === "reading" ? "reading... " + f.progress : "waiting";
      text.append(name, el("div", f.status === "failed" ? "sub err" : "sub", state));
      if (f.status === "reading" && f.pagesTotal) text.appendChild(readingBar(f));
      if (f.error) text.appendChild(el("div", "sub err", f.error));
      const actions = el("div", "actions");
      if (pages && f.pages > 0) actions.appendChild(button("View text", () => openFilePages(f.id, 1)));
      const reread = (resume) => async () => { try { await post(`/api/courses/${course.id}/files/${f.id}/retry`, { resume }); await after(); } catch (error) { fail(error); } };
      const done = f.status === "failed" || f.status === "ready";
      if (done && f.resumeFrom > 1) actions.appendChild(button("Continue", reread(true))); // a long read that stopped half way keeps its pages
      if (done) actions.appendChild(button(f.status === "ready" ? "Read again" : f.resumeFrom > 1 ? "Start over" : "Retry", reread(false)));
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
  // Where new files go: the open course screen.
  const targetCourse = () => (!view.hidden && current ? current.course.id : null);
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
        const data = await upload(courseId, file, (text) => { row.text = text; paintUploads(); });
        if (data && data.zip) { // a zip: its row stays with what was added and what was skipped, until dismissed
          row.text = data.zip.summary;
          row.keep = true;
          row.bad = data.zip.filedCount === 0;
          paintUploads();
          if (data.zip.filedCount) sent += data.zip.filedCount; else continue;
        } else {
          uploads = uploads.filter((x) => x !== row); // it now shows in the list below, with its reading status
          sent++;
        }
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
  }
  picker.addEventListener("change", () => addFiles(picker.files));

  // Drag and drop: anywhere on the course screen (PC). The dashed box lights up while files are over the page.
  const hasFiles = (e) => !!e.dataTransfer && [...(e.dataTransfer.types || [])].includes("Files");
  let dragDepth = 0;
  const zoneOn = (on) => { const z = $("dropZone"); if (z) z.classList.toggle("over", on); };
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
      const head = el("div", "sub", `Page ${p.page} `);
      if (file.kind === "pdf" || file.kind === "image") {
        const link = el("a", "", "open the original");
        link.href = `/api/courses/${current.course.id}/files/${file.id}/original?page=${p.page}`;
        link.target = "_blank";
        link.rel = "noopener";
        head.appendChild(link);
      }
      box.appendChild(head);
      box.appendChild(renderText(p.text));
    });
    if (data.more && data.pages.length) box.appendChild(button("Next pages", () => openFilePages(file.id, data.pages[data.pages.length - 1].page + 1)));
    box.appendChild(button("Close", () => { openPages.delete(file.id); draw(); }));
    return box;
  }

  // XMLHttpRequest instead of fetch only because it can report upload progress (big files, phone network).
  function upload(courseId, file, say) {
    return new Promise((resolve, reject) => {
      const isZip = /\.zip$/i.test(file.name); // a zip may be bigger: its files are unpacked and checked one by one on the server
      if (file.size > (isZip ? 200 : 50) * 1024 * 1024) return reject(new Error(`too big (${isZip ? 200 : 50} MB at most)`));
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

  // ---- a source under an answer: the page in a popup over the chat, so you never lose your place ----
  async function showSource(courseId, fileId, fileName, page) {
    const dialog = $("sourceDialog");
    const box = $("sourceBody");
    $("sourceTitle").textContent = `${fileName}, page ${page}`;
    box.replaceChildren(el("p", "sub", "Loading..."));
    const actions = $("sourceActions");
    actions.replaceChildren();
    if (!dialog.open) dialog.showModal();
    try {
      const data = await api(`/api/courses/${courseId}/files/${fileId}/pages?from=${Math.max(1, page - 1)}`);
      const at = data.pages.findIndex((p) => p.page === page);
      if (at < 0) return box.replaceChildren(el("p", "sub", "Bot has no saved text for this page."));
      box.replaceChildren(renderText(data.pages[at].text));
      const go = (p) => () => showSource(courseId, fileId, fileName, p.page);
      if (at > 0) actions.appendChild(button("Previous page", go(data.pages[at - 1])));
      if (data.pages[at + 1]) actions.appendChild(button("Next page", go(data.pages[at + 1])));
      const link = el("a", "button-link", "Open the original page");
      link.href = `/api/courses/${courseId}/files/${fileId}/original?page=${page}`;
      link.target = "_blank";
      link.rel = "noopener";
      actions.appendChild(link);
    } catch (error) {
      box.replaceChildren(el("p", "sub err", error.message));
    }
  }
  $("sourceClose").addEventListener("click", () => $("sourceDialog").close());
  $("sourceDialog").addEventListener("click", (e) => { if (e.target === $("sourceDialog")) $("sourceDialog").close(); });

  // ---- hooks into the main page ----
  window.studyShow = (courseId, focus) => { (courseId ? openCourse(courseId, focus) : loadList()).catch(fail); };
  // A source chip under an answer: that page of that file, in a popup over the chat.
  window.studyOpenSource = showSource;
  window.studyHide = () => { clearTimeout(timer); };
  $("studyBtn").addEventListener("click", () => { navGo({ view: "study", id: null }); showView("study"); });
  $("menu3").addEventListener("click", openSide);
})();
