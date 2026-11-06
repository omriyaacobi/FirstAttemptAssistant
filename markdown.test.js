"use strict";
// Checks how answers are drawn on the web page (the Markdown part of public/index.html) without a browser:
// the page's own functions run against a tiny fake DOM, so we can look at the elements they build.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { html, script, sandbox, tags, find } = require("./pagesandbox");

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
