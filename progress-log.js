// progress-log.js
// Omri's study day, written by CODE while it happens: one line per real study event (a graded quiz, a lesson, a note in Omri's own
// words, a new position, an assignment, an exam date, a cancelled class). The morning brief reads yesterday's lines and hands them to
// the "about you" writer (brief-me.js), which may only cite them.
//
// Rules: nothing here is written by a model. A quiz line only REPORTS what study-tracker.js recordCheck decided, so "understood" is
// true only after a real graded check (3+ questions, 70%+). Day files data/study/progress/YYYY-MM-DD.jsonl, kept KEEP_DAYS days.

const fs = require("node:fs");
const path = require("node:path");
const plan = require("./study-plan");

const KEEP_DAYS = 30;
const MAX_TEXT = 300;
const KINDS = new Set(["quiz", "lesson", "note", "position", "assignment", "exam", "cancelled"]);
const DAY_FILE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;
const clean = (s, n) => String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n);

function createProgressLog({ dir, now = () => Date.now(), timezone = plan.TIMEZONE, keepDays = KEEP_DAYS } = {}) {
  if (!dir) throw new Error("createProgressLog needs a folder");
  const dayOf = (ms) => plan.parts(ms, timezone).date;
  let prunedOn = "";

  function prune() {
    const today = dayOf(now());
    if (prunedOn === today) return;
    prunedOn = today;
    const oldest = plan.addDays(today, -keepDays);
    for (const name of fs.readdirSync(dir)) {
      const m = DAY_FILE.exec(name);
      if (m && m[1] < oldest) { try { fs.unlinkSync(path.join(dir, name)); } catch (error) { /* try again tomorrow */ } }
    }
  }

  // kind: one of KINDS. course: the course name. text: a sentence written by code. understood: only from recordCheck.
  function add({ kind, course = "", text, understood = false }) {
    if (!KINDS.has(kind)) throw new Error("unknown progress kind");
    const line = { at: now(), kind, course: clean(course, 100), text: clean(text, MAX_TEXT), understood: understood === true };
    if (!line.text) throw new Error("a progress line needs text");
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, dayOf(line.at) + ".jsonl"), JSON.stringify(line) + "\n");
    prune();
    return line;
  }

  // The lines of one day (oldest first). A broken line is skipped.
  function day(date) {
    if (!plan.isIsoDate(date)) return [];
    let raw = "";
    try { raw = fs.readFileSync(path.join(dir, date + ".jsonl"), "utf8"); } catch (error) { return []; }
    const out = [];
    for (const text of raw.split("\n")) {
      if (!text.trim()) continue;
      try {
        const l = JSON.parse(text);
        if (KINDS.has(l.kind) && typeof l.text === "string") out.push({ at: Number(l.at) || 0, kind: l.kind, course: clean(l.course, 100), text: clean(l.text, MAX_TEXT), understood: l.understood === true && l.kind === "quiz" });
      } catch (error) { /* skip */ }
    }
    return out;
  }

  return { add, day, dayOf };
}

module.exports = { createProgressLog, KINDS, KEEP_DAYS };
