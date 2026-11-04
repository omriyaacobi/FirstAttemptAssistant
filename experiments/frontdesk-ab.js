// experiments/frontdesk-ab.js
// Runs ~20 varied messages through the REAL front desk twice (Flash high, Flash medium) and
// records the time and the decision for each. Usage: node experiments/frontdesk-ab.js <out.json>
// Costs about 40 small Flash calls. Not part of Bot itself.

const fs = require("node:fs");
const { buildPrompt, SCHEMA, validateDecision } = require("../frontdesk");
const { askAgyStructured } = require("../providers");
const { historyBlock } = require("../core");

const HISTORY = historyBlock([
  { role: "user", text: "What is a hash table?" },
  { role: "assistant", text: "A hash table stores key/value pairs and uses a hash function to find the slot for a key, giving O(1) average lookup." },
]);

// [label, message, history]
const PROMPTS = [
  ["quick-math", "What is 17 times 23?"],
  ["quick-fact", "What is the capital of Australia?"],
  ["quick-define", "Explain in two sentences what a mutex is."],
  ["code-write", "Write a Python function that merges two sorted linked lists, with tests."],
  ["code-debug", "My Node server crashes with 'EADDRINUSE :::3000' when I restart it. What do I do?"],
  ["code-review", "Here is my code: for (var i=0;i<3;i++){ setTimeout(()=>console.log(i),0) } Why does it print 3 3 3 and how do I fix it?"],
  ["hard-proof", "Prove that the square root of 2 is irrational, then prove there exist irrational a, b with a^b rational."],
  ["hard-algo", "Design an algorithm to find the k-th smallest element in the union of two sorted arrays in O(log(min(n,m))) time and prove its correctness."],
  ["hard-reason", "Three gods A, B, C are Truth, Lie and Random, answering in a language where da/ja mean yes/no. With three yes/no questions, how do you identify all three?"],
  ["remind-1", "remind me tomorrow at 9 to submit the algorithms homework"],
  ["remind-2", "Remind me in 2 hours to call mom"],
  ["improve-1", "Change yourself so the page has a dark mode toggle."],
  ["improve-2", "Bot, add a new button to the sidebar that exports a chat as a text file."],
  ["clarify-1", "Fix it."],
  ["clarify-2", "Can you help me with the thing from before?"],
  ["split-1", "Explain how TCP works, then write a Python TCP echo server, then compare TCP and UDP in a table."],
  ["split-2", "I need three things: a summary of the French revolution, a regex for validating Israeli phone numbers, and a proof that there are infinitely many primes."],
  ["hebrew-quick", "מה ההבדל בין מחסנית לתור?"],
  ["hebrew-hard", "תוכיח שלכל גרף עם n צמתים ו-n קשתות לפחות יש מעגל."],
  ["history-follow", "And what happens when two keys collide?", HISTORY],
  ["calendar", "What meetings do I have tomorrow?"],
];

const MODELS = ["gemini-3.8-flash-high", "gemini-3.8-flash-medium"];

async function one(model, message, history) {
  const prompt = buildPrompt(message, { history: history || "", allowSplit: true });
  const t0 = Date.now();
  try {
    const raw = await askAgyStructured(prompt, model, SCHEMA);
    const seconds = Number(((Date.now() - t0) / 1000).toFixed(1));
    const d = validateDecision(raw);
    return { seconds, action: d ? d.action : "INVALID", destination: d ? d.destination : null, reason: d ? d.reason : "" };
  } catch (error) {
    return { seconds: Number(((Date.now() - t0) / 1000).toFixed(1)), action: "ERROR", destination: null, reason: String(error.message).slice(0, 100) };
  }
}

(async () => {
  const out = process.argv[2];
  const results = [];
  for (const [label, message, history] of PROMPTS) {
    const row = { label, message };
    // alternate which model goes first so a warm-up effect does not favour one of them
    const order = results.length % 2 ? [...MODELS].reverse() : MODELS;
    for (const model of order) row[model] = await one(model, message, history);
    results.push(row);
    fs.writeFileSync(out, JSON.stringify(results, null, 2));
    console.error(label, MODELS.map((m) => `${row[m].seconds}s ${row[m].action}/${row[m].destination}`).join("  |  "));
  }
})();
