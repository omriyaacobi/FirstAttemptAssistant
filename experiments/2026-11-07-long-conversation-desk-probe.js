// experiments/2026-11-07-long-conversation-desk-probe.js
// Does the real front desk (Gemini 3.8 Flash low through agy) say "recall" when a message needs the PAST?
// Everything is made up. 20 messages, one call each, Gemini only (never Claude). Changes nothing in Bot.
//   node experiments/2026-11-07-long-conversation-desk-probe.js [outfile]
const fs = require("node:fs");
const fd = require("../frontdesk");
const MODEL = "gemini-3.8-flash-low";
const HISTORY = "Conversation so far (oldest first), for context only:\nUser: explain what a heap is\n\nAssistant: A heap is a tree-shaped structure where every parent is smaller than its children...\n\nUser: thanks, and what about a stack?\n\nAssistant: A stack is last in, first out...";
const ABOUT = "## Background about the user (private)\n<about-the-user>\n### Facts the user asked Bot to remember\n[1] Omri studies computer science\n[2] Omri prefers short answers\n</about-the-user>";
// kind: explicit = asks about the past; implicit = needs a past fact without asking; control = needs nothing from the past
const CASES = [
  ["explicit", "what is my cat's name?"],
  ["explicit", "מה שם החתול שלי?"],
  ["explicit", "what did we decide about the OS project language?"],
  ["explicit", "remind me what I told you about my sister's wedding"],
  ["explicit", "when is my algorithms exam again?"],
  ["explicit", "מה אמרתי לך על האלרגיה שלי?"],
  ["explicit", "what did we talk about last month about the laptop?"],
  ["explicit", "who is Mr Katz?"],
  ["explicit", "where did I say the wedding is?"],
  ["explicit", "what was the thing you suggested for my parrot?"],
  ["implicit", "write a two line poem about my cat"],
  ["implicit", "suggest a dessert recipe for my guests"],
  ["implicit", "what should I wear to the wedding"],
  ["implicit", "plan my revision for the algorithms exam"],
  ["implicit", "set up the build for my OS project"],
  ["implicit", "how often should I clean the cage"],
  ["control", "explain what dijkstra does"],
  ["control", "how many minutes in 3 hours"],
  ["control", "translate good morning to French"],
  ["control", "what is a pointer in C"],
];
(async () => {
  fd.warm.warmUp(MODEL, null);
  await new Promise((r) => setTimeout(r, 6000));
  const brief = fs.readFileSync(fd.BRIEF_FILE, "utf8");
  const out = [];
  for (const [kind, msg] of CASES) {
    const prompt = fd.buildPrompt(msg, { history: HISTORY, brief, about: ABOUT }) + fd.REPLY_FORMAT_COURSE;
    const t = Date.now();
    let row = { kind, msg };
    try {
      const raw = await fd.warm.askStructured(prompt, MODEL, null, { timeoutMs: 60000 });
      row.action = raw && raw.action; row.destination = raw && raw.destination; row.recallQuery = raw && raw.recallQuery; row.remember = raw && raw.fact;
    } catch (error) { row.error = String(error.message).slice(0, 100); }
    row.seconds = (Date.now() - t) / 1000;
    out.push(row);
    console.log(kind.padEnd(8), String(row.action).padEnd(10), String(row.recallQuery || row.error || row.destination || "").slice(0, 50).padEnd(52), msg);
    await new Promise((r) => setTimeout(r, 1500));
  }
  const rate = (k) => { const rows = out.filter((r) => r.kind === k); return `${rows.filter((r) => r.action === "recall").length}/${rows.length}`; };
  console.log(`recall chosen: explicit ${rate("explicit")}, implicit ${rate("implicit")}, control ${rate("control")}`);
  if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 1));
  process.exit(0);
})();
