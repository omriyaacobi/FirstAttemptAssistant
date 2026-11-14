// reply-layout.test.js
// The message box is a CSS grid (attach | text | Mic+Send). On 2026-11-14 a long "Replying to" chip squeezed the text box into a
// thin strip: the chip had no grid place of its own, so it fell into the narrow left column and stretched it. These checks read
// public/index.html (no browser) and make sure every part of the box has its own row, so that cannot happen again.
// (The real look was checked in a browser pane at laptop width and at 375 px.)
// Run with:  node --test

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8").replace(/\r\n/g, "\n");

// the grid-row and grid-column of one #form rule, or null when the rule is missing
function place(selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = html.match(new RegExp("\\n\\s*#form " + esc + " \\{([^}]*)\\}"));
  if (!m) return null;
  const row = (m[1].match(/grid-row: ([^;]+);/) || [])[1];
  const col = (m[1].match(/grid-column: ([^;]+);/) || [])[1];
  return { row, col };
}

test("the box is the 3-column grid with a text column that may shrink but never takes the chip's width", () => {
  assert.match(html, /#form\.composer \.inner \{ display: grid; grid-template-columns: auto minmax\(0, 1fr\) auto;/);
});

test("the quote chip has its own full-width row above the text, so a long quote cannot squeeze the text box", () => {
  const q = place(".quote-chip");
  assert.ok(q, "#form .quote-chip must have a grid place");
  assert.strictEqual(q.col, "1 / -1");
  const p = place(".photo-chip");
  assert.strictEqual(p.col, "1 / -1");
  const t = place("textarea#task");
  assert.strictEqual(t.col, "2");
  assert.ok(Number(q.row) < Number(p.row), "the quote chip sits above the photo chip");
  assert.ok(Number(p.row) < Number(t.row), "both chips sit above the text box");
  assert.strictEqual(place(".tools-row > .tools:first-child").row, t.row, "attach buttons on the text box's row");
  assert.strictEqual(place(".tools-row > .tools:last-child").row, t.row, "Mic and Send on the text box's row");
  assert.ok(Number(place(".row:not(.tools-row)").row) > Number(t.row), "the status line is under the text box");
});

test("every direct part of the message box has a grid place (an unplaced part lands in a narrow column)", () => {
  const form = html.match(/<form class="composer" id="form">\s*<div class="inner">([\s\S]*?)\n      <\/div>\n    <\/form>/);
  assert.ok(form, "found the message box markup");
  // direct children: lines indented exactly 8 spaces that open a tag
  const kids = [...form[1].matchAll(/\n {8}<(\w+)([^>]*)>/g)].map((m) => ({ tag: m[1], attrs: m[2] }));
  assert.ok(kids.length >= 5);
  for (const k of kids) {
    const cls = (k.attrs.match(/class="([^"]+)"/) || [])[1] || "";
    const id = (k.attrs.match(/id="([^"]+)"/) || [])[1] || "";
    if (cls.includes("tools-row")) continue; // display: contents; its two .tools children are placed (checked above)
    const sel = k.tag === "textarea" ? "textarea#" + id : cls === "row" ? ".row:not(.tools-row)" : "." + cls.split(" ")[0];
    const p = place(sel);
    assert.ok(p && p.row && p.col, "no grid place for <" + k.tag + " class=\"" + cls + "\" id=\"" + id + "\">");
  }
});

test("a long quote is cut to 3 lines in the chip (the full text is still kept for sending)", () => {
  assert.match(html, /\.quote-chip \.qtext, \.tquote \{[^}]*min-width: 0;[^}]*-webkit-line-clamp: 3;[^}]*overflow-wrap: anywhere;/);
  assert.match(html, /\.quote-chip \.qtext \{ line-height: 1\.4; max-height: 4\.2em; \}/);
  // setQuote keeps the whole marked text in T.quote; only the chip's view is cut
  assert.match(html, /T\.quote = \{ messageId: q\.id, text: q\.text \};/);
});
