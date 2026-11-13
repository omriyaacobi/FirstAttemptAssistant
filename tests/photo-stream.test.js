// tests/photo-stream.test.js
// askAgyStreamWithImage (providers.js): the brain looking at a photo. Checked with a fake stream (no real agy):
// the prompt goes to the streaming call (stdin, never the command line), agy runs in a brand-new folder that holds ONLY a copy of the
// photo under a fixed name, the photo time limit is used, and the folder is gone afterwards, also when the call fails.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { askAgyStreamWithImage, imageTimeoutFor } = require("../providers");

function photo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-test-photo-"));
  const file = path.join(dir, "IMG_2041 my private name.png");
  fs.writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
  return file;
}

test("the photo is copied alone into a private folder under a fixed name; the long prompt goes to the stream", async () => {
  const file = photo();
  let seen = null;
  const long = "x".repeat(50000); // longer than Windows allows on a command line
  const answer = await askAgyStreamWithImage("gemini-4-argon-low", long, file, () => {}, {
    stream: async (question, model, onText, options) => {
      seen = { question, model, options, files: fs.readdirSync(options.cwd) };
      return "a cat";
    },
  });
  assert.strictEqual(answer, "a cat");
  assert.strictEqual(seen.question, long);
  assert.deepStrictEqual(seen.files, ["photo.png"]);
  assert.strictEqual(seen.options.timeoutMs, imageTimeoutFor("gemini-4-argon-low"));
  assert.strictEqual(fs.existsSync(seen.options.cwd), false, "the private folder is deleted");
});

test("a photo call hands onUsage to the stream, so its tokens reach the token log (review 1.3, 2026-11-13)", async () => {
  const file = photo();
  const got = [];
  await askAgyStreamWithImage("gemini-4-argon-low", "q", file, () => {}, {
    onUsage: (u) => got.push(u),
    stream: async (q, m, t, options) => { options.onUsage({ input: 7, output: 1 }); return "ok"; },
  });
  assert.deepStrictEqual(got, [{ input: 7, output: 1 }]);
});

test("the private folder is deleted when the call fails, and a bad model name is refused", async () => {
  const file = photo();
  let dir = null;
  await assert.rejects(askAgyStreamWithImage("gemini-4-argon-low", "q", file, () => {}, { stream: async (q, m, t, o) => { dir = o.cwd; throw new Error("agy down"); } }), /agy down/);
  assert.strictEqual(fs.existsSync(dir), false);
  await assert.rejects(askAgyStreamWithImage("bad model; rm", "q", file), /model/i);
});

test("the photo time limits come from the measured timings: 90 s for Flash, 150 s for Argon", () => {
  assert.strictEqual(imageTimeoutFor("gemini-3.8-flash-medium"), 90 * 1000);
  assert.strictEqual(imageTimeoutFor("gemini-3.8-flash-low"), 90 * 1000);
  assert.strictEqual(imageTimeoutFor("gemini-4-argon-low"), 150 * 1000);
});
