// suggestion-filter.test.js: suggestions must not repeat what Bot already has (made-up text only).
const test = require("node:test");
const assert = require("node:assert");
const { visibleProposals, isDuplicate, similar } = require("../suggestion-filter");

const existing = {
  facts: ["Omri's favorite color is green."],
  reminders: ["Call the bank", "Drink water"],
  assignments: ["Homework 2 - Algorithms Planning"],
  calendar: ["padel test", "tennis with Yonatan"],
};

test("a task that is already a reminder, an assignment or a calendar card is hidden", () => {
  assert.strictEqual(isDuplicate({ kind: "task", text: "Call the bank", due: "2026-11-08" }, existing), true);
  assert.strictEqual(isDuplicate({ kind: "task", text: "Drink water", due: "2026-11-07" }, existing), true);
  assert.strictEqual(isDuplicate({ kind: "task", text: "Submit Homework 2 for Algorithms Planning" }, existing), true);
  assert.strictEqual(isDuplicate({ kind: "task", text: "Play tennis with Yonatan" }, existing), true);
  assert.strictEqual(isDuplicate({ kind: "task", text: "Buy a birthday present for Dana" }, existing), false);
});

test("a fact that is already saved is hidden; a different one stays", () => {
  assert.strictEqual(isDuplicate({ kind: "fact", text: "The user's favorite color is green." }, existing), true);
  assert.strictEqual(isDuplicate({ kind: "fact", text: "The user lives in a student apartment." }, existing), false);
});

test("a place in a course is the tracker's business, not a fact", () => {
  for (const t of ["The user is at lecture 5 in Calculus 2.", "The user has not started studying Algorithms Planning yet.", "The user is up to date in Systems.", "המשתמש בהרצאה 4 בחדוא"]) {
    assert.strictEqual(isDuplicate({ kind: "fact", text: t }, existing), true, t);
  }
  assert.strictEqual(isDuplicate({ kind: "fact", text: "The user finds lectures at 8 in the morning too early." }, existing), false);
});

test("a task is not compared with facts and a fact is not compared with reminders", () => {
  assert.strictEqual(isDuplicate({ kind: "task", text: "favorite color green" }, existing), false);
  assert.strictEqual(isDuplicate({ kind: "fact", text: "Call the bank" }, existing), false);
});

test("visibleProposals filters a list and keeps the order; empty lists hide nothing", () => {
  const list = [{ id: "f1", kind: "fact", text: "The user's favorite color is green." }, { id: "t1", kind: "task", text: "Call the bank" }, { id: "t2", kind: "task", text: "Renew the passport", due: "2026-12-01" }];
  assert.deepStrictEqual(visibleProposals(list, existing).map((p) => p.id), ["t2"]);
  assert.deepStrictEqual(visibleProposals(list, { facts: [], reminders: [], assignments: [], calendar: [] }).map((p) => p.id), ["f1", "t1", "t2"]);
  assert.strictEqual(similar("", "x y"), false);
});
