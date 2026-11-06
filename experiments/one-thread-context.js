// experiments/one-thread-context.js
// How much history can one conversation carry before answers get slow or wrong?
// Builds MADE-UP histories of growing size (filler Q&A pairs in Hebrew and English, with 3 planted "needle" facts at the start,
// middle and end), pastes them in front of a question exactly like core.js does ("Conversation so far ... The user's new message"),
// asks the question, and records the time and whether the answer contains the planted fact. Only agy is used. Not part of Bot itself.
//
//   node experiments/one-thread-context.js <model> <outfile> <sizesInChars comma list>
const fs = require("node:fs");
const { createWarmAgy } = require("../warmagy");

const [model = "gemini-3.8-flash-medium", outFile = "context.json", sizesArg = "3000,12000,40000,100000,250000"] = process.argv.slice(2);
const sizes = sizesArg.split(",").map(Number);

// Small deterministic random generator, so every model sees the same history.
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const pick = (list) => list[Math.floor(rnd() * list.length)];

const TOPICS = ["binary search trees", "a recipe for lentil soup", "the difference between TCP and UDP", "why the bus to campus is late", "limits of sequences", "how to reheat rice safely", "a Python list comprehension", "merge sort", "choosing a laptop bag", "the C preprocessor", "a weekly gym plan", "the derivative of arctan", "how a hash table resizes", "cleaning a cast iron pan", "a git rebase mistake", "the best time to book a train", "the meaning of volatile in C", "a polite email to a professor"];
const ASK = ["can you explain {t}?", "תסביר לי בקצרה על {t}", "give me an example about {t}", "I'm confused about {t}", "עוד פרט על {t} בבקשה", "what are the common mistakes with {t}?"];
const SENT = ["The main idea is to break the problem into small steps and check each one.", "A common mistake is to skip the base case and wait for the error.", "הדבר החשוב הוא להבין קודם את הדוגמה הפשוטה ורק אחר כך להכליל.", "Try it on a tiny input first, then on a bigger one, and compare.", "בדרך כלל כדאי לכתוב את התשובה בשורה אחת ואז לבדוק אותה עם מספרים.", "It usually costs a little more up front but saves time later.", "אפשר לחשוב על זה כמו רשימה של דברים שצריך לסמן אחד אחד.", "Remember that the order of the steps matters here."];

function pair() {
  const t = pick(TOPICS);
  const q = pick(ASK).replace("{t}", t);
  const a = Array.from({ length: 3 + Math.floor(rnd() * 4) }, () => pick(SENT)).join(" ");
  return [`User: ${q}`, `Assistant: ${a}`];
}

// The needles: made-up facts the question will ask about, one early, one in the middle, one late.
const NEEDLES = [
  { say: "By the way my cousin Tamar's birthday is on 14 March, remember it for the card.", ask: "When is my cousin Tamar's birthday? Answer with the date only.", expect: /14 march|march 14|14\.3|14\/3|14 במרץ/i },
  { say: "My study group meets in room 218 of building 37 on Tuesdays.", ask: "In which room does my study group meet? Answer with the room only.", expect: /218/ },
  { say: "I decided my project will use the SQLite database file called orbit.db.", ask: "Which database file did I choose for my project? Answer with the name only.", expect: /orbit\.db/i },
];

function history(totalChars, needleAt) {
  const lines = [];
  let size = 0;
  const target = totalChars;
  const placed = new Set();
  while (size < target) {
    for (const l of pair()) { lines.push(l); size += l.length + 2; }
    const frac = size / target;
    NEEDLES.forEach((n, i) => {
      if (!placed.has(i) && frac >= [0.05, 0.5, 0.93][i]) {
        placed.add(i);
        lines.push("User: " + n.say, "Assistant: Noted, I will keep that in mind.");
        size += n.say.length + 60;
      }
    });
  }
  return lines.join("\n\n");
}

(async () => {
  const warm = createWarmAgy({ keepReady: false });
  const rows = [];
  for (const chars of sizes) {
    const h = history(chars);
    for (let i = 0; i < NEEDLES.length; i++) {
      const n = NEEDLES[i];
      const prompt = `Conversation so far (oldest first), for context only:\n${h}\n\nThe user's new message (answer this one):\n${n.ask}`;
      const t = Date.now();
      const row = { model, historyChars: h.length, promptChars: prompt.length, needle: ["early", "middle", "late"][i] };
      try {
        const answer = await warm.askText(prompt, model, () => {}, { timeoutMs: 180000 });
        row.seconds = (Date.now() - t) / 1000;
        row.right = n.expect.test(answer); row.answer = String(answer).replace(/s+/g, " ").slice(0, 160);
      } catch (error) { row.seconds = (Date.now() - t) / 1000; row.error = String(error.message).slice(0, 80); }
      rows.push(row);
      console.log(`${model} history ${row.historyChars} needle ${row.needle}: ${row.error || (row.right ? "RIGHT" : "WRONG")} ${row.seconds.toFixed(1)}s${row.right ? "" : " :: " + row.answer}`);
      fs.writeFileSync(outFile, JSON.stringify(rows, null, 1));
    }
  }
  process.exit(0);
})();
