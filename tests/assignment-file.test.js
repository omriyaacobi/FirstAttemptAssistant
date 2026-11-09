// assignment-file.test.js: "I'm starting my assignment" while no assignment is saved, but the course already holds an uploaded file that looks like one.
// Made-up course, file and text; a fake model.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createStudyCoach } = require("../study-coach");

const NOW = new Date("2026-11-09T12:00:00+02:00").getTime();
const SP = { id: "a".repeat(16), name: "Systems Programming" };
const PAGES = [
  { fileId: "f1", fileName: "Assignment_1_Demo_2026.pdf", page: 1, text: "Assignment 1. Write a small program with a Makefile. Topics: pointers, the Rule of 3." },
  { fileId: "f2", fileName: "lecture-1.pdf", page: 1, text: "Made-up lecture text." },
];

function make(pages) {
  const askChain = async () => ({ answer: JSON.stringify({ title: "Assignment 1 - Demo", due: null, needs: ["pointers", "Makefile"] }), used: { model: "fake" } });
  const courses = { list: () => [SP], allPages: () => pages };
  return createStudyCoach({ dir: fs.mkdtempSync(path.join(os.tmpdir(), "bot-asgfile-")), courses, askChain, now: () => NOW });
}

test("no saved assignment but an assignment file is in the course: it is proposed (Confirm card), not 'send me the file'", async () => {
  const coach = make(PAGES);
  const r = await coach.answerStudy({ studyIntent: "start", text: "I am starting my assignment, I am in section 3.3", courseId: SP.id, courseName: SP.name });
  assert.match(r.answer, /I read this as an assignment for Systems Programming: "Assignment 1 - Demo"/);
  assert.ok(r.proposal && r.proposal.kind === "assignment");
  assert.doesNotMatch(r.answer, /Send me the file/);
});

test("the message names the file: that file wins; a lecture file is never taken for an assignment", async () => {
  const coach = make([...PAGES, { fileId: "f3", fileName: "Exercise_2_Demo.pdf", page: 1, text: "Exercise 2 text." }]);
  const r = await coach.answerStudy({ studyIntent: "start", text: "help me start Assignment_1_Demo_2026", courseId: SP.id, courseName: SP.name });
  assert.ok(r.proposal && r.proposal.kind === "assignment");
  const none = make([PAGES[1]]);
  const r2 = await none.answerStudy({ studyIntent: "start", text: "I am starting my assignment", courseId: SP.id, courseName: SP.name });
  assert.ok(!r2.proposal);
  assert.match(r2.answer, /Send me the file/);
});
