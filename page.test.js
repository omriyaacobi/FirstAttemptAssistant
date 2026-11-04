// page.test.js
// Checks the layout of the web page (public/index.html) without opening a browser.
// Run with:  node --test

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "public", "index.html"), "utf8");

test("the Improve button is the last thing in the sidebar and has its own big style", () => {
  const side = html.slice(html.indexOf('<aside class="side"'), html.indexOf("</aside>"));
  const button = side.indexOf('id="improveBtn"');
  assert.ok(button > 0, "button is inside the sidebar");
  assert.ok(button > side.indexOf('aria-label="Quota"'), "button comes after the quota panel");
  assert.match(side.slice(side.lastIndexOf("<button", button), button), /class="improve"/);
  assert.match(html, /button\.improve\s*\{[^}]*margin-top:\s*auto/);
});

test("the page uses a purple accent", () => {
  assert.match(html, /--accent:\s*#9333ea/);
});

test("sending a message starts a background job and the page follows it by polling, not by one long request", () => {
  assert.match(html, /fetch\("\/api\/jobs/);
  assert.doesNotMatch(html, /getReader\(\)/);
  // no chat switching or composer lock-out depends on a request being open any more
  assert.doesNotMatch(html, /if \(busy\) return;/);
});
