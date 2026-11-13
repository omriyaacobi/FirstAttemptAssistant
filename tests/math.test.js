"use strict";
// Checks the math display in answers ($..$, $$..$$, \(..\), \[..\] turned into MathML) without a browser.
const test = require("node:test");
const assert = require("node:assert");
const { html, script, sandbox, tags, find, allNodes } = require("./pagesandbox");

const ml = (n) => (n.tag === "#text" ? n._text : "<" + n.tag + ">" + n._text + n.children.map(ml).join("") + "</" + n.tag + ">"); // the tree as a string
const math = (tex, display) => { const m = sandbox.texToMath(tex, display); return m && ml(m); };

test("the symbol tables are lined up (every name has its own character)", () => {
  for (const [name, c] of Object.entries(sandbox.TEX_MO).concat(Object.entries(sandbox.TEX_MI))) assert.ok(typeof c === "string" && c.length >= 1, name);
  assert.strictEqual(sandbox.TEX_MO.leq, "≤");
  assert.strictEqual(sandbox.TEX_MO.dagger, "†");
  assert.strictEqual(sandbox.TEX_MO.because, "∵");
  assert.strictEqual(sandbox.TEX_MI.omega, "ω");
  assert.strictEqual(sandbox.TEX_MI.Omega, "Ω");
  assert.strictEqual(sandbox.TEX_MI.nabla, "∇");
});

test("math: fractions, roots, powers, subscripts, bounds, greek letters", () => {
  assert.strictEqual(math("\\frac{a}{b}"), "<math><mfrac><mi>a</mi><mi>b</mi></mfrac></math>");
  assert.strictEqual(math("\\sqrt{x}"), "<math><msqrt><mi>x</mi></msqrt></math>");
  assert.strictEqual(math("\\sqrt[3]{x}"), "<math><mroot><mi>x</mi><mn>3</mn></mroot></math>");
  assert.strictEqual(math("x^2_i"), "<math><msubsup><mi>x</mi><mi>i</mi><mn>2</mn></msubsup></math>");
  assert.strictEqual(math("\\int_0^\\infty e^{-x}dx"), "<math><msubsup><mo>∫</mo><mn>0</mn><mi>∞</mi></msubsup><msup><mi>e</mi><mrow><mo>−</mo><mi>x</mi></mrow></msup><mi>d</mi><mi>x</mi></math>");
  assert.strictEqual(math("\\sum_{n=1}^{\\infty} a_n"), "<math><munderover><mo>∑</mo><mrow><mi>n</mi><mo>=</mo><mn>1</mn></mrow><mi>∞</mi></munderover><msub><mi>a</mi><mi>n</mi></msub></math>");
  assert.strictEqual(math("\\lim_{x \\to 0} f(x)"), "<math><munder><mi>lim</mi><mrow><mi>x</mi><mo>→</mo><mn>0</mn></mrow></munder><mi>f</mi><mo>(</mo><mi>x</mi><mo>)</mo></math>");
  assert.strictEqual(math("\\alpha + \\Omega \\leq \\partial \\nabla"), "<math><mi>α</mi><mo>+</mo><mi>Ω</mi><mo>≤</mo><mi>∂</mi><mi>∇</mi></math>");
  assert.strictEqual(math("f'(x)"), "<math><msup><mi>f</mi><mo>′</mo></msup><mo>(</mo><mi>x</mi><mo>)</mo></math>");
});

test("math: products, left/right, text, mathbb, cdot, times, cases and matrices", () => {
  assert.ok(math("\\prod_{i=1}^n i").startsWith("<math><munderover><mo>∏</mo>"));
  assert.ok(math("\\left( \\frac{a}{b} \\right)").includes("<mrow><mo>(</mo><mfrac>"));
  assert.ok(math("\\left. x \\right|").includes("<mrow></mrow>")); // \left. draws nothing
  assert.strictEqual(math("x \\in \\mathbb{R}"), "<math><mi>x</mi><mo>∈</mo><mi>ℝ</mi></math>");
  assert.strictEqual(math("a \\cdot b \\times c"), "<math><mi>a</mi><mo>⋅</mo><mi>b</mi><mo>×</mo><mi>c</mi></math>");
  assert.strictEqual(math("10,000\\text{ mAh}"), "<math><mn>10,000</mn><mtext>\u00a0mAh</mtext></math>");
  const cases = math("f(x)=\\begin{cases} 1 & x>0 \\\\ 0 & x\\le 0 \\end{cases}");
  assert.ok(cases.includes("<mtable><mtr><mtd><mn>1</mn></mtd><mtd>") && cases.split("<mtr>").length === 3, cases);
  const mat = math("\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}");
  assert.ok(mat.includes("<mo>(</mo><mtable>") && mat.split("<mtd>").length === 5, mat);
  assert.strictEqual(math("\\begin{bmatrix} 1 \\\\ 2 \\\\ \\end{bmatrix}").split("<mtr>").length, 3); // a trailing \\ adds no empty row
});

test("math: unknown or broken TeX falls back to the original text, never crashes or drops text", () => {
  for (const bad of ["\\unknowncmd{x}", "\\frac{a}", "{a", "a}", "\\begin{foo} x \\end{foo}", "\\begin{cases} x", "\\href{http://x}{y}", "\\sqrt", "", "   ", "a^^b", "\\left( x"]) assert.strictEqual(sandbox.texToMath(bad, false), null, bad);
  const box = sandbox.renderText("before $\\unknowncmd{x}$ after\n\n$$\\frac{a}$$\n\nend");
  assert.ok(box.textContent.includes("before $\\unknowncmd{x}$ after"));
  assert.ok(box.textContent.includes("$$\\frac{a}$$"));
  assert.ok(box.textContent.includes("end"));
});

test("math: names like constructor or __proto__ are not symbols", () => {
  for (const bad of ["\\constructor", "\\__proto__", "\\toString", "\\begin{constructor} \\end{constructor}"]) assert.strictEqual(sandbox.texToMath(bad, false), null, bad);
});

test("math: HTML or script inside a formula stays inert text", () => {
  const evil = "$\\text{<img src=x onerror=alert(1)>}$ and $$\\text{<script>alert(2)</script>}$$ and $<b>x</b>$";
  const box = sandbox.renderText(evil);
  const made = new Set(allNodes(box).map((n) => n.tag));
  for (const bad of ["script", "img", "b"]) assert.ok(!made.has(bad), bad);
  assert.ok(box.textContent.includes("<img src=x onerror=alert(1)>"));
  assert.ok(box.textContent.includes("<script>alert(2)</script>"));
  assert.ok(!allNodes(box).some((n) => Object.keys(n.attrs || {}).some((k) => /^on/i.test(k) || k === "style" || k === "href")));
});

test("math: long or deeply nested input cannot freeze the page", () => {
  const t0 = Date.now();
  assert.strictEqual(sandbox.texToMath("{".repeat(100000) + "x" + "}".repeat(100000), false), null);
  assert.strictEqual(sandbox.texToMath("x^".repeat(50000), false), null);
  assert.strictEqual(sandbox.texToMath("a+".repeat(5000), false), null); // longer than the limit
  assert.strictEqual(sandbox.texToMath("\\frac{".repeat(40) + "x" + "}{y}".repeat(40), false), null); // too deep
  assert.ok(sandbox.texToMath("a+".repeat(1400), false)); // long but fine
  assert.ok(sandbox.texToMath("x".repeat(500) + "+1", false));
  sandbox.renderText("$".repeat(30000) + "\n" + "$a ".repeat(8000) + "\n$$" + "x".repeat(50000));
  sandbox.renderText("*".repeat(30000) + "\n" + "\\(".repeat(8000));
  assert.ok(Date.now() - t0 < 5000, "took " + (Date.now() - t0) + " ms");
});

test("normal text stays literal: money, US$, shell variables, code and backticks", () => {
  for (const text of ["It costs $5 and $10 in total.", "US$ and US$5 and 5$", "echo $HOME and $PATH", "cp $HOME/$PATH x", "$5-$6", "about $ 5 $", "a $ b", "$$", "(\\alpha) is plain"]) {
    const box = sandbox.renderText(text);
    assert.strictEqual(find(box, "math").length, 0, text);
    assert.strictEqual(box.textContent, text, text);
  }
  const code = sandbox.renderText("`$x$` and `\\(y\\)`\n```\n$$z$$ and $w$\n```");
  assert.strictEqual(find(code, "math").length, 0);
  assert.deepStrictEqual(find(code, "code").map((n) => n.textContent), ["$x$", "\\(y\\)", "$$z$$ and $w$"]);
});

test("math is found before stars, and the star rules still hold", () => {
  const box = sandbox.renderText("5*3 = 15 and $a*b$ and *italic* and **bold**");
  assert.strictEqual(find(box, "math").length, 1);
  assert.ok(box.textContent.startsWith("5*3 = 15 and "));
  assert.deepStrictEqual(find(box, "em").map((n) => n.textContent), ["italic"]);
  assert.deepStrictEqual(find(box, "strong").map((n) => n.textContent), ["bold"]);
});

test("the four kinds of math marks, and display math in its own block", () => {
  const box = sandbox.renderText("Inline $x^2$ and \\(y_1\\) here.\n\n$$\\int_0^1 x\\,dx = \\frac12$$\n\n\\[\\lim_{n\\to\\infty} a_n\\]\n\nlast");
  assert.deepStrictEqual(tags(box), ["p", "div", "div", "p"]);
  assert.strictEqual(find(box.children[0], "math").length, 2);
  assert.strictEqual(box.children[1].className, "math-block");
  assert.strictEqual(box.children[1].dir, "ltr");
  assert.strictEqual(find(box.children[1], "math")[0].attrs.display, "block");
  assert.strictEqual(find(box.children[2], "munder").length, 1);
  assert.strictEqual(box.children[3].textContent, "last");
});

test("display math over several lines, with text after the closing mark", () => {
  const box = sandbox.renderText("$$\nx = \\frac{a}{b}\n$$ after\nmore\n- item $y$");
  assert.deepStrictEqual(tags(box), ["div", "p", "ul"]);
  assert.strictEqual(box.children[1].textContent, "after\nmore");
});

test("streaming: an unfinished $$ stays plain text and swallows nothing; it becomes math when it closes", () => {
  const partial = sandbox.renderText("Intro\n\n$$\\frac{a}{b}\n\nsecond paragraph");
  assert.strictEqual(find(partial, "math").length, 0);
  assert.ok(partial.textContent.includes("second paragraph"));
  assert.ok(partial.textContent.includes("Intro"));
  for (const cut of ["$$", "$$x", "$$x$", "$x", "\\(x", "\\[x \\", "a $$b$ c"]) assert.doesNotThrow(() => sandbox.renderText(cut), cut);
  assert.strictEqual(find(sandbox.renderText("Intro\n\n$$\\frac{a}{b}$$\n\nsecond"), "math").length, 1);
});

test("Hebrew: formulas are left to right, Hebrew inside \\text{} works, and the examples from a real answer", () => {
  const he = "האנרגיה:\n\n$$\\text{אנרגיה כוללת} = 10,000\\text{ mAh} \\times 3.7\\text{V} = 37\\text{Wh}$$\n\nואז $\\frac{37\\text{Wh}}{5\\text{V}} = 7,400\\text{mAh}$ (או ($3.7\\text{V}$)).";
  const box = sandbox.renderText(he);
  assert.strictEqual(find(box, "math").length, 3);
  assert.ok(!/\$|\\text|\\frac/.test(box.textContent), box.textContent);
  for (const n of allNodes(box).filter((x) => x.className === "math" || x.className === "math-block")) assert.strictEqual(n.dir, "ltr");
  assert.ok(find(box, "mtext").some((n) => n.textContent === "אנרגיה כוללת"));
  assert.strictEqual(box.children[2].dir, "auto"); // the Hebrew paragraph still lines up right to left
});

test("the page styles math: formulas scroll inside their own box", () => {
  assert.match(html, /\.math-block \{[^}]*overflow-x: auto/);
  assert.match(html, /\.math \{[^}]*max-width: 100%[^}]*overflow-x: auto/);
  assert.match(script, /createElementNS\(MATHNS/);
});
