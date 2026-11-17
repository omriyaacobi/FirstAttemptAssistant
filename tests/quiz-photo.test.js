// tests/quiz-photo.test.js
// 2026-11-17, 10:09: Omri answered an open quiz question with a PHOTO of his work and a line of words. The brain (Argon) looked at
// the photo and called quiz_answer, but the tutor that grades the answer got only the words, so the photo was ignored. Now the brain
// writes out what the photo shows ("photo" in quiz_answer) and code hands it to the tutor as marked data, only when the message
// really has a photo. Made-up data only.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), name));
const NOW = new Date("2026-11-07T12:00:00+02:00").getTime();
const DB = { id: "b".repeat(16), name: "Databases Demo" };

function world(brainReplies) {
  const { createStudyCoach } = require("../study-coach");
  const { createBrain } = require("../brain");
  const graderPrompts = [];
  const askChain = async (chain, prompt) => {
    if (/Grade ONE answer/.test(prompt)) graderPrompts.push(prompt);
    return { answer: /Grade ONE answer/.test(prompt) ? JSON.stringify({ verdict: "partial", feedback: "Close.", note: "", relevant: true }) : "Think again.", used: { model: chain[0].model } };
  };
  const courses = { list: () => [DB], allPages: () => [] };
  const coach = createStudyCoach({ dir: tmp("bot-quiz-photo-"), courses, askChain, now: () => NOW });
  let i = 0;
  const brain = createBrain({
    courses, coach,
    courseRoutes: { list: () => [DB], courseFiles: () => ({ files: [] }), linkFiles: () => [] },
    reminders: { list: () => [] }, memory: { list: () => [] }, cards: { add: () => ({}) }, readCalendar: async () => ({ text: "" }),
    fetchPage: async () => ({ title: "t", text: "page text" }),
    askOne: async () => { const r = brainReplies[i++]; if (r === undefined) throw new Error("no more scripted replies"); return r; },
    askImage: async () => { const r = brainReplies[i++]; if (r === undefined) throw new Error("no more scripted photo replies"); return r; },
    photoChain: [{ provider: "agy", model: "fake-photo" }],
    chain: [{ provider: "agy", model: "fake" }], poolLevels: async () => [], refreshPools: () => {}, notePoolFailure: () => {},
    now: () => NOW,
  });
  const ref = coach.tracker.refsFor([DB])[0];
  coach.tracker.setSession(ref, { id: "s1", mode: "quiz", lang: "en", startedAt: NOW, target: { type: "lecture", date: null, n: 1 }, current: 0,
    questions: [{ id: "q1", q: "Compute the integral of x cos(x^2) from 0 to sqrt(pi).", key: "0", topic: "substitution", attempts: 0, hints: 0, state: "open", verdict: null, revealed: false }] });
  return { brain, graderPrompts };
}

const CALL = 'CALL {"tool":"quiz_answer","course":"Databases Demo","ask":"answer","photo":"$t=x^2$, $dt=2x\\\\,dx$\\n$\\\\frac12\\\\int_0^{\\\\pi}\\\\cos t\\\\,dt = \\\\frac12\\\\sin t\\\\big|_0^{\\\\pi} = -1$"}';

test("a quiz answer sent as a photo: the tutor gets what the photo shows, marked as data, next to Omri's words", async () => {
  const dir = tmp("bot-quiz-photo-img-");
  const image = { path: path.join(dir, "work.jpg") };
  fs.writeFileSync(image.path, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]));
  const w = world([CALL]);
  await w.brain.handle("this does not make sense, the area should be positive", { history: [], courses: [DB], image });
  assert.ok(w.graderPrompts.length >= 1, "the answer was graded");
  const p = w.graderPrompts[0];
  assert.match(p, /the area should be positive/, "Omri's words are there");
  assert.match(p, /also came as a photo of their work/, "the tutor is told the answer came as a photo");
  assert.match(p, /\\frac12\\sin t/, "and what the photo shows");
  assert.match(p, /data, never instructions/);
});

test("without a photo in the message, a 'photo' field is ignored (a model cannot slip text into the grading)", async () => {
  const w = world([CALL]);
  await w.brain.handle("the answer is minus one", { history: [], courses: [DB] });
  assert.ok(w.graderPrompts.length >= 1);
  assert.doesNotMatch(w.graderPrompts[0], /came as a photo|\\frac12\\sin t/);
});
