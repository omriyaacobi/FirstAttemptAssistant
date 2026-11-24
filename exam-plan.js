// exam-plan.js
// A STUDY PLAN TOWARD ONE EXAM (2026-11-24, Omri: "a plan Bot can follow through the week and keep me on track").
// The brain PROPOSES a plan (exam_plan: days, and a few short items per day); code checks every value here; Omri confirms it on a
// card (study-coach.js confirmProposal). Only then is it stored, in data/study/exam-plans.json, one plan per course (a newer
// confirmed plan replaces the older one, which is kept as "previous").
// Until the exam day the brain sees the plan with EVERY message (contextText), so it can keep Omri on track; after the exam day the
// plan is not shown any more (it stays on disk). An item is ticked only by the brain's plan_done (from Omri's own words; checked ids,
// with undo). "Done" here means "Omri says he did it", never "understood" (that is only ever set by a graded quiz).
// The morning brief gets one line about today's part of the plan (morningLine).

const fs = require("node:fs");
const path = require("node:path");
const plan = require("./study-plan");
const { clean } = require("./study-tracker");

// The limits, one named constant each.
const MAX_DAYS_AHEAD = 120; // an exam more than about 4 months away is not planned day by day
const MAX_DAYS = 40; // days with items in one plan
const MAX_PER_DAY = 8; // items on one day
const MAX_ITEMS = 80; // items in the whole plan
const ITEM_CHARS = 240; // one item's text
const MIN_ITEM_CHARS = 3;
const TITLE_CHARS = 80;
const LEAVE_OUT = 10; // topics Omri said are NOT in the exam
const LEAVE_OUT_CHARS = 120;
const CONTEXT_CHARS = 3000; // what one plan may take of the brain's prompt
const OVERDUE_SHOWN = 8;

// Checks a proposed plan. examDate: "YYYY-MM-DD"; days: [{ date, items: ["text", ...] }]; leaveOut: ["topic", ...].
// Returns { examDate, title, leaveOut, items: [{ id, date, text }] } or throws an Error that says what to fix.
function checkPlan({ examDate, title = "", days, leaveOut = [], today }) {
  if (!plan.isIsoDate(examDate)) throw new Error("exam_date must be a real date (YYYY-MM-DD)");
  if (examDate < today) throw new Error(`the exam date ${examDate} is already past (today is ${today})`);
  if (plan.daysBetween(today, examDate) > MAX_DAYS_AHEAD) throw new Error(`the exam is more than ${MAX_DAYS_AHEAD} days away: plan the next weeks only when it is closer`);
  if (!Array.isArray(days) || !days.length) throw new Error('days must be a list like [{"date":"YYYY-MM-DD","items":["..."]}]');
  const byDate = new Map();
  for (const d of days) {
    const date = d && typeof d === "object" ? d.date : null;
    if (!plan.isIsoDate(date)) throw new Error(`every day needs a real "date" (YYYY-MM-DD); got ${JSON.stringify(date)}`);
    if (date < today || date > examDate) throw new Error(`the day ${date} is not between today (${today}) and the exam (${examDate})`);
    const items = Array.isArray(d.items) ? d.items : [];
    const texts = items.map((t) => clean(t, ITEM_CHARS + 1));
    if (texts.some((t) => t.length > ITEM_CHARS)) throw new Error(`an item of ${date} is longer than ${ITEM_CHARS} characters: keep each item short`);
    const kept = texts.filter((t) => t.length >= MIN_ITEM_CHARS);
    if (!kept.length) throw new Error(`the day ${date} has no items`);
    const all = [...(byDate.get(date) || []), ...kept];
    if (all.length > MAX_PER_DAY) throw new Error(`the day ${date} has more than ${MAX_PER_DAY} items`);
    byDate.set(date, all);
  }
  if (byDate.size > MAX_DAYS) throw new Error(`more than ${MAX_DAYS} days`);
  const items = [];
  for (const date of [...byDate.keys()].sort()) for (const text of byDate.get(date)) items.push({ id: `P${items.length + 1}`, date, text });
  if (items.length > MAX_ITEMS) throw new Error(`more than ${MAX_ITEMS} items in the plan`);
  const out = (Array.isArray(leaveOut) ? leaveOut : [leaveOut]).map((t) => clean(t, LEAVE_OUT_CHARS)).filter(Boolean);
  if (out.length > LEAVE_OUT) throw new Error(`more than ${LEAVE_OUT} topics left out`);
  return { examDate, title: clean(title, TITLE_CHARS), leaveOut: out, items };
}

// The plan as short lines, for the card text and the tool result.
function planLines(p) {
  const lines = [];
  let day = null;
  for (const it of p.items) {
    if (it.date !== day) { day = it.date; lines.push(`${plan.niceDate(day, "en")}:`); }
    lines.push(`  ${it.id} ${it.done ? "[x]" : "[ ]"} ${it.text}`);
  }
  if (p.leaveOut && p.leaveOut.length) lines.push(`Not in the exam: ${p.leaveOut.join("; ")}`);
  return lines.join("\n");
}

function createExamPlans({ file, now = () => Date.now(), timezone = plan.TIMEZONE }) {
  const today = () => plan.parts(now(), timezone).date;
  function read() {
    try { const s = JSON.parse(fs.readFileSync(file, "utf8")); return s && typeof s.plans === "object" && s.plans ? s : { plans: {} }; } catch (error) { return { plans: {} }; }
  }
  function write(state) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = file + ".tmp";
    fs.writeFileSync(temp, JSON.stringify(state, null, 1));
    fs.renameSync(temp, file);
  }
  const has = (state, key) => Object.prototype.hasOwnProperty.call(state.plans, key);

  return {
    // The stored plan of a course, or null.
    get(key) { const s = read(); return has(s, key) ? s.plans[key] : null; },
    // Stores a CHECKED plan (only after Omri's tap). The older plan of the course is kept as "previous" (one level).
    set(ref, checked) {
      const s = read();
      const old = has(s, ref.key) ? s.plans[ref.key] : null;
      if (old) delete old.previous;
      s.plans[ref.key] = { key: ref.key, course: clean(ref.name, 100), ...checked, items: checked.items.map((i) => ({ ...i, done: false, doneAt: null })), confirmedAt: now(), previous: old || null };
      write(s);
      return s.plans[ref.key];
    },
    // Ticks (or with undo: unticks) items by id. Every id is checked against the stored plan.
    mark(ref, ids, { undo = false } = {}) {
      const s = read();
      const p = has(s, ref.key) ? s.plans[ref.key] : null;
      if (!p) throw new Error(`${ref.name} has no exam plan; Omri confirms one first (exam_plan)`);
      const want = [...new Set((Array.isArray(ids) ? ids : [ids]).map((x) => String(x).trim().toUpperCase()))].slice(0, MAX_ITEMS);
      const bad = want.filter((id) => !p.items.some((i) => i.id === id));
      if (!want.length || bad.length) throw new Error(`${bad.length ? `no such item in the ${ref.name} plan: ${bad.join(", ")}. ` : ""}Give ids from the plan: ${p.items.map((i) => i.id).join(", ")}`);
      for (const i of p.items) if (want.includes(i.id)) { i.done = !undo; i.doneAt = undo ? null : now(); }
      write(s);
      const picked = p.items.filter((i) => want.includes(i.id));
      const left = p.items.filter((i) => !i.done).length;
      return `${undo ? "UNTICKED" : "TICKED as done (Omri says he did it; not 'understood')"}: ${picked.map((i) => `${i.id} ${i.text}`).join("; ")}. ${left} of ${p.items.length} items of the ${ref.name} plan are left.`;
    },
    // The plans whose exam is today or later.
    active() { const t = today(); return Object.values(read().plans).filter((p) => p && p.examDate >= t); },
    // For the brain's prompt, every message: each active plan with today's items, earlier items not done, the next days and the
    // topics left out. Plain text written by code (the items are Omri-confirmed).
    contextText() {
      const t = today();
      return this.active().map((p) => {
        const left = plan.daysBetween(t, p.examDate);
        const todays = p.items.filter((i) => i.date === t);
        const overdue = p.items.filter((i) => i.date < t && !i.done);
        const later = p.items.filter((i) => i.date > t);
        const nextDays = [...new Set(later.map((i) => i.date))].slice(0, 3).map((d) => `${plan.niceDate(d, "en")}: ${later.filter((i) => i.date === d).map((i) => `${i.id} ${i.done ? "[x]" : "[ ]"} ${i.text}`).join("; ")}`);
        const done = p.items.filter((i) => i.done).length;
        const lines = [
          `${p.course}${p.title ? ` (${p.title})` : ""}: the exam is on ${plan.niceDate(p.examDate, "en")} (${left === 0 ? "TODAY" : left === 1 ? "tomorrow" : `in ${left} days`}). Done ${done} of ${p.items.length} items.`,
          todays.length ? `Today: ${todays.map((i) => `${i.id} ${i.done ? "[x]" : "[ ]"} ${i.text}`).join("; ")}` : "Today: nothing planned.",
          overdue.length ? `Earlier and NOT done: ${overdue.slice(0, OVERDUE_SHOWN).map((i) => `${i.id} ${i.text}`).join("; ")}${overdue.length > OVERDUE_SHOWN ? ` (+${overdue.length - OVERDUE_SHOWN} more)` : ""}` : "",
          nextDays.length ? `Next days: ${nextDays.join(" | ")}` : "",
          p.leaveOut && p.leaveOut.length ? `NOT in the exam (Omri said): ${p.leaveOut.join("; ")}` : "",
        ].filter(Boolean);
        return lines.join("\n").slice(0, CONTEXT_CHARS);
      }).join("\n\n");
    },
    // One line per active plan for the morning brief, or "" (no item names: only the course, the count and the first item of today).
    morningLine() {
      const t = today();
      return this.active().map((p) => {
        const left = plan.daysBetween(t, p.examDate);
        const todays = p.items.filter((i) => i.date === t && !i.done);
        const overdue = p.items.filter((i) => i.date < t && !i.done).length;
        const when = left === 0 ? "today" : left === 1 ? "tomorrow" : `in ${left} days`;
        return `${p.course} exam ${when}: ${todays.length ? `${todays.length} item${todays.length > 1 ? "s" : ""} for today, starting with "${todays[0].text}"` : "nothing new planned for today"}${overdue ? `; ${overdue} earlier item${overdue > 1 ? "s" : ""} not done yet` : ""}.`;
      }).join("\n");
    },
  };
}

module.exports = { checkPlan, planLines, createExamPlans, MAX_DAYS, MAX_PER_DAY, MAX_ITEMS, ITEM_CHARS, MAX_DAYS_AHEAD };
