// jobs.test.js
// Tests the background jobs (jobs.js) with fake models, plus how server.js exposes them.
// Run with:  node --test

const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createJobs, describeProgress, JOB_ID_PATTERN } = require("../jobs");
const { createServer } = require("../server");
const { createStore } = require("../store");

const answer = { mode: "single", answer: "ok", used: { provider: "p", model: "m" } };
const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));
const tempStore = () => createStore(fs.mkdtempSync(path.join(os.tmpdir(), "bot-jobs-")));
const gate = () => { let release; const wait = new Promise((r) => (release = r)); return { wait, release }; };

test("describeProgress turns log lines into plain words", () => {
  assert.match(describeProgress([]), /Starting/);
  assert.strictEqual(describeProgress(["[brain] reading your message"]), "Reading your message");
  assert.strictEqual(describeProgress(["[brain] asking gemini-4-argon-low"]), "Asking gemini-4-argon-low");
  assert.strictEqual(describeProgress(["[brain] reading your message", "[brain] asking gemini-4-argon-low"]), "Reading your message (gemini-4-argon-low)");
  assert.match(describeProgress(["[brain] asking a", "[brain] gemini-4-argon-low failed after 3 s: boom"]), /argon-low did not answer, trying the next model/);
  assert.match(describeProgress(["[quota] low: x"]), /Starting/); // unknown lines change nothing
  assert.match(describeProgress(["[frontdesk] asking x"]), /Starting/); // the old front desk is gone, its lines mean nothing now
});

test("describeProgress says which lecture a course answer is reading, and what the study coach is doing", () => {
  assert.strictEqual(describeProgress(["[course] Calculus 2: 6 of 87 pages sent (lecture)  lectures: 5".replace("  ", " ")]), "Reading Calculus 2, lecture 5 (6 pages)");
  assert.strictEqual(describeProgress(["[course] Calculus 2: 9 of 87 pages sent (search) lectures: 5,6"]), "Reading Calculus 2, lectures 5, 6 (9 pages)");
  assert.strictEqual(describeProgress(["[course] Calculus 2: 1 of 87 pages sent (search)"]), "Reading Calculus 2 (1 page)");
  assert.match(describeProgress(["[study] teach in Calculus 2"]), /Preparing the lesson \(Calculus 2\)/);
  assert.match(describeProgress(["[study] teach in Calculus 2", "[tutor] asking gemini-4-argon-medium"]), /tutor model/);
  assert.match(describeProgress(["[study] progress"]), /progress/);
});

test("describeProgress names every brain tool, newer ones too (2026-11-13)", () => {
  assert.strictEqual(describeProgress(["[brain] tool project_read (Systems Programming)"]), "Reading your code (Systems Programming)");
  assert.strictEqual(describeProgress(["[brain] tool pc_find"]), "Searching your PC by name");
  assert.strictEqual(describeProgress(["[brain] tool moodle_news (Algebra)"]), "Reading the Moodle announcements (Algebra)");
  assert.strictEqual(describeProgress(["[brain] tool teach_next"]), "Preparing the lesson");
  assert.strictEqual(describeProgress(["[brain] tool something_new"]), "Working on it");
});

test("get() refuses ids that are not 32 hex characters", () => {
  const jobs = createJobs({ handle: async () => answer, store: tempStore() });
  for (const id of ["", "abc", "../../x", "A".repeat(32), "a".repeat(31), 42, null]) assert.strictEqual(jobs.get(id), null);
});

// ---- through the real server ----
async function startServer(handle, pushes) {
  const store = tempStore();
  const server = createServer({
    handle, store,
    push: { publicKey: () => null, notifyAll: async (m) => { pushes.push(m); return {}; } },
    usage: async () => [],
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const request = (method, p, body) =>
    new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, method, path: p, headers: { Host: `localhost:${port}`, ...(body ? { "Content-Type": "application/json" } : {}) } }, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, json: () => JSON.parse(data) }));
      });
      req.on("error", reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  return { store, request, close: () => new Promise((r) => server.close(r)) };
}

