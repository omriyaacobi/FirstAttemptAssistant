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
  assert.ok(button > side.indexOf('id="quotaBtn"'), "button comes after the quota button");
  assert.match(side.slice(side.lastIndexOf("<button", button), button), /class="improve"/);
  assert.match(html, /button\.improve\s*\{[^}]*margin-top:\s*auto/);
});

test("the page uses a purple accent", () => {
  assert.match(html, /--accent:\s*#9333ea/);
});

test("the dark Midnight design is the default, and the Classic design is kept to switch back to", () => {
  assert.match(html, /<html[^>]*data-theme="midnight"/);
  assert.match(html, /:root\[data-theme="midnight"\]\s*\{[^}]*--bg:\s*#0c0b10/);
  assert.match(html, /:root\[data-theme="midnight"\]\s*\{[^}]*--pink:/);
  // every design in the picker is either Classic (the base styles) or has its own block
  const side = html.slice(html.indexOf('<aside class="side"'), html.indexOf("</aside>"));
  const picker = side.match(/<select id="themePick"[^>]*>([\s\S]*?)<\/select>/);
  assert.ok(picker, "the design picker is in the sidebar");
  const names = [...picker[1].matchAll(/value="([^"]+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(names.slice(0, 2), ["midnight", "classic"]);
  for (const name of names.filter((n) => n !== "classic")) assert.ok(html.includes(`:root[data-theme="${name}"]`), name);
  assert.ok(side.indexOf('id="themePick"') < side.indexOf('id="improveBtn"'), "Improve Bot stays last");
  assert.match(html, /localStorage\.setItem\("botTheme"/);
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

test("the photo button is a round icon button with a preview chip, and photos are shrunk in the page", () => {
  const tag = html.match(/<button[^>]*id="attach"[^>]*>/)[0];
  assert.doesNotMatch(tag, /\bhidden\b/);
  assert.match(tag, /aria-label="Attach a photo"/);
  assert.match(html, /<input type="file" id="photoInput" accept="image\/\*" hidden>/);
  assert.match(html, /button\.attach \{[^}]*width: 44px; height: 44px/);
  assert.match(html, /id="photoChip"/);
  assert.match(html, /createImageBitmap/);
  assert.match(html, /toDataURL\("image\/jpeg"/);
  assert.match(html, /image: attached\.dataUrl/); // the photo travels with the message
});

test("sending a message starts a background job and the page follows it by polling, not by one long request", () => {
  assert.match(html, /fetch\("\/api\/jobs/);
  assert.doesNotMatch(html, /getReader\(\)/);
  // no chat switching or composer lock-out depends on a request being open any more
  assert.doesNotMatch(html, /if \(busy\) return;/);
});

test("the quota is a pop-up opened from a sidebar button, not a panel in the middle of the sidebar", () => {
  const side = html.slice(html.indexOf('<aside class="side"'), html.indexOf("</aside>"));
  assert.match(side, /<button id="quotaBtn"[^>]*aria-haspopup="dialog"/);
  assert.doesNotMatch(side, /id="quota"/); // the numbers live in the dialog, outside the sidebar
  const dialog = html.match(/<dialog class="popup" id="quotaDialog"[\s\S]*?<\/dialog>/);
  assert.ok(dialog, "the dialog exists");
  assert.match(dialog[0], /id="quota"/);
  assert.match(dialog[0], /id="quotaClose"/);
  assert.match(html, /showModal\(\)/);
  assert.match(html, /\[data-theme="midnight"\] dialog\.popup/); // styled in both designs
  assert.match(html, /dialog\.popup \{[^}]*var\(--card\)/);
  assert.match(html, /dialog\.popup \{[^}]*calc\(100vw - 32px\)/); // fits a phone
});

test("Improve Bot is a chat: progress, follow-ups, preview, and simple Approve and Reject buttons", () => {
  const view = html.slice(html.indexOf('<section class="chat" id="improveView"'), html.indexOf("<script>"));
  for (const id of ["improveThread", "improveText", "improveStart", "newImprove", "previewFrame", "pinForm"]) assert.ok(view.includes(`id="${id}"`), id);
  assert.match(view, /<iframe id="previewFrame"[^>]*sandbox="allow-scripts"/); // no allow-same-origin
  assert.doesNotMatch(view, /allow-same-origin/);
  assert.ok(html.includes("`/api/selfedit/${p.id}/message`")); // a follow-up goes to the same proposal
  assert.ok(html.includes("`/api/selfedit/${id}/preview`"));
  assert.match(html, /"approve", "Approve"/);
  assert.match(html, /"danger", "Reject"/);
  assert.match(html, /Show the technical details and code changes/); // the diff is folded away, not removed
  assert.match(html, /Last sign of life/); // so it is clear the editor is alive
  assert.match(html, /queued\.push/); // messages typed while it works wait their turn
  assert.match(html, /\.preview-box \{/); // Preview is a popup over the dimmed chat, not a full page
});

const study = fs.readFileSync(path.join(__dirname, "public", "study.js"), "utf8");

test("every course card is exactly the same size, and a long name is cut instead of growing the card", () => {
  assert.match(html, /\.course-grid \{[^}]*grid-auto-rows: 112px/);
  assert.match(html, /\.course-card strong \{[^}]*-webkit-line-clamp: 2/);
  assert.match(study, /card\.title = c\.name/); // the full name stays reachable
});

test("course cards and pages show only real data (no invented progress, percentages or next steps)", () => {
  for (const invented of ["conic-gradient", "% studied", "Continue where", "last studied", "Next step"]) assert.ok(!new RegExp(invented, "i").test(study), invented);
  assert.match(study, /files, \$\{c\.pages\} pages read/);
});

test("Add material is on every course screen, and one picker outside the redrawn area keeps the chosen file", () => {
  assert.match(study, /"\+ Add material"/);
  assert.match(study, /picker\.id = "studyPicker"/);
  assert.match(study, /view\.appendChild\(picker\)/);
  assert.match(study, /status\.id = "uploadStatus"/); // the upload message is drawn from uploadNote on every redraw
  assert.match(html, /<button id="quotaBtn"/); // Quota is in the sidebar, which is the phone's menu too
  assert.match(html, /id="attach"[^>]*aria-label="Attach a photo"/); // the camera button stays in the chat
});
