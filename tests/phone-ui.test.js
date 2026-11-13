// phone-ui.test.js
// Checks the phone parts of the web page (public/index.html) without a browser: the camera button, the file chip, the bottom bar,
// the keyboard rules, the "do not wipe what you typed" rule, and that no cache can keep the phone on an old page.
// (The real look was checked in a browser pane at 375 px; the real camera and keyboard need a real phone.)
// Run with:  node --test

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8").replace(/\r\n/g, "\n");
const sw = fs.readFileSync(path.join(__dirname, "..", "public", "sw.js"), "utf8");
const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

test("the keyboard shrinks the page instead of covering the box, and the bar steps aside while you type", () => {
  assert.match(html, /<meta name="viewport"[^>]*interactive-widget=resizes-content/);
  assert.match(html, /body\.typing \.bottombar \{ display: none; \}/);
  assert.match(html, /document\.addEventListener\("focusin"/);
  assert.match(html, /scrollIntoView\(\{ block: "nearest" \}\)/);
});

test("camera: a button opens the back camera, and its picture goes down the same path as a picked picture", () => {
  assert.match(html, /<input type="file" id="cameraInput" accept="image\/\*" capture="environment" hidden>/);
  const button = html.match(/<button[^>]*id="camera"[^>]*>/)[0];
  assert.match(button, /aria-label="Take a photo"/);
  assert.match(html, /button\.attach \{[^}]*width: 44px; height: 44px/);
  // the camera file is handed to the very same photo input, so shrinking, the chip and /api/ask are the old ones
  assert.match(html, /\$\("photoInput"\)\.files = transfer\.files;\s*\$\("photoInput"\)\.dispatchEvent\(new Event\("change"\)\)/);
  assert.match(html, /ask\(task, attached \? attached\.dataUrl : null, false\)/);
  assert.match(html, /\$\("camera"\)\.addEventListener\("click"/);
});

test("files: a PDF, pptx, docx, txt or md waits in a chip with a remove button, then goes to the checked upload route; pictures are not files", () => {
  assert.match(html, /const FILE_TYPES = \/\\\.\(pdf\|pptx\|docx\|txt\|md\|zip\)\$\/i;/);
  assert.match(html, /const MAX_FILE = 50 \* 1024 \* 1024;/); // the same 50 MB as the server (upload checks are never weakened)
  assert.match(html, /\/api\/thread\/upload\?name=/);
  assert.match(html, /\/api\/thread\/file\/" \+ encodeURIComponent\(choice\.id\) \+ "\/assign"/);
  assert.match(html, /aria-label="Remove attachment"/);
  assert.match(html, /id="fileProgress"/);
  assert.match(html, /xhr\.upload\.onprogress/);
  assert.doesNotMatch(html, /function fileDialog/);
  // the server side is unchanged: it still checks the real first bytes, so the page's checks are only a courtesy
  assert.match(fs.readFileSync(path.join(__dirname, "..", "thread-files.js"), "utf8"), /sniffFile\(bytes\)/);
});

test("phone layout: a bar of main places under the thumb, Restart Bot easy to find, never hidden on the phone", () => {
  for (const id of ["tabChat", "tabStudy", "tabImprove", "tabMenu"]) assert.match(html, new RegExp(`<button type="button" class="tab" id="${id}"`));
  assert.match(html, /\.bottombar button\.tab \{[^}]*min-height: 56px/);
  assert.match(html, /<button class="ghost" id="restartSide"/);
  assert.match(html, /\$\("restartSide"\)\.addEventListener\("click", restartBot\)/);
  assert.doesNotMatch(html, /\$\("restartTop"\)\.hidden = session\.remote/); // that line hid the button for good after opening Improve Bot on the phone
  assert.match(html, /\$\("gitCard"\)\.hidden = session\.remote/); // Push to GitHub stays PC-only
  assert.match(html, /button, select, summary, \.improve-head \.actions button, \.coursebar button \{ min-height: 44px; \}/);
});

test("the page starts only after the thread script is there (a fast answer used to start the OLD chat list)", () => {
  assert.match(html, /document\.readyState === "loading"\) await new Promise\(\(resolve\) => document\.addEventListener\("DOMContentLoaded"/);
});

test("words typed while a message is on its way stay in the box (clearSentText)", () => {
  const fn = html.match(/function clearSentText\(sentRaw\) \{[\s\S]*?\n  \}/)[0];
  const box = { value: "" };
  const sandbox = { $: () => box };
  vm.createContext(sandbox);
  vm.runInContext(fn + "\nthis.clearSentText = clearSentText;", sandbox);
  box.value = "hello"; sandbox.clearSentText("hello"); assert.strictEqual(box.value, "");
  box.value = "hello and then more"; sandbox.clearSentText("hello"); assert.strictEqual(box.value, "and then more");
  box.value = "something else"; sandbox.clearSentText("hello"); assert.strictEqual(box.value, "something else"); // edited at the start: nothing is thrown away
  // every send path uses it instead of emptying the box after the round trip
  assert.doesNotMatch(html, /await ask\([^\n]*\n\s*\$\("task"\)\.value = ""/);
  assert.match(html, /clearSentText\(sentRaw\);\s*clearPhoto\(\);\s*\$\("tempty"\)\.hidden = true;/);
  assert.match(html, /startsWith\(sentRaw\)\) \$\("improveText"\)\.value/);
});

test("no cache can keep the phone on an old page", () => {
  assert.doesNotMatch(sw, /addEventListener\("fetch"/); // the service worker has no fetch handler: every request goes to the server
  assert.doesNotMatch(sw, /caches\./); // and it stores nothing
  assert.match(server, /"Content-Type": "text\/html; charset=utf-8", "Cache-Control": "no-store"/); // the page itself
  assert.match(html, /async function checkNewPage\(\)/); // a page left open in the background asks for the page again when you come back
  assert.match(html, /fetch\("\/", \{ cache: "no-store" \}\)/);
});

test("an upload refusal drops your words only when the server really kept the message; a login that ended keeps everything", () => {
  const threadScript = (html.match(/<script id="threadScript">([\s\S]*?)<\/script>/) || [])[1] || "";
  const pure = threadScript.match(/\/\/ <thread-pure>([\s\S]*?)\/\/ <\/thread-pure>/)[1];
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(pure + "\nthis.out = { tUploadKept, tUploadError };", sandbox);
  const { tUploadKept, tUploadError } = sandbox.out;
  assert.strictEqual(tUploadKept(409, [], "a.pdf"), true); // a duplicate is only refused after the message was saved
  assert.strictEqual(tUploadKept(415, ["(file attached: a.pdf) hi"], "a.pdf"), true); // refused after saving: the thread shows a new message
  assert.strictEqual(tUploadKept(415, [], "a.pdf"), false); // refused by the first-bytes check before anything was saved
  assert.strictEqual(tUploadKept(413, [], "a.pdf"), false);
  for (const status of [401, 403, 500, 502, 504]) assert.strictEqual(tUploadKept(status, ["(file attached: a.pdf)"], "a.pdf"), false, "status " + status + " keeps nothing");
  assert.match(tUploadError(401, "log in first"), /Log in again/);
  assert.doesNotMatch(html, /saved: true/); // the old rule: every non-2xx answer counted as saved
  assert.match(html, /\[400, 409, 413, 415\]\.includes\(error\.status\)/);
});

test("the bottom bar comes back when the keyboard goes away although the box keeps focus (Back gesture)", () => {
  assert.match(html, /function keyboardCheck\(\)/);
  assert.match(html, /window\.visualViewport\.addEventListener\("resize"/);
  assert.match(html, /window\.addEventListener\("resize"/);
  assert.match(html, /h >= heightNoKeyboard - 80\) document\.body\.classList\.remove\("typing"\)/);
  assert.match(html, /document\.addEventListener\("input"[^\n]*classList\.add\("typing"\)/);
});
