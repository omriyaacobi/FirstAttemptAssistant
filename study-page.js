// study-page.js
// The data for the Study page (GET /api/study): for each course, where Omri SHOULD be (by the timetable), where they SAY they are,
// what is due, and any question Bot has for them. Pure reading of the tracker (study-tracker.js): it writes nothing and calls no model.
//
//   { today, courses: [ { id, name, tracked,
//       shouldBe:  { held, lastLecture: {n, date} | null, nextLecture: {n, date} | null },
//       you:       { positionKnown, position: {seenThrough, note} | null, withMaterial, understood },
//       keepingUp: { state: "unknown"|"topic"|"on_track"|"behind"|"ahead", n }   the answer to "am I keeping up?"
//       behind:    [ {n, date, hasMaterial, topic} ... up to 8 ],
//       due:       [ {title, due, status, daysLeft} ]      assignments with a date, soonest first, not done
//       assignments: [ {title, due|null, status} ]         all open ones
//       questions: [ "plain English question Bot has", ... ] } ],
//     proposal: the Confirm card waiting (or null) }

const plan = require("./study-plan");
const standing = require("./standing");
const { GRACE_DAYS } = require("./study-tracker");

const nice = (date) => plan.niceDate(date, "he" === curLang ? "he" : "en");
let curLang = "en";

// "Am I keeping up?" in one word, from the timetable and the place the student SAID they are at (never guessed):
//   unknown   the place was never told          topic   told as a topic only (no date), so it cannot be counted
//   on_track  nothing held since that place     behind  n lectures held after it (the last GRACE_DAYS days do not count)
//   ahead     the place is past the last held lecture: n lectures ahead
function keepingUp({ slots, positionKnown, seenThrough, today, now }) {
  if (!positionKnown) return { state: "unknown", n: 0 };
  if (!seenThrough) return { state: "topic", n: 0 };
  const held = slots.filter((s) => plan.isHeld(s, now));
  const behind = held.filter((s) => s.date > seenThrough && plan.daysBetween(s.date, today) > GRACE_DAYS).length;
  if (behind > 0) return { state: "behind", n: behind };
  const ahead = slots.filter((s) => !plan.isHeld(s, now) && s.date <= seenThrough).length;
  return ahead > 0 ? { state: "ahead", n: ahead } : { state: "on_track", n: 0 };
}

// The student's own reading (position v2) in one code-written line, for the page's "you are" cell. Empty object when there is none.
function youAreOf(p, he) {
  const line = p.positionKnown ? standing.standingLine(p.position, he ? "he" : "en") : "";
  if (!line) return {};
  const done = p.understood ? (he ? (p.understood === 1 ? "הרצאה אחת נבדקה והובנה" : `${p.understood} הרצאות נבדקו והובנו`) : `${p.understood} lecture${p.understood === 1 ? "" : "s"} checked as understood`) : "";
  return { youAre: line + (done ? `. ${done}` : ""), yourWords: p.position.said || "" };
}

function studyOverview({ coach, courseList, now = Date.now(), lang = "en" }) {
  const he = lang === "he";
  const tracker = coach.tracker;
  curLang = lang;
  const today = tracker.today ? tracker.today() : plan.parts(now).date;
  const out = [];
  for (const ref of tracker.refsFor(courseList)) {
    const slots = tracker.slots(ref.key);
    const p = tracker.progress(ref);
    if (!slots.length) { // no timetable: no counts, but a saved position and saved assignments still show
      const open = p.assignments.map((a) => ({ title: a.title, due: a.due || null, status: a.status }));
      const due = p.assignments.filter((a) => a.due).map((a) => ({ title: a.title, due: a.due, status: a.status, daysLeft: plan.daysBetween(today, a.due) }));
      out.push({ id: ref.courseId, name: ref.name, tracked: false, shouldBe: null, you: p.positionKnown ? { positionKnown: true, position: { seenThrough: null, note: p.position.note || "", said: p.position.said || "" }, withMaterial: 0, understood: 0 } : null, behind: [], due, assignments: open, questions: [], ...youAreOf(p, he) });
      continue;
    }
    const held = slots.filter((s) => plan.isHeld(s, now));
    const last = held[held.length - 1] || null;
    const next = slots.find((s) => !plan.isHeld(s, now)) || null;
    const open = p.assignments.map((a) => ({ title: a.title, due: a.due || null, status: a.status }));
    const due = p.assignments.filter((a) => a.due).map((a) => ({ title: a.title, due: a.due, status: a.status, daysLeft: plan.daysBetween(today, a.due) }));
    const questions = [];
    if (!p.positionKnown) questions.push(he ? `איפה אתה בקורס ${ref.name}? ספר לי מה ההרצאה האחרונה שעברת (תאריך, מספר או נושא). אני לא מנחש.` : `Where are you in ${ref.name}? Tell me the last lecture you went through (a date, a number or a topic). I will not guess.`);
    for (const s of tracker.slotsToAskAbout(ref).slice(0, 2)) questions.push(he ? `להרצאה ${s.n} של ${ref.name} (${nice(s.date)}) אין חומר ב-Bot. שלח את השקפים, או ספר לי מה הנושא, או ספר לי אם ההרצאה בוטלה.` : `${ref.name} lecture ${s.n} (${nice(s.date)}) has no material in Bot. Send the slides, or tell me its topic, or tell me if the class was cancelled.`);
    out.push({
      id: ref.courseId, name: ref.name, tracked: true,
      shouldBe: { held: p.held, lastLecture: last ? { n: last.n, date: last.date } : null, nextLecture: next ? { n: next.n, date: next.date } : null },
      you: { positionKnown: p.positionKnown, position: p.positionKnown ? { seenThrough: p.position.seenThrough || null, note: p.position.note || "" } : null, withMaterial: p.withMaterial, understood: p.understood },
      keepingUp: keepingUp({ slots, positionKnown: p.positionKnown, seenThrough: p.positionKnown ? p.position.seenThrough || null : null, today, now }),
      behind: p.behind.slice(0, 8), due, assignments: open, questions, ...youAreOf(p, he),
    });
  }
  return { today, courses: out, proposal: coach.pendingProposal() };
}

module.exports = { studyOverview, keepingUp };
