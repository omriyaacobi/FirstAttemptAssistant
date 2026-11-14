// brief-me.js
// The "You" part of the morning brief: what Omri did yesterday, what is still to do, what is behind (Omri's choice, 2026-11-13).
//
//   1. CODE builds a numbered LEDGER from real records only: yesterday's progress log (progress-log.js: graded quizzes, lessons,
//      Omri's own notes, positions, assignments), assignments due soon, review topics due, a confirmed exam soon, and lectures
//      that were held and not checked yet (study-tracker.js progress().behind; nothing for a course in "revising" or "paused" mode,
//      nothing at all while the study reminders are paused for reserve duty).
//   2. Flash high (then Flash medium; never Argon, never Claude) writes at most MAX_LINES short lines from the ledger. Every line
//      must cite ledger numbers.
//   3. CODE checks every line, lightly (Omri, 2026-11-14: "no very strict rules"): it must cite real ledger numbers, and
//      "understood / passed / mastered" only when a cited item is a passed graded quiz. A line that fails is dropped (the reason
//      is logged). If the model fails or nothing survives, code writes the ledger itself.
//   Since 2026-11-14 the ledger also holds the day's "done" notes from the end-of-day review (thread-summary.js, Flash high):
//   what Omri worked on in the talk, each pointing at a real message. So a day of real work is never "nothing was recorded".

const plan = require("./study-plan");
const { extractJson } = require("./calendar-add");
const { MODELS } = require("./router");

const CHAIN = [MODELS.flashHigh, MODELS.flashMedium];
const MAX_LINES = 5;
const MAX_LINE = 180;
const DUE_DAYS = 7;
const EXAM_DAYS = 14;
const UNDERSTOOD_WORDS = /understood|understand|mastered|nailed|knows? it|passed (?:the |a |your )?(?:graded )?(?:quiz|check)/i; // "passed the Stage B tests" (code) is fine

const clean = (s, n) => String(s == null ? "" : s).replace(/[<>\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n);

// The ledger: [{ n, part: "done"|"todo"|"behind"|"said", text, understood }]. All of it from code.
// dayNotes: yesterday's "done" notes from the end-of-day review ([{ text }]), written by a model from the talk: notes, never "understood".
function buildLedger({ log, tracker, courseList, today, paused = false, dayNotes = [] }) {
  const out = [];
  const push = (part, text, understood = false) => out.push({ n: out.length + 1, part, text: clean(text, 300), understood });
  const yesterday = plan.addDays(today, -1);
  for (const d of dayNotes) if (d && d.text) push("done", `In the talk: ${d.text}`);
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
    if (p.tracked && !quietMode && p.behind.length) push("behind", `${name}: ${p.behind.length} lecture${p.behind.length === 1 ? "" : "s"} not checked by a quiz yet`);
    if (pos.said) push("said", `${name}, in Omri's own words: "${clean(pos.said, 200)}"`);
  }
  return out;
}

function prompt(ledger) {
  return [
    "You write the short \"You\" part of Omri's morning brief. Omri is a university student. Below is a numbered LEDGER written by code from real records. It is the ONLY truth: use nothing else.",
    "Write at most 5 short lines in English, talking to Omri as \"you\": first what was done yesterday (the most important things, merged where they belong together), then what is still to do, then, in ONE short line, what is behind. Friendly and plain, no advice lists, no emoji.",
    "Rules: every line cites the ledger numbers it is based on in \"refs\". Never invent progress, scores or dates. Never say something was understood, learned or passed unless a cited item says \"now Understood\". If no item is marked (done), skip that part (code adds its own line about it). Items marked (said) are Omri's own words: use them only to word the other lines kindly.",
    'Reply with ONLY one JSON object: {"lines": [{"text": "...", "refs": [numbers]}]}',
    "LEDGER:",
    ledger.map((l) => `[${l.n}] (${l.part}) ${l.text}`).join("\n"),
  ].join("\n");
}

// Checks the model's lines against the ledger. Returns the lines that pass (strings); why: a list of reasons for the dropped ones.
// Refs may also be written at the end of the text ("... [2, 3]"). Unknown numbers in refs are ignored if at least one is real.
function checkLines(raw, ledger, why = []) {
  const out = [];
  const lines = raw && Array.isArray(raw.lines) ? raw.lines : [];
  for (const line of lines) {
    if (out.length >= MAX_LINES) break;
    const rawText = clean(line && line.text, MAX_LINE * 2);
    const tail = /\s*\[([\d,\s]+)\]\s*$/.exec(rawText);
    const text = clean(rawText.replace(/\s*\[[\d,\s]*\]\s*$/, ""), MAX_LINE);
    const given = [...(Array.isArray(line && line.refs) ? line.refs : []), ...(tail ? tail[1].split(",") : [])].map(Number);
    const refs = [...new Set(given)].filter((n) => Number.isInteger(n) && n >= 1 && n <= ledger.length);
    if (text.length < 4) { why.push("empty"); continue; }
    if (!refs.length) { why.push("no real ledger number"); continue; }
    const cited = refs.map((n) => ledger[n - 1]);
    if (UNDERSTOOD_WORDS.test(text) && !cited.some((l) => l.understood)) { why.push("understood without a passed quiz"); continue; }
    out.push(text);
  }
  return out;
}

// The ledger as plain lines, when no model line can be used.
function plainLines(ledger) {
  const part = (p, head) => { const xs = ledger.filter((l) => l.part === p); return xs.length ? [`${head}: ${xs.slice(0, 3).map((l) => l.text.replace(/^In the talk: /, "")).join("; ")}${xs.length > 3 ? `; and ${xs.length - 3} more` : ""}`] : []; };
  return [...part("done", "Yesterday"), ...part("todo", "To do"), ...part("behind", "Behind")];
}

// The block for morning.js, or null when there is nothing to say. Never throws.
async function aboutMeBlock({ log, tracker, courseList, today, paused = false, dayNotes = [], askChain, askOne = null, logLine = () => {} }) {
  let ledger;
  try { ledger = buildLedger({ log, tracker, courseList, today, paused, dayNotes }); } catch (error) { logLine(`[brief] ledger failed: ${error.message}`); return null; }
  if (!ledger.some((l) => l.part !== "said")) return paused ? { text: "You\n  Study reminders are paused." } : null;
  let lines = [];
  try {
    const { answer, used } = await askChain(CHAIN, prompt(ledger), askOne ? { askOne } : {});
    const why = [];
    lines = checkLines(extractJson(answer), ledger, why);
    logLine(`[brief] "You" part by ${used ? used.model : "?"}: ${lines.length} line(s) kept from a ledger of ${ledger.length}${why.length ? `; dropped: ${why.join(", ")}` : ""}`);
  } catch (error) {
    logLine(`[brief] "You" part model failed: ${String(error.message).slice(0, 160)}`);
  }
  if (!lines.length) lines = plainLines(ledger);
  if (!ledger.some((l) => l.part === "done")) lines.unshift("Yesterday: nothing was recorded with Bot.");
  return { text: `You\n${lines.map((l) => `  ${l}`).join("\n")}` };
}

module.exports = { aboutMeBlock, buildLedger, checkLines, plainLines, prompt, CHAIN, MAX_LINES };
