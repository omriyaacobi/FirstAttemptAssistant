// Tests the time limit of a photo question (providers.js askAgyWithImage) and the model order for a calendar photo (core.js).
// A fake agy: child_process.execFile is replaced (before providers.js loads). The fake agy never answers; "taskkill" calls are recorded.
const cp = require("node:child_process");
const killed = [];
cp.execFile = (cmd, args, options, callback) => {
  if (cmd === "taskkill") { killed.push(args); (typeof options === "function" ? options : callback)(null, "", ""); return { on() {}, kill() {}, pid: 1 }; }
  return { on() {}, kill() { killed.push("kill"); }, pid: 4242 }; // agy: stays silent, so only the time limit ends it
};
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { askAgyWithImage, imageTimeoutFor } = require("../providers");

test("the limits come from the measured timings: 90 s for Flash, 150 s for Argon", () => {
  assert.strictEqual(imageTimeoutFor("gemini-3.8-flash-medium"), 90 * 1000);
  assert.strictEqual(imageTimeoutFor("gemini-3.8-flash-low"), 90 * 1000);
  assert.strictEqual(imageTimeoutFor("gemini-4-argon-low"), 150 * 1000);
});

const timetableJson = JSON.stringify({ events: [{ title: "Calculus", weekday: "Sunday", start: "10:00", end: "11:30" }], repeat: "weekly", until: "2027-01-31", skipped: [] });
const deps = (over) => ({ lowPools: async () => [], refreshQuota: () => {}, prewarmAnswer: () => {}, speculate: null, addCalendarCard: (p) => ({ id: "a".repeat(32), events: p.events, skipped: [], unclear: [] }), ...over });

