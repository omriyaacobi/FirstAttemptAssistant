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

test("the phone's Back button is handled with the History API", () => {
  assert.match(html, /history\.pushState/);
  assert.match(html, /addEventListener\("popstate"/);
  // the base screen is stored first, so Back from it leaves the app instead of looping
  assert.match(html, /history\.replaceState\(navState, ""\);\s*\/\/ the base screen/);
});

test("the sidebar can be closed without choosing a chat: backdrop, close button, swipe", () => {
  assert.match(html, /id="backdrop"/);
  assert.match(html, /id="sideClose"[^>]*aria-label="[^"]+"/);
  assert.match(html, /\$\("backdrop"\)\.addEventListener\("click", closeSide\)/);
  assert.match(html, /\$\("sideClose"\)\.addEventListener\("click", closeSide\)/);
  assert.match(html, /touchend/);
});

test("the Chats button is an accessible 44px icon button", () => {
  for (const id of ["menu", "menu2"]) {
    const tag = html.match(new RegExp(`<button[^>]*id="${id}"[^>]*>`))[0];
    assert.match(tag, /class="iconbtn"/);
    assert.match(tag, /aria-label="Show conversations"/);
  }
  assert.match(html, /\.iconbtn \{[^}]*width: 44px; height: 44px/);
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /env\(safe-area-inset-top\)/);
});

test("the photo button is a hidden-until-supported round icon button with a preview chip, and photos are shrunk in the page", () => {
  const tag = html.match(/<button[^>]*id="attach"[^>]*>/)[0];
  assert.match(tag, /\bhidden\b/); // only shown when the server says session.images
  assert.match(tag, /aria-label="Attach a photo"/);
  assert.match(html, /<input type="file" id="photoInput" accept="image\/\*" hidden>/);
  assert.match(html, /button\.attach \{[^}]*width: 44px; height: 44px/);
  assert.match(html, /id="photoChip"/);
  assert.match(html, /createImageBitmap/);
  assert.match(html, /toDataURL\("image\/jpeg"/);
  assert.match(html, /if \(session\.images\) \$\("attach"\)\.hidden = false/);
});
