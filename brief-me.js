// brief-me.js
// The "You" part of the morning brief: what Omri did yesterday, what is still to do, what is behind (Omri's choice, 2026-11-13).
//
//   1. CODE builds a numbered LEDGER from real records only: yesterday's progress log (progress-log.js: graded quizzes, lessons,
//      Omri's own notes, positions, assignments), assignments due soon, review topics due, a confirmed exam soon, and lectures
//      that were held and not checked yet (study-tracker.js progress().behind; nothing for a course in "revising" or "paused" mode,
//      nothing at all while the study reminders are paused for reserve duty).
//   2. Flash high (then Flash medium; never Argon, never Claude) writes at most MAX_LINES short lines from the ledger. Every line
//      must cite ledger numbers.
//   3. CODE checks every line: it must cite real numbers; every number written in it (a score, a count, a date) must appear in the
//      items it cites; "understood / passed / mastered" only when a cited item is a passed graded quiz. A line that fails is dropped.
//      If the model fails or nothing survives, code writes the ledger itself. The model can never add progress that is not recorded.

const plan = require("./study-plan");
const { extractJson } = require("./calendar-add");
const { MODELS } = require("./router");

const CHAIN = [MODELS.flashHigh, MODELS.flashMedium];
const MAX_LINES = 5;
const MAX_LINE = 180;
const DUE_DAYS = 7;
const EXAM_DAYS = 14;
const UNDERSTOOD_WORDS = /understood|understand|passed|mastered|nailed|got it|knows? it|solid/i;

const clean = (s, n) => String(s == null ? "" : s).replace(/[<>\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n);

// The ledger: [{ n, part: "done"|"todo"|"behind"|"said", text, understood }]. All of it from code.
function buildLedger({ log, tracker, courseList, today, paused = false }) {
  const out = [];
  const push = (part, text, understood = false) => out.push({ n: out.length + 1, part, text: clean(text, 300), understood });
  const yesterday = plan.addDays(today, -1);
  for (const l of log.day(yesterday)) push("done", `${l.course ? l.course + ": " : ""}${l.text}`, l.kind === "quiz" && l.understood);
  if (paused) return out; // reserve duty: no "to do" and no "behind"
  for (const ref of tracker.refsFor(courseList)) {
    let p;
    try { p = tracker.progress(ref); } catch (error) { continue; }
    const name = p.name || ref.name;
    for (const a of p.assignments) {
      if (!a.due) continue;
      const d = plan.daysBetween(today, a.due);
      if (d > DUE_DAYS) continue;
      push("todo", `${name}: assignment "${a.title}" ${d < 0 ? `was due ${plan.niceDate(a.due)} and is not marked done` : d === 0 ? "is due today" : `is due ${plan.niceDate(a.due)}, in ${d} day${d === 1 ? "" : "s"}`}${a.status === "started" ? " (started)" : ""}`);
    }
    if (p.topicsDue) push("todo", `${name}: ${p.topicsDue} review topic${p.topicsDue === 1 ? "" : "s"} due today`);
    const pos = p.position || {};
    if (pos.examDate && pos.confirmed && pos.examDate >= today && plan.daysBetween(today, pos.examDate) <= EXAM_DAYS) push("todo", `${name}: exam on ${plan.niceDate(pos.examDate)}, in ${plan.daysBetween(today, pos.examDate)} days`);
    const quietMode = pos.mode === "revising" || pos.mode === "paused";
    if (p.tracked && !quietMode && p.behind.length) push("behind", `${name}: ${p.behind.length} held lecture${p.behind.length === 1 ? "" : "s"} not checked by a graded quiz yet (${p.behind.slice(-3).map((b) => plan.niceDate(b.date)).join(", ")}${p.behind.length > 3 ? ", ..." : ""})`);
    if (pos.said) push("said", `${name}, in Omri's own words: "${clean(pos.said, 200)}"`);
  }
  return out;
}

function prompt(ledger) {
  return [
    "You write the short \"You\" part of Omri's morning brief. Omri is a university student. Below is a numbered LEDGER written by code from real records. It is the ONLY truth: use nothing else.",
    "Write at most 5 short lines in English, talking to Omri as \"you\": first what was done yesterday, then what is still to do, then what is behind. Friendly and plain, no advice lists, no emoji.",
    "Rules: every line ends with the ledger numbers it is based on. Never add a number, score, date or count that is not in those items. Never say something was understood, learned or passed unless a cited item says \"now Understood\". If no item is marked (done), skip that part (code adds its own line about it). Items marked (said) are Omri's own words: use them only to word the other lines kindly.",
    'Reply with ONLY one JSON object: {"lines": [{"text": "...", "refs": [numbers]}]}',
    "LEDGER:",
    ledger.map((l) => `[${l.n}] (${l.part}) ${l.text}`).join("\n"),
  ].join("\n");
}

// Checks the model's lines against the ledger. Returns the lines that pass (strings).
function checkLines(raw, ledger) {
  const out = [];
  const lines = raw && Array.isArray(raw.lines) ? raw.lines : [];
  for (const line of lines) {
    if (out.length >= MAX_LINES) break;
    const text = clean(line && line.text, MAX_LINE).replace(/\s*\[[\d,\s]*\]\s*$/, "");
    const refs = [...new Set((Array.isArray(line && line.refs) ? line.refs : []).map(Number))];
    if (text.length < 4 || !refs.length || !refs.every((n) => Number.isInteger(n) && n >= 1 && n <= ledger.length)) continue;
    const cited = refs.map((n) => ledger[n - 1]);
    const source = cited.map((l) => l.text).join(" ");
    if ((text.match(/\d+/g) || []).some((num) => !new RegExp(`(?<!\\d)${num}(?!\\d)`).test(source))) continue; // an invented number
    if (UNDERSTOOD_WORDS.test(text) && !cited.some((l) => l.understood)) continue; // "understood" only from a passed graded quiz
    out.push(text);
  }
  return out;
}

// The ledger as plain lines, when no model line can be used.
function plainLines(ledger) {
  const part = (p, head) => { const xs = ledger.filter((l) => l.part === p); return xs.length ? [`${head}: ${xs.slice(0, 3).map((l) => l.text).join("; ")}${xs.length > 3 ? `; and ${xs.length - 3} more` : ""}`] : []; };
  return [...part("done", "Yesterday"), ...part("todo", "To do"), ...part("behind", "Behind")];
}

// The block for morning.js, or null when there is nothing to say. Never throws.
async function aboutMeBlock({ log, tracker, courseList, today, paused = false, askChain, askOne = null, logLine = () => {} }) {
  let ledger;
  try { ledger = buildLedger({ log, tracker, courseList, today, paused }); } catch (error) { logLine(`[brief] ledger failed: ${error.message}`); return null; }
  if (!ledger.some((l) => l.part !== "said")) return paused ? { text: "You\n  Study reminders are paused." } : null;
  let lines = [];
  try {
    const { answer, used } = await askChain(CHAIN, prompt(ledger), askOne ? { askOne } : {});
    lines = checkLines(extractJson(answer), ledger);
    logLine(`[brief] "You" part by ${used ? used.model : "?"}: ${lines.length} line(s) kept from a ledger of ${ledger.length}`);
  } catch (error) {
    logLine(`[brief] "You" part model failed: ${String(error.message).slice(0, 160)}`);
  }
  if (!lines.length) lines = plainLines(ledger);
  if (!ledger.some((l) => l.part === "done")) lines.unshift("Yesterday: nothing was recorded with Bot.");
  return { text: `You\n${lines.map((l) => `  ${l}`).join("\n")}` };
}

module.exports = { aboutMeBlock, buildLedger, checkLines, plainLines, prompt, CHAIN, MAX_LINES };
