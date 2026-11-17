// tests/tutoring-flow.test.js
// A STUDENT GOES THROUGH A WHOLE CATCH-UP OF ONE LECTURE (2026-11-17), the way Omri did on 2026-11-16 with lecture 4 of Calculus 2:
// teach me the next part -> the check question -> a wrong answer -> "I don't get it" -> an answer sent as a photo with words ->
// "in Hebrew please" -> "we already did this" -> "what is left of this lecture" -> "I have 10 minutes, finish the lecture".
// The brain and the tutor are FAKE models with scripted replies; the coach, the tracker, the outline and the parts record are real.
// What is checked is everything CODE does in such an evening: what the models are given, what is stored, what is refused.
// The notebook is made up (same shape as the real one: dated lecture lines, topic words per page).

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const lp = require("../lecture-parts");
const { createStudyCoach } = require("../study-coach");
const { createBrain } = require("../brain");
const { workDone } = require("../course-work");

const T0 = new Date("2026-11-16T15:00:00+02:00").getTime(); // a Monday afternoon
const clock = { now: T0 };
const body = (w, n = 14) => Array.from({ length: n }, (_, i) => `Made-up ${w} line ${i} of the lecture text.`).join("\n");
const page = (n, keywords, text) => ({ fileId: "nb", fileName: "notebook.pdf", page: n, keywords, text });
// lecture N starts on page 2N-1; lecture 4 = pages 7-8 with five parts
const TOPICS = { 7: "אינטגרציה בחלקים, integration by parts, אינטגרציה מעגלית, cyclic integration, נוסחת וואליס, Wallis formula", 8: "שינוי משתנה, substitution, החלפת גבולות, changing the limits" };
const NOTEBOOK = Array.from({ length: 40 }, (_, i) => page(i + 1, TOPICS[i + 1] || `נושא ${i + 1}, topic ${i + 1}, עוד נושא ${i + 1}, more ${i + 1}`, (i % 2 === 0 ? `0${(i % 9) + 1}/11/26 חדו״א 2 הרצאה ${i / 2 + 1}\n` : "") + body(`lecture${Math.floor(i / 2) + 1}`)));
const CALC = { id: "c".repeat(16), name: "Calculus 2" };

function world(brainReplies, photoReplies = []) {
  clock.now = T0;
  const tutor = [];
  const askChain = async (chain, prompt) => {
    tutor.push(prompt);
    let answer = "?";
    if (/Teach the topic/.test(prompt)) answer = "Step one [S1]. Step two. Step three.\nQUESTION: Which part do you differentiate in the integral of x times e^x? || KEY: You differentiate x, because its derivative is 1.";
    else if (/Grade ONE answer/.test(prompt)) answer = JSON.stringify({ relevant: true, verdict: "wrong", feedback: "You picked the part that gets harder.", note: "choice of u" });
    else if (/needs a hint at level/.test(prompt)) answer = "Think about which factor becomes simpler when you differentiate it.";
    return { answer, used: { model: chain[0].model } };
  };
  const courses = { list: () => [CALC], allPages: (id) => (id === CALC.id ? NOTEBOOK : []) };
  const coach = createStudyCoach({ dir: fs.mkdtempSync(path.join(os.tmpdir(), "bot-flow-")), courses, askChain, now: () => clock.now });
  const prompts = [], photoPrompts = [], thread = [];
  let i = 0, j = 0;
  const brain = createBrain({
    courses, coach,
    courseRoutes: { list: () => [CALC], courseFiles: () => ({ files: [{ id: "nb", name: "notebook.pdf", status: "ready", pages: 40 }] }), linkFiles: () => [] },
    reminders: { list: () => [] }, memory: { list: () => [] }, cards: { add: () => ({}) }, readCalendar: async () => ({ text: "" }),
    fetchPage: async () => ({ title: "t", text: "x" }),
    askOne: async (p, m, prompt) => { prompts.push(prompt); const r = brainReplies[i++]; if (r === undefined) throw new Error("no more scripted replies"); return r; },
    askImage: async (model, prompt) => { photoPrompts.push(prompt); const r = photoReplies[j++]; if (r === undefined) throw new Error("no more scripted photo replies"); return r; },
    photoChain: [{ provider: "agy", model: "photo-a" }],
    courseWork: (courseId) => workDone(thread, courseId, { now: clock.now, timeZone: "Asia/Jerusalem" }),
    chain: [{ provider: "agy", model: "fake" }], poolLevels: async () => [], refreshPools: () => {}, notePoolFailure: () => {},
    now: () => clock.now,
  });
  const ref = () => coach.tracker.refsFor([CALC]).find((r) => r.courseId === CALC.id);
  // one message of the evening: 5 minutes later, with the talk so far as history, and Bot's answer kept in the thread
  const say = async (task, opts = {}) => {
    clock.now += 5 * 60 * 1000;
    const history = thread.slice(-8).map((m) => ({ role: m.role, text: m.text, at: m.at, ...(m.result ? { courseId: m.result.courseId } : {}) }));
    thread.push({ role: "user", at: clock.now, text: task || "(photo attached)" });
    const r = await brain.handle(task, { history, courses: [CALC], ...opts });
    thread.push({ role: "assistant", at: clock.now + 1000, text: r.answer, result: { courseId: CALC.id } });
    return r;
  };
  const marks = () => (lp.worked(coach.tracker.course(ref()))["4"] || []).map((m) => m.topic);
  return { coach, prompts, photoPrompts, tutor, say, ref, marks };
}

test("a whole catch-up evening on one lecture: every step gets the right facts from code, and only real things are stored", async () => {
  const w = world([
    /* 1 */ 'CALL {"tool":"teach_next","course":"Calculus 2","part":""}',
    /* 2 */ 'CALL {"tool":"quiz_answer","course":"Calculus 2","ask":"answer"}',
    /* 3 */ 'CALL {"tool":"quiz_answer","course":"Calculus 2","ask":"hint"}',
    /* 5 */ "בטח, ממשיכים בעברית.",
    /* 6 */ 'CALL {"tool":"parts_done","course":"Calculus 2","lecture":4,"parts":["4.4"]}\nצודק, עשינו. ממשיכים להחלפת גבולות:\n$$\\int_1^e \\frac{\\ln x}{x}\\,dx$$',
    /* 7 */ "נשאר רק החלק של החלפת גבולות.",
    /* 8 */ 'CALL {"tool":"teach_next","course":"Calculus 2","part":""}',
    /* 9 */ 'CALL {"tool":"teach_next","course":"Calculus 2","part":""}',
  ], [
    /* 4: the photo model marks a part (allowed with a photo since 2026-11-17) and answers in the same message */
    'CALL {"tool":"parts_done","course":"Calculus 2","lecture":4,"parts":["4.4"]}\nRight: $x e^x - e^x + C$. Now try this one:\n$$\\int \\sin^2(x)\\,dx$$',
  ]);
  // Omri told Bot earlier: lectures 1-3 are done (the brain's study_position; here the checked tool is called directly)
  w.coach.brainTools.position({ courseId: CALC.id, fields: { mode: "selfStudy", where: { type: "lecture", n: 3 } }, said: "finished lectures 1-3, moving to lecture 4" });

  // 1. teach me the next part: the lesson is lecture 4, and only its first three parts
  const r1 = await w.say("teach me the next part of calculus 2");
  assert.match(w.prompts[0], /Lecture 4 \(pages 7-8 of the notes\): 0 of 5 parts worked on/, "the brain sees the parts of the lecture Omri is on");
  const lesson = w.tutor.find((p) => /Teach the topic/.test(p));
  assert.match(lesson, /Teach ONLY these parts of the lecture now: אינטגרציה בחלקים; אינטגרציה מעגלית; נוסחת וואליס\./);
  assert.match(lesson, /These wait for the next lesson, do not teach them yet: שינוי משתנה; החלפת גבולות\./);
  assert.match(lesson, /Made-up lecture4 line/, "the lesson is given the pages of lecture 4");
  assert.ok(!/Made-up lecture5 line 3/.test(lesson) || /lecture4/.test(lesson));
  assert.match(r1.answer, /Step one/);
  assert.match(r1.answer, /Which part do you differentiate/, "it ends with the check question");
  assert.ok(!/KEY:|its derivative is 1/.test(r1.answer), "the answer key is never shown");
  assert.deepStrictEqual(w.marks(), ["אינטגרציה בחלקים", "אינטגרציה מעגלית", "נוסחת וואליס"], "what was taught is marked as worked on");

  // 2. a wrong answer: graded by the tutor against the key, with a hint; nothing is 'understood'
  const r2 = await w.say("you differentiate e^x");
  assert.match(w.prompts[1], /A QUIZ QUESTION IS OPEN in this course: "Which part do you differentiate/);
  assert.match(r2.answer, /^Not yet\. You picked the part that gets harder\.\nHint 1 of 3: Think about which factor/);
  assert.ok(!/its derivative is 1/.test(r2.answer), "a wrong answer does not get the solution");

  // 3. "I don't get it": the brain says it is a request for help; a second hint, still not the answer
  const r3 = await w.say("I don't get it");
  assert.match(r3.answer, /^Hint 2 of 3: /);
  assert.ok(!/its derivative is 1/.test(r3.answer));
  assert.strictEqual(w.coach.tracker.progress(w.ref()).understood, 0);

  // 4. the answer comes as a PHOTO WITH WORDS: the photo is named next to the words, the lecture parts are in the context, and a
  //    mark is allowed with a photo (Omri, 2026-11-17: it only says "practised", checked ids, undo), in the same model call.
  const r4 = await w.say("is this right? I got confused in the second line", { image: { path: "C:/tmp/work.jpg" } });
  const photo = w.photoPrompts[0];
  assert.ok(photo.indexOf('The photo is part of THIS message: open "photo.jpg"') > photo.indexOf("is this right?"), "the photo line is right after the words");
  assert.match(photo, /Lecture 4 \(pages 7-8 of the notes\): 3 of 5 parts worked on/);
  assert.strictEqual(w.photoPrompts.length, 1, "the mark and the reply came in one model call");
  assert.match(r4.answer, /Now try this one/);
  assert.strictEqual(w.marks().length, 4, "the photo message marked its part");

  // 5. "in Hebrew please": the language line asks for Hebrew
  const r5 = await w.say("עברית בבקשה");
  assert.match(w.prompts[3], /This message is in Hebrew: write the reply in Hebrew/);
  assert.strictEqual(r5.answer, "בטח, ממשיכים בעברית.");

  // 6. "we already did this": the brain sees Bot's own formulas of the evening (code-made list) and the marks, marks the part
  //    with its reply in ONE model call, and moves on.
  const before = w.prompts.length;
  const r6 = await w.say("את זה כבר עשינו, שינוי משתנה");
  const p6 = w.prompts[before];
  assert.match(p6, /Already worked on in Calculus 2 \(last 2 days\)/);
  assert.match(p6, /\\int \\sin\^2\(x\)\\,dx/, "the exercise given with the photo answer is in the list");
  assert.strictEqual(w.prompts.length, before + 1, "one model call");
  assert.ok(w.marks().includes("שינוי משתנה"));
  assert.match(r6.answer, /^צודק, עשינו/);

  // 7. "what is left of this lecture": the context names exactly the one part that is left
  await w.say("מה נשאר מההרצאה הזאת?");
  const p7 = w.prompts[w.prompts.length - 1];
  assert.match(p7, /Lecture 4 \(pages 7-8 of the notes\): 4 of 5 parts worked on/);
  assert.match(p7, /4\.5 החלפת גבולות \(page 8\): NOT YET/);
  assert.match(p7, /Left of lecture 4: 4\.5\n/);

  // 8. "I have 10 minutes, finish the lecture": the lesson is ONLY the part that is left, and the done ones are named as done
  await w.say("יש לי 10 דקות, בוא נסיים את ההרצאה");
  const last = w.tutor.filter((p) => /Teach the topic/.test(p)).pop();
  assert.match(last, /Teach ONLY these parts of the lecture now: החלפת גבולות\. The student already worked on these, do not teach them again: אינטגרציה בחלקים; אינטגרציה מעגלית; נוסחת וואליס; שינוי משתנה\./);
  assert.match(last, /Reply in Hebrew|in Hebrew/i, "the lesson is in the language Omri wrote in");
  assert.strictEqual(w.marks().length, 5);

  // 9. asked again when nothing is left: a review, not a first-time lesson; and the evening never set "understood"
  await w.say("תלמד אותי את החלק הבא");
  assert.match(w.tutor.filter((p) => /Teach the topic/.test(p)).pop(), /already worked on every part of this lecture: give a short review/);
  assert.strictEqual(w.coach.tracker.progress(w.ref()).understood, 0, '"worked on" and "taught" never become "understood"');
});

test("a teaching cursor that is no longer in the notes does not restart the course from its first part", () => {
  const catchup = require("../catchup");
  const chunks = ["a#1", "b#1", "c#1", "d#1"].map((key) => ({ key, title: key.split("#")[0] }));
  // the real case (Systems Programming, 2026-11-17): the cursor named a heading the outline no longer has
  assert.strictEqual(catchup.nextChunk(chunks, { taught: ["a#1", "b#1", "gone#1"], cursor: "gone#1" }).key, "c#1", "it goes on after the last taught part that still exists");
  assert.strictEqual(catchup.nextChunk(chunks, { taught: ["gone#1"], cursor: "gone#1" }).key, "a#1", "nothing taught still exists: the first part");
  assert.strictEqual(catchup.nextChunk(chunks, { taught: ["a#1"], cursor: "a#1" }).key, "b#1", "a cursor that exists works as before");
});
