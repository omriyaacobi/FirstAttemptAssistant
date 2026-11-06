// pdfcut.js
// Cuts a page range out of a PDF, with Node built-ins only. agy spends minutes opening a big file on EVERY call, however few
// pages it is asked for, so Bot gives it a small file that holds only those pages (measured: experiments/2026-11-06-faster-reading.md).
//
// A PDF is a list of numbered objects ("12 0 obj ... endobj") that point at each other ("12 0 R"). A page is one object, and it points
// at its drawing, fonts and images. To cut, we start from the wanted pages, follow the pointers, copy the bytes of every object we reach
// unchanged, and write a new small page list and table of contents around them. Nothing is decompressed, drawn or interpreted.
//
// The PDF is an upload, so it is untrusted: no recursion, loops are stopped by "seen" sets, sizes are capped, and anything unexpected
// (encrypted, object streams, a page list we cannot follow) gives null. The caller then uses the whole file, as before.

const MAX_OBJECTS = 200000;
const INHERITED = ["Resources", "MediaBox", "CropBox", "Rotate"]; // a page may take these from its parent in the page list

const PARENT_G = /\/Parent[ \t\r\n]+\d+[ \t\r\n]+\d+[ \t\r\n]+R\b/g;
const isSpace = (c) => c === 32 || c === 10 || c === 13 || c === 9 || c === 12 || c === 0;

// Walks the file once and notes where each object is. A later object with the same number replaces an earlier one (that is how a PDF
// is edited), and stream contents are jumped over, so bytes inside a stream can never look like an object.
function scanObjects(pdf, text) {
  const objects = new Map();
  const head = /(\d{1,9})[ \t\r\n]+(\d{1,5})[ \t\r\n]+obj\b/g;
  let match;
  while ((match = head.exec(text))) {
    if (match.index > 0 && !isSpace(pdf[match.index - 1]) && pdf[match.index - 1] !== 106 /* j of "endobj" */) continue;
    if (objects.size >= MAX_OBJECTS) return null;
    const start = match.index;
    const bodyStart = match.index + match[0].length;
    const nextEnd = text.indexOf("endobj", bodyStart);
    const streamAt = text.indexOf("stream", bodyStart);
    let dictEnd = nextEnd < 0 ? text.length : nextEnd;
    let end = nextEnd < 0 ? text.length : nextEnd + 6;
    if (streamAt >= 0 && (nextEnd < 0 || streamAt < nextEnd)) {
      dictEnd = streamAt;
      const length = /\/Length[ \t\r\n]+(\d+)(?![ \t\r\n]+\d+[ \t\r\n]+R)/.exec(text.slice(bodyStart, dictEnd));
      let dataStart = streamAt + 6;
      if (pdf[dataStart] === 13) dataStart++;
      if (pdf[dataStart] === 10) dataStart++;
      const stop = text.indexOf("endstream", length ? Math.min(dataStart + Number(length[1]), text.length) : dataStart);
      const close = stop < 0 ? -1 : text.indexOf("endobj", stop);
      if (close < 0) return null;
      end = close + 6;
    }
    objects.set(Number(match[1]), { gen: Number(match[2]), start, end, dict: text.slice(bodyStart, dictEnd) });
    head.lastIndex = end;
  }
  return objects;
}

const refs = (text) => [...text.matchAll(/(\d{1,9})[ \t\r\n]+\d{1,5}[ \t\r\n]+R\b/g)].map((m) => Number(m[1]));
const isType = (dict, type) => new RegExp(`/Type[ \\t\\r\\n]*/${type}(?![A-Za-z])`).test(dict);

// The value of /Key in a dictionary's text: "12 0 R", "[...]", "<<...>>" or a plain token. Only as exact as this file needs.
function dictValue(dict, key) {
  const at = new RegExp(`/${key}(?![A-Za-z])[ \\t\\r\\n]*`).exec(dict);
  if (!at) return null;
  const from = at.index + at[0].length;
  const rest = dict.slice(from);
  const ref = /^\d+[ \t\r\n]+\d+[ \t\r\n]+R\b/.exec(rest);
  if (ref) return ref[0];
  const open = rest.startsWith("<<") ? "<<" : rest.startsWith("[") ? "[" : null;
  if (!open) return (/^[^\s/<>[\]]+/.exec(rest) || [null])[0];
  const close = open === "<<" ? ">>" : "]";
  let depth = 0;
  for (let i = 0; i < rest.length; i++) {
    if (rest.startsWith(open, i)) { depth++; i += open.length - 1; } else if (rest.startsWith(close, i)) { depth--; i += close.length - 1; if (depth === 0) return rest.slice(0, i + 1); }
  }
  return null;
}

// Opens a PDF for cutting. Returns { pageCount, cut(from, to) }, or null if this file cannot be cut safely.
function openPdf(pdf) {
  if (!Buffer.isBuffer(pdf) || pdf.subarray(0, 5).toString("latin1") !== "%PDF-") return null;
  const text = pdf.toString("latin1"); // one character per byte, so positions in text are positions in the file
  if (/\/Encrypt\b/.test(text) || /\/ObjStm\b/.test(text)) return null; // object streams hide objects inside compressed data
  const objects = scanObjects(pdf, text);
  if (!objects || objects.size === 0) return null;
  const rootRefs = [...text.matchAll(/\/Root[ \t\r\n]+(\d{1,9})[ \t\r\n]+\d{1,5}[ \t\r\n]+R\b/g)];
  const catalog = rootRefs.length ? objects.get(Number(rootRefs[rootRefs.length - 1][1])) : null;
  if (!catalog) return null;
  const pagesRef = dictValue(catalog.dict, "Pages");
  if (!pagesRef) return null;

  // The page list is a tree. Walk it with a stack of its own (no recursion) so pages come out in reading order.
  const pages = []; // { id, inherited: { key: value } }
  const seen = new Set();
  const stack = [{ id: refs(pagesRef)[0], inherited: {} }];
  while (stack.length) {
    const node = stack.pop();
    const object = objects.get(node.id);
    if (!object || seen.has(node.id)) continue;
    seen.add(node.id);
    const inherited = { ...node.inherited };
    for (const key of INHERITED) { const value = dictValue(object.dict, key); if (value) inherited[key] = value; }
    if (isType(object.dict, "Pages")) {
      const kids = dictValue(object.dict, "Kids");
      if (!kids) return null;
      const ids = refs(kids);
      for (let i = ids.length - 1; i >= 0; i--) stack.push({ id: ids[i], inherited });
    } else if (isType(object.dict, "Page")) {
      pages.push({ id: node.id, inherited });
    }
  }
  if (pages.length === 0) return null;
  const pageIds = new Set(pages.map((p) => p.id));

  // Everything pages from..to need (1-based, inclusive). Returns the bytes of a new, small PDF.
  function cut(from, to) {
    const wanted = pages.slice(from - 1, to);
    if (wanted.length === 0) return null;
    const keep = new Set(wanted.map((p) => p.id));
    const queue = [...keep];
    const reach = (text) => {
      for (const id of refs(text)) {
        // A link on a page can point at another page; following it would pull in the whole file. A missing object counts as "null" in a PDF.
        if (keep.has(id) || pageIds.has(id) || !objects.has(id)) continue;
        if (isType(objects.get(id).dict, "Catalog") || isType(objects.get(id).dict, "Pages")) continue;
        keep.add(id);
        queue.push(id);
      }
    };
    wanted.forEach((page) => reach(Object.values(page.inherited).join(" ")));
    while (queue.length) reach(objects.get(queue.pop()).dict.replace(PARENT_G, ""));

    let top = 0;
    for (const id of objects.keys()) if (id > top) top = id;
    const treeId = top + 1;
    const rootId = top + 2;
    const parts = [Buffer.from("%PDF-1.7\n%\xE2\xE3\xCF\xD3\n", "latin1")];
    let offset = parts[0].length;
    const table = new Map();
    const add = (id, bytes) => { table.set(id, offset); parts.push(bytes); offset += bytes.length; };
    const pageById = new Map(wanted.map((p) => [p.id, p]));
    for (const id of [...keep].sort((a, b) => a - b)) {
      const object = objects.get(id);
      let bytes = pdf.subarray(object.start, object.end);
      const page = pageById.get(id);
      if (page) { // the only objects that change: they point at the new page list, and carry what they used to inherit
        const body = text.slice(object.start, object.end);
        const missing = INHERITED.filter((k) => page.inherited[k] && dictValue(object.dict, k) === null).map((k) => `/${k} ${page.inherited[k]}`).join(" ");
        const parent = new RegExp(PARENT_G.source);
        const replaced = parent.test(body) ? body.replace(parent, `/Parent ${treeId} 0 R ${missing}`) : body.replace("<<", `<< /Parent ${treeId} 0 R ${missing}`);
        bytes = Buffer.from(replaced, "latin1");
      }
      add(id, Buffer.concat([bytes, Buffer.from("\n")]));
    }
    add(treeId, Buffer.from(`${treeId} 0 obj\n<< /Type /Pages /Count ${wanted.length} /Kids [${wanted.map((p) => `${p.id} ${objects.get(p.id).gen} R`).join(" ")}] >>\nendobj\n`));
    add(rootId, Buffer.from(`${rootId} 0 obj\n<< /Type /Catalog /Pages ${treeId} 0 R >>\nendobj\n`));

    // The table of contents (xref): for each object number, where it starts. Numbers we did not copy are marked free.
    const lines = ["xref", `0 ${rootId + 1}`, "0000000000 65535 f\r"];
    for (let id = 1; id <= rootId; id++) {
      const at = table.get(id);
      const gen = objects.has(id) ? objects.get(id).gen : 0;
      lines.push(at === undefined ? "0000000000 65535 f\r" : `${String(at).padStart(10, "0")} ${String(gen).padStart(5, "0")} n\r`);
    }
    const tail = `${lines.join("\n")}\ntrailer\n<< /Size ${rootId + 1} /Root ${rootId} 0 R >>\nstartxref\n${offset}\n%%EOF\n`;
    return Buffer.concat([...parts, Buffer.from(tail)]);
  }

  return { pageCount: pages.length, cut };
}

module.exports = { openPdf };
