"use strict";
// Checks how answers are drawn on the web page (the Markdown part of public/index.html) without a browser:
// the page's own functions run against a tiny fake DOM, so we can look at the elements they build.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const html = fs.readFileSync(path.join(__dirname, "public", "index.html"), "utf8");
const script = html.slice(html.indexOf("<script>") + 8, html.indexOf("</script>"));
const from = script.indexOf("const INLINE"), to = script.indexOf("function botCard");

class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.className = ""; this.dir = ""; this._text = ""; }
  appendChild(n) { this.children.push(n); return n; }
  replaceChildren() { this.children = []; this._text = ""; }
  set textContent(t) { this._text = String(t); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(""); }
}
const sandbox = {
  document: { createElement: (tag) => new Node(tag), createTextNode: (t) => { const n = new Node("#text"); n._text = t; return n; } },
};
sandbox.el = (tag, cls, text) => { const n = new Node(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
vm.runInNewContext(script.slice(from, to) + "this.renderText = renderText; this.fillMarkdown = fillMarkdown;", sandbox);

const tags = (box) => box.children.map((c) => c.tag);
const find = (n, tag, out = []) => { if (n.tag === tag) out.push(n); n.children.forEach((c) => find(c, tag, out)); return out; };

test("headings, bold, italics and rules show no ### or ** characters", () => {
  const box = sandbox.renderText("### Title\nSome **bold** and *slanted* words\n***\n## Next");
  assert.deepStrictEqual(tags(box), ["h3", "p", "hr", "h2"]);
  assert.strictEqual(box.children[0].textContent, "Title");
  assert.strictEqual(box.children[1].textContent, "Some bold and slanted words");
  assert.strictEqual(find(box, "strong")[0].textContent, "bold");
  assert.strictEqual(find(box, "em")[0].textContent, "slanted");
  assert.ok(!/[#*]/.test(box.textContent));
});

test("bullet lists and numbered lists, and a code block that keeps its characters", () => {
  const box = sandbox.renderText("- one\n* two\n\n1. first\n2. second\n\n```js\nconst a = **b**;\n# not a heading\n```\nafter");
  assert.deepStrictEqual(tags(box), ["ul", "ol", "pre", "p"]);
  assert.deepStrictEqual(box.children[0].children.map((c) => c.textContent), ["one", "two"]);
  assert.deepStrictEqual(box.children[1].children.map((c) => c.textContent), ["first", "second"]);
  assert.strictEqual(box.children[2].dir, "ltr");
  assert.strictEqual(box.children[2].textContent, "const a = **b**;\n# not a heading");
});

test("streaming: half-finished text already looks right, with no raw markers", () => {
  for (const partial of ["Hello **bo", "## Tit", "Hello **", "1. one\n2. tw", "text\n```\ncode so far", "a *sla"]) {
    const box = sandbox.renderText(partial);
    assert.ok(!/\*\*|^#|`/.test(box.textContent) || partial.includes("```"), partial + " -> " + box.textContent);
  }
  assert.strictEqual(sandbox.renderText("Hello **bo").children[0].textContent, "Hello bo");
  // running it again on a longer text replaces the old content instead of adding to it
  const box = sandbox.renderText("**a");
  sandbox.fillMarkdown(box, "**ab** done");
  assert.strictEqual(box.textContent, "ab done");
});

test("Hebrew right-to-left: every text block is direction auto, code stays left to right", () => {
  const box = sandbox.renderText("## כותרת\nשלום **עולם**\n- פריט");
  assert.strictEqual(box.children[0].dir, "auto");
  assert.strictEqual(box.children[1].dir, "auto");
  assert.strictEqual(box.children[2].dir, "auto");
  assert.strictEqual(box.children[2].children[0].dir, "auto");
});

test("HTML or script inside an answer stays inert text", () => {
  const evil = '<script>alert(1)</script> <img src=x onerror=alert(2)>\n# <b>head</b>\n- <i>item</i>\n**<u>x</u>**';
  const box = sandbox.renderText(evil);
  const all = (n) => [n, ...n.children.flatMap(all)];
  const made = new Set(all(box).map((n) => n.tag));
  for (const bad of ["script", "img", "b", "i", "u"]) assert.ok(!made.has(bad), bad);
  assert.ok(box.textContent.includes("<script>alert(1)</script>"));
  assert.ok(box.textContent.includes("<img src=x onerror=alert(2)>"));
});

test("both chats use it: answers and the streaming text, and the font is bigger on PC only", () => {
  assert.match(script, /fillMarkdown\(card\.partial, text\)/);
  assert.ok(!/card\.partial\.textContent = /.test(script));
  assert.match(html, /@media \(min-width: 761px\) \{ html \{ font-size: 18px; \} body \{ font-size: 18px; \} \}/);
  assert.match(html, /body \{[^}]*font: 16px\/1\.5/); // the phone keeps 16px
  const study = fs.readFileSync(path.join(__dirname, "public", "study.js"), "utf8");
  assert.ok(!/\.innerHTML|insertAdjacentHTML/.test(script + study));
});

test("a lone * in maths or code stays a star; only real *italics* are italic (English and Hebrew)", () => {
  for (const text of ["5*3 = 15", "int *p = malloc(4);", "2*3*4", "a**b", "2**10", "x * y * z", "a *sla"]) {
    const box = sandbox.renderText(text);
    assert.strictEqual(box.textContent, text, text);
    assert.strictEqual(find(box, "em").length + find(box, "strong").length, 0, text);
  }
  const it = sandbox.renderText("a *real italics* here and *עברית נטויה* too");
  assert.deepStrictEqual(find(it, "em").map((n) => n.textContent), ["real italics", "עברית נטויה"]);
  assert.strictEqual(it.textContent, "a real italics here and עברית נטויה too");
  const b = sandbox.renderText("**bold** and **מודגש** and **half");
  assert.deepStrictEqual(find(b, "strong").map((n) => n.textContent), ["bold", "מודגש", "half"]);
  assert.strictEqual(sandbox.renderText("שלום **עולם").children[0].textContent, "שלום עולם"); // streaming still works
  assert.strictEqual(sandbox.renderText("*x*").children[0].textContent, "x"); // one-letter italics
});

// ---- formulas ----
const texts = (n) => n.textContent.replace(/\s+/g, " ").trim();
const classed = (n, cls, out = []) => { if ((n.className || "").split(" ").includes(cls)) out.push(n); n.children.forEach((c) => classed(c, cls, out)); return out; };

test("a formula in a sentence is drawn: no dollar signs, no backslashes, left to right inside Hebrew", () => {
  const box = sandbox.renderText("תהי $f$ חסומה בקטע $[a,b]$ ואז $\\alpha \\le \\infty$.");
  assert.ok(!/[$\\]/.test(box.textContent));
  const maths = classed(box, "math");
  assert.strictEqual(maths.length, 3);
  assert.ok(maths.every((m) => m.dir === "ltr"));
  assert.strictEqual(texts(maths[2]), "α≤∞");
});

test("fractions, roots, sums with limits, integrals, sub and superscripts", () => {
  const box = sandbox.renderText("$$\\sum_{i=1}^n \\frac{a_i}{b^2} + \\sqrt{x} + \\int_a^b f(x)\\,dx + c_k^2$$");
  assert.ok(!/[$\\_^{}]/.test(box.textContent), box.textContent);
  assert.strictEqual(classed(box, "math-block").length, 1);
  const frac = classed(box, "math-frac")[0];
  assert.strictEqual(texts(classed(frac, "math-top")[0]), "ai");
  assert.ok(classed(frac, "math-bottom").length);
  const sum = classed(box, "math-op")[0];
  assert.strictEqual(classed(sum, "math-below")[0].textContent.replace(/\s/g, ""), "i=1");
  assert.strictEqual(texts(classed(sum, "math-above")[0]), "n");
  assert.ok(find(box, "sub").length >= 1);
  assert.strictEqual(classed(box, "math-under-root").length, 1);
  assert.strictEqual(texts(classed(box, "math-both")[1]), "2k", "a letter with both scripts shows them together");
});

test("the calculus shapes of a real page: limits, bars, sets, cases, \\left and \\right", () => {
  const box = sandbox.renderText("$\\lim_{n \\to \\infty} \\overline{S}(f,\\Delta) = \\left( x \\in \\mathbb{R} \\right)$ and $$f(x)=\\begin{cases} 1 & x>0 \\\\ 0 & \\text{else} \\end{cases}$$");
  assert.ok(!/\\|\$/.test(box.textContent), box.textContent);
  assert.ok(box.textContent.includes("lim") && box.textContent.includes("ℝ") && box.textContent.includes("else"));
  assert.strictEqual(classed(box, "math-over").length, 1);
  assert.strictEqual(classed(box, "math-row").length, 2);
  assert.strictEqual(classed(box, "math-below")[0].textContent.replace(/\s/g, ""), "n→∞");
});

test("money and plain text with dollars stay text", () => {
  for (const line of ["It costs $5 and $6 today", "from $5-$6", "a single $ sign", "$ 5 $"]) {
    const box = sandbox.renderText(line);
    assert.strictEqual(classed(box, "math").length, 0, line);
    assert.strictEqual(box.textContent, line);
  }
});

test("a formula still being written stays plain until it closes, and a block over several lines is one formula", () => {
  assert.strictEqual(classed(sandbox.renderText("so $x^2 + "), "math").length, 0);
  const box = sandbox.renderText("before\n$$\nx^2\n+ 1\n$$\nafter");
  assert.deepStrictEqual(tags(box), ["p", "div", "p"]);
  assert.strictEqual(texts(classed(box, "math-block")[0]).replace(/\s/g, ""), "x2+1");
  assert.deepStrictEqual(tags(sandbox.renderText("\\[\nx\n\\]")), ["div"]);
});

test("the other delimiters work, and code is left alone", () => {
  assert.strictEqual(classed(sandbox.renderText("inline \\(x^2\\) here"), "math").length, 1);
  assert.strictEqual(classed(sandbox.renderText("shown \\[x^2\\] here"), "math-block").length, 1);
  const code = sandbox.renderText("```\n$x^2$\n```\nand `$y$`");
  assert.strictEqual(classed(code, "math").length, 0);
  assert.ok(code.textContent.includes("$x^2$"));
});

test("hostile formulas end quickly and stay text: unknown commands, huge depth, huge length, HTML", () => {
  assert.ok(sandbox.renderText("$\\evilcommand{x}$").textContent.includes("\\evilcommand"));
  const t0 = Date.now();
  sandbox.renderText("$" + "\\frac{".repeat(3000) + "x" + "}".repeat(3000) + "$");
  sandbox.renderText("$" + "{".repeat(9000) + "$");
  sandbox.renderText("$" + "x^".repeat(9000) + "y$");
  sandbox.renderText("$\\begin{cases}$");
  sandbox.renderText("$\\sqrt[$");
  sandbox.renderText("$x_$");
  assert.ok(Date.now() - t0 < 3000);
  assert.strictEqual(find(sandbox.renderText("$<img src=x onerror=alert(1)>$"), "img").length, 0, "elements are only ever made by this code");
  assert.ok(sandbox.renderText("$\\constructor \\__proto__ \\toString$").textContent.includes("\\constructor"), "words of JavaScript itself are not symbols");
});
