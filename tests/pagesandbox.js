"use strict";
// Test helper (not a test): runs the answer-drawing part of public/index.html (math, Markdown) against a tiny fake DOM,
// so tests/markdown.test.js and tests/math.test.js can look at the elements it builds without a browser.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
const script = html.slice(html.indexOf("<script>") + 8, html.indexOf("</script>"));
const from = script.indexOf("// ---- TeX math"), to = script.indexOf("function botCard");

class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.className = ""; this.dir = ""; this._text = ""; this.attrs = {}; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  appendChild(n) { this.children.push(n); return n; }
  replaceChildren() { this.children = []; this._text = ""; }
  set textContent(t) { this._text = String(t); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(""); }
}
const sandbox = {
  document: {
    createElement: (tag) => new Node(tag),
    createElementNS: (ns, tag) => { const n = new Node(tag); n.ns = ns; return n; },
    createTextNode: (t) => { const n = new Node("#text"); n._text = t; return n; },
  },
};
sandbox.el = (tag, cls, text) => { const n = new Node(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
vm.runInNewContext(script.slice(from, to) + "this.renderText = renderText; this.fillMarkdown = fillMarkdown; this.texToMath = texToMath; this.TEX_MO = TEX_MO; this.TEX_MI = TEX_MI;", sandbox);

const tags = (box) => box.children.map((c) => c.tag);
const find = (n, tag, out = []) => { if (n.tag === tag) out.push(n); n.children.forEach((c) => find(c, tag, out)); return out; };
const allNodes = (n) => [n, ...n.children.flatMap(allNodes)];

module.exports = { html, script, sandbox, tags, find, allNodes };
