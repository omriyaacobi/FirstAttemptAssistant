// study-page.js
// The data for the Study page (GET /api/study): for each course, where Omri SHOULD be (by the timetable), where they SAY they are,
// what is due, and any question Bot has for them. Pure reading of the tracker (study-tracker.js): it writes nothing and calls no model.
//
//   { today, courses: [ { id, name, tracked,
//       shouldBe:  { held, lastLecture: {n, date} | null, nextLecture: {n, date} | null },
//       you:       { positionKnown, position: {seenThrough, note} | null, withMaterial, understood },
//       behind:    [ {n, date, hasMaterial, topic} ... up to 8 ],
//       due:       [ {title, due, status, daysLeft} ]      assignments with a date, soonest first, not done
//       assignments: [ {title, due|null, status} ]         all open ones
//       questions: [ "plain English question Bot has", ... ] } ],
//     proposal: the Confirm card waiting (or null) }

const plan = require("./study-plan");

const nice = (date) => plan.niceDate(date);

function studyOverview({ coach, courseList, now = Date.now() }) {
  const tracker = coach.tracker;
  const today = tracker.today ? tracker.today() : plan.parts(now).date;
  const out = [];
  for (const ref of tracker.refsFor(courseList)) {
    const slots = tracker.slots(ref.key);
    if (!slots.length) { out.push({ id: ref.courseId, name: ref.name, tracked: false, shouldBe: null, you: null, behind: [], due: [], assignments: [], questions: [] }); continue; }
    const p = tracker.progress(ref);
    const held = slots.filter((s) => plan.isHeld(s, now));
    const last = held[held.length - 1] || null;
    const next = slots.find((s) => !plan.isHeld(s, now)) || null;
    const open = p.assignments.map((a) => ({ title: a.title, due: a.due || null, status: a.status }));
    const due = p.assignments.filter((a) => a.due).map((a) => ({ title: a.title, due: a.due, status: a.status, daysLeft: plan.daysBetween(today, a.due) }));
    const questions = [];
    if (!p.positionKnown) questions.push(`Where are you in ${ref.name}? Tell me the last lecture you went through (a date, a number or a topic). I will not guess.`);
    for (const s of tracker.slotsToAskAbout(ref).slice(0, 2)) questions.push(`${ref.name} lecture ${s.n} (${nice(s.date)}) has no material in Bot. Send the slides, or tell me its topic, or tell me if the class was cancelled.`);
    out.push({
      id: ref.courseId, name: ref.name, tracked: true,
      shouldBe: { held: p.held, lastLecture: last ? { n: last.n, date: last.date } : null, nextLecture: next ? { n: next.n, date: next.date } : null },
      you: { positionKnown: p.positionKnown, position: p.positionKnown ? { seenThrough: p.position.seenThrough || null, note: p.position.note || "" } : null, withMaterial: p.withMaterial, understood: p.understood },
      behind: p.behind.slice(0, 8), due, assignments: open, questions,
    });
  }
  return { today, courses: out, proposal: coach.pendingProposal() };
}

module.exports = { studyOverview };
