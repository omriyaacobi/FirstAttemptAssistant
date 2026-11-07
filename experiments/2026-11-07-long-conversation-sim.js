// experiments/2026-11-07-long-conversation-sim.js
// A repeatable, MADE-UP, code-only test: "if Omri talks to Bot for 6 months, does the right memory reach the prompt?"
// It spends no model quota. It builds a fake 180-day thread (filler chatter + planted facts + a changed fact), then asks
// questions at different ages and checks whether the planted answer is INSIDE the context Bot's own code would build:
//   history   buildHistory()      thread-context.js (recent turns, daily notes)
//   notes     the 3 daily notes   thread-summary.js (REAL code; the summary "model" is a fake that is as good as a model can be)
//   facts     pickFacts()         profile.js (saved facts; only facts Omri confirmed are there)
//   recall    findInThread()      recall.js (BM25 search; only runs if the front desk says "recall")
// and, for comparison, a PROTOTYPE of a better retrieval (user-messages-only index + snippet around the match), written here only.
//
// Run:  node experiments/2026-11-07-long-conversation-sim.js [outfile-prefix]
// Nothing here touches data/, .env or the real Bot. The fake thread lives in a temp folder that is deleted at the end.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createThreadStore, dayOf } = require("../thread-store");
const { buildHistory } = require("../thread-context");
const { createSummaries } = require("../thread-summary");
const { pickFacts } = require("../profile");
const { findInThread, threadExchanges } = require("../recall");
const { createIndex, search, terms } = require("../search");
const { withTopics } = require("../profile");

// ---------- repeatable randomness ----------
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rand = rng(20261107);
const pick = (list) => list[Math.floor(rand() * list.length)];
const between = (a, b) => a + Math.floor(rand() * (b - a + 1));

// ---------- made-up filler chatter (study, cooking, travel, small talk; English and Hebrew) ----------
const VOCAB = {
  calculus: "limit derivative integral series converges theorem proof epsilon delta continuous function slope tangent exam example bound sequence".split(" "),
  algorithms: "graph tree heap queue stack dijkstra sorting complexity recursion node edge path weight greedy dynamic exam project date".split(" "),
  clang: "pointer array malloc struct memory buffer segfault compile header loop string language project exam free stack".split(" "),
  cooking: "recipe oven flour onion garlic simmer pasta sauce salt dessert guests dinner bake minutes".split(" "),
  travel: "flight hotel train ticket museum beach hostel itinerary budget weekend date".split(" "),
  heb: "פונקציה גבול נגזרת אינטגרל משפט הוכחה גרף עץ מצביע זיכרון מבחן תרגיל שאלה תשובה פרויקט שפה תאריך".split(" "),
};
const GLUE = "the a of and to is in that it for with on as are by this from can be or an we so then when how why because also but not".split(" ");
const topicNames = Object.keys(VOCAB);
function filler(topic, words) {
  const v = VOCAB[topic];
  const out = [];
  for (let i = 0; i < words; i++) out.push(rand() < 0.45 ? pick(v) : topic === "heb" ? pick(v) : pick(GLUE));
  return out.join(" ");
}
function exchange(topic, long = false) {
  const q = (topic === "heb" ? "תסביר לי " : "explain ") + filler(topic, between(3, 7));
  const a = filler(topic, between(long ? 220 : 90, long ? 320 : 150)); // about 600-1000 characters, like Bot's real answers (average 914)
  return { q, a, topic: topic === "calculus" || topic === "algorithms" || topic === "clang" || topic === "heb" ? "study" : "general" };
}

// ---------- planted facts (invented people, places, dates; nothing real) ----------
// kind: how the answer is worded in the user's message. lang: the language it was said in.
const FACTS = [
  // pets: three instances, so an old one can be confused with a new one
  { id: "cat", plant: 2, say: "By the way my cat is called Mango and she hates the vet.", gold: "Mango", ask: "what is my cat's name?", recallQuery: "cat name חתול שם", implicit: "write a two line poem about my cat", saved: "My cat is called Mango" },
  { id: "dog", plant: 60, say: "We got a dog last week, his name is Biscuit.", gold: "Biscuit", ask: "what is my dog's name?", recallQuery: "dog name כלב שם", implicit: "ideas for a birthday party for my dog", saved: "My dog is called Biscuit" },
  { id: "parrot", plant: 118, say: "I adopted a parrot named Kiwi.", gold: "Kiwi", ask: "what is my parrot called?", recallQuery: "parrot name תוכי", implicit: "how often should I clean my parrot's cage", saved: "My parrot is called Kiwi" },
  // an allergy said in Hebrew, asked in English
  { id: "allergy", plant: 9, say: "אני אלרגי לפיסטוק, חשוב שתזכור את זה כשאתה נותן לי מתכונים.", gold: "פיסטוק", ask: "what am I allergic to?", recallQuery: "allergic allergy אלרגי אלרגיה", implicit: "suggest a dessert recipe for my guests", saved: "Allergic to pistachios (פיסטוק)" },
  // a fact that CHANGES
  { id: "exam", plant: 30, say: "My Algorithms exam is on 3 February at 9:00.", gold: "3 February", change: { day: 70, say: "Update: the Algorithms exam was moved to 17 February.", gold: "17 February" }, ask: "when is my algorithms exam?", recallQuery: "algorithms exam date מבחן אלגוריתמים", implicit: "plan my revision for the algorithms exam", saved: "Algorithms exam is on 3 February at 9:00", savedNew: "Algorithms exam is on 17 February" },
  // a wedding said in Hebrew, asked in English with a query in both languages (the briefing asks the front desk for both)
  { id: "wedding", plant: 45, say: "החתונה של אחותי תהיה ב-14 במרץ בחיפה.", gold: "14 במרץ", ask: "when is my sister's wedding?", recallQuery: "sister wedding אחות חתונה", implicit: "what should I wear to the wedding", saved: "Sister's wedding is on 14 במרץ (14 March) in Haifa" },
  // the same fact, but the desk writes an English-only query (it should not, but models slip)
  { id: "wedding-en-only", plant: 45, say: null, gold: "14 במרץ", ask: "when is my sister's wedding?", recallQuery: "sister wedding date", implicit: null, saved: null },
  // a decision
  { id: "decision", plant: 80, say: "OK decision made: I will write the OS project in C, not in Rust.", gold: "in C, not", ask: "which language did we decide on for the OS project?", recallQuery: "OS project language decided החלטה", implicit: "set up the build for my OS project", saved: "OS project will be written in C, not Rust" },
  // a fact buried deep in a long pasted message (recall cuts every excerpt to 500 characters)
  { id: "landlord", plant: 100, long: true, say: "Mr Katz said the rent is due on the 5th of each month.", gold: "rent is due on the 5th", ask: "when is my rent due?", recallQuery: "rent due landlord שכר דירה", implicit: "remind me what to do before the first of the month about rent", saved: "Rent is due on the 5th of each month" },
  // a standing preference said in chat (not a fact about the world; checkFact allows it, but only if the desk says "remember")
  { id: "style", plant: 3, say: "From now on please answer me in short bullet points, no long paragraphs.", gold: "short bullet points", ask: "how do you answer me again, in what style?", recallQuery: "answer style bullet points", implicit: "explain what a heap is", saved: "Wants answers in short bullet points" },
];
const AGES = [0, 1, 3, 10, 30, 60, 90]; // days after the plant (0 = later the same day, after the day's other chat)
const HORIZON = 182;
const SAVE_SCENARIOS = { none: 0, half: 0.5, all: 1 }; // how many facts reached the saved list through a confirm card

// ---------- build the fake thread day by day and ask questions on the way ----------
function run() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "longsim-"));
  const base = new Date(2027, 0, 4, 8, 0, 0).getTime(); // a made-up start date; "today" in the sim moves with the days
  const DAY = 24 * 3600 * 1000;
  let clock = base;
  const thread = createThreadStore(path.join(dir, "thread"), { now: () => clock });
  const summaryDir = path.join(dir, "summaries");
  // The fake summary "model": it is as good as a model can be (it always includes the planted statements first), then lists topics.
  // So the "notes" numbers below are an UPPER bound for a real summary. The real code (cap 600 chars a day, last 3 days) still applies.
  const planted = new Map(); // day -> planted user lines
  const askChain = async (chain, prompt) => {
    const day = (/\(day (\d{4}-\d{2}-\d{2})\)/.exec(prompt) || [])[1];
    const lines = planted.get(day) || [];
    const summary = (lines.join(" ") + " They also talked about study topics and everyday things.").slice(0, 880);
    return { answer: JSON.stringify({ summary, facts: [], tasks: [], openQuestions: [] }), used: null };
  };
  const summaries = createSummaries({ thread, dir: summaryDir, askChain, now: () => clock });

  const results = [];
  const saved = { none: [], half: [], all: [] };
  const filler60 = Array.from({ length: 60 }, (_, i) => `Fact number ${i} about Omri: likes ${pick(VOCAB.cooking)} and ${pick(VOCAB.travel)} item${i}`);
  const sizes = []; // per day: thread size, context size
  let askedFromFacts = 0;

  const addPair = (q, a, topic, atMs) => {
    const u = thread.append({ role: "user", text: q, at: atMs, topic: "general" });
    thread.append({ role: "assistant", text: a, at: atMs + 20000, replyTo: u.id, topic });
    return u;
  };
  const entryOf = (m) => ({ role: m.role, text: m.text });

  function contextFor(task, { scenario, extra }) {
    const facts = saved[scenario].map((f, i) => ({ id: "f" + i, text: f.text, at: f.at, pinned: false }));
    const all = extra ? facts.concat(filler60.map((t, i) => ({ id: "x" + i, text: t, at: base + i * 1000 }))) : facts;
    const history = buildHistory(thread, { entryOf, notes: summaries.notesBlock() });
    const histText = history.filter((h) => h.label !== "notes").map((h) => h.text).join("\n");
    const notesText = history.filter((h) => h.label === "notes").map((h) => h.text).join("\n");
    const lastUser = [...history].reverse().find((h) => h.role === "user");
    const picked = pickFacts(all, lastUser ? `${task} ${lastUser.text.slice(0, 300)}` : task);
    const factsText = picked.map((f) => f.text).join("\n");
    return { histText, notesText, factsText, historyChars: history.reduce((a, h) => a + h.text.length, 0) + 0, factChars: factsText.length };
  }

  const asks = []; // { day, when, fact, kind }
  for (const f of FACTS) {
    for (const age of AGES) {
      const day = f.plant + age;
      if (day >= HORIZON) continue;
      asks.push({ day, when: age === 0 ? "end" : "start", f, age, changed: false });
    }
  }
  const askedLog = [];

  for (let d = 0; d < HORIZON; d++) {
    const dayStart = base + d * DAY;
    clock = dayStart;
    // 1. questions asked at the start of this day (after yesterday's chat)
    for (const a of asks.filter((x) => x.day === d && x.when === "start")) askedLog.push(ask(a, dayStart + 60000));
    // 2. the day's chatter
    const away = rand() < 0.15; // days Omri does not use Bot
    const n = away ? 0 : d === 50 ? 25 : between(4, 12);
    const plantsToday = FACTS.filter((f) => f.say && f.plant === d).concat(FACTS.filter((f) => f.change && f.change.day === d).map((f) => ({ id: f.id + "-change", say: f.change.say, long: false })));
    const slots = new Set(plantsToday.map(() => between(0, Math.max(0, n - 1))));
    let t = dayStart + 3600 * 1000;
    const pendingPlants = [...plantsToday];
    const total = Math.max(n, plantsToday.length);
    for (let i = 0; i < total; i++) {
      const topic = pick(topicNames);
      const e = exchange(topic);
      addPair(e.q, e.a, e.topic, t);
      t += 25 * 60000;
      if (pendingPlants.length && (slots.has(i) || i === total - 1)) {
        const p = pendingPlants.shift();
        const text = p.long ? filler("clang", 230) + " " + p.say : p.say; // about 1,400 characters of paste, the fact at the end
        const day = dayOf(t);
        planted.set(day, (planted.get(day) || []).concat(text.slice(-250)));
        addPair(text, "Noted.", "general", t);
        t += 25 * 60000;
      }
    }
    while (pendingPlants.length) { // a planting day with away=true still needs its message
      const p = pendingPlants.shift();
      const day = dayOf(t);
      const text = p.long ? filler("clang", 230) + " " + p.say : p.say;
      planted.set(day, (planted.get(day) || []).concat(text.slice(-250)));
      addPair(text, "Noted.", "general", t);
      t += 25 * 60000;
    }
    // facts reach the saved list the day after they are said (a confirm card from the daily summary), per scenario
    for (const f of FACTS) {
      if (!f.saved) continue;
      for (const [name, rate] of Object.entries(SAVE_SCENARIOS)) {
        const idx = FACTS.indexOf(f);
        const keep = rate === 1 || (rate === 0.5 && idx % 2 === 0);
        if (!keep) continue;
        if (f.plant + 1 === d) saved[name].push({ key: f.id, text: f.saved, at: dayStart });
        if (f.change && f.change.day + 1 === d) {
          const i = saved[name].findIndex((x) => x.key === f.id);
          if (i >= 0) saved[name][i] = { key: f.id, text: f.savedNew, at: dayStart }; // the desk replaced the old fact
        }
      }
    }
    // 3. questions asked at the end of the day
    clock = t + 3600 * 1000;
    for (const a of asks.filter((x) => x.day === d && x.when === "end")) askedLog.push(ask(a, clock));
    // 4. the summaries of past days (the real catch-up: at most 3 days per run, started by the next day's first message)
    clock = dayStart + DAY;
    if (d % 1 === 0) summaries.catchUp();
    // 5. size bookkeeping every 10 days
    if (d % 10 === 9) {
      const c = contextFor("hello", { scenario: "all", extra: true });
      sizes.push({ day: d + 1, threadChars: thread.days().reduce((a, x) => a + x.chars, 0), threadMessages: thread.days().reduce((a, x) => a + x.messages, 0), historyChars: c.historyChars, factChars: c.factChars });
    }
  }

  function ask(a, atMs) {
    clock = atMs;
    const f = a.f;
    const out = { fact: f.id, age: a.age, day: a.day, changedSince: !!(f.change && a.day >= f.change.day) };
    const goldNow = out.changedSince ? f.change.gold : f.gold;
    const goldOld = f.gold;
    const has = (text, g) => text.toLowerCase().includes(g.toLowerCase());
    for (const [scenario, extra] of [["none", false], ["half", false], ["all", false], ["all", true]]) {
      const key = scenario + (extra ? "+60" : "");
      // implicit question: the desk does not say "recall", so only history + notes + facts can help
      if (f.implicit) {
        const c = contextFor(f.implicit, { scenario, extra });
        out["implicit." + key] = {
          history: has(c.histText, goldNow), notes: has(c.notesText, goldNow), facts: has(c.factsText, goldNow),
          any: has(c.histText + c.notesText + c.factsText, goldNow),
        };
      }
    }
    if (f.implicit) { const pr = protoRecall(thread, f.implicit, { limit: 2 }); out["implicit.proto"] = has(pr.map((x) => x.snippet).join("\n"), goldNow); out["implicit.protoChars"] = pr.reduce((a, x) => a + x.snippet.length, 0); }
    // explicit question: the desk says "recall" (assumed correct here; the real rate is a separate question)
    const c0 = contextFor(f.ask, { scenario: "none", extra: false });
    const cAll = contextFor(f.ask, { scenario: "all", extra: false });
    const found = findInThread(thread, f.recallQuery);
    const recallText = found.map((x) => `[${x.at}] ${x.question}\n${x.answer}`).join("\n");
    const proto = protoRecall(thread, f.recallQuery, { limit: 4 });
    if (process.env.DBG && f.id === "landlord" && a.age === 10) { const us = [...thread.all()].filter((m) => m.role === "user"); const ix = createIndex(us.map((m) => ({ text: m.text }))); const hh = search(ix, withTopics(f.recallQuery), 6); console.log("DBG q=", withTopics(f.recallQuery)); hh.forEach((h) => console.log(h.score.toFixed(2), us[h.index].text.length, us[h.index].text.slice(-60))); const mine = us.findIndex((m) => m.text.includes("Katz")); console.log("katz idx", mine, "in hits?", search(ix, withTopics(f.recallQuery), us.length).findIndex((h) => h.index === mine)); }
    const protoText = proto.map((x) => x.snippet).join("\n");
    const rec = (text) => ({ hasNew: has(text, goldNow), hasOld: has(text, goldOld) });
    out.explicit = {
      today_nothing_saved: has(c0.histText + c0.notesText + recallText, goldNow),
      today_with_facts: has(cAll.histText + cAll.notesText + cAll.factsText + recallText, goldNow),
      recall_only: rec(recallText),
      proto_only: rec(protoText),
      recallExcerpts: found.length,
      recallRankOfGold: found.findIndex((x) => has(x.question + " " + x.answer, goldNow)) + 1,
      protoRankOfGold: proto.findIndex((x) => has(x.snippet, goldNow)) + 1,
    };
    // the changed fact: is the OLD value the only one that came back? (the dangerous case)
    if (out.changedSince) {
      const both = rec(recallText);
      out.explicit.staleOnly = both.hasOld && !both.hasNew;
      const pb = rec(protoText);
      out.explicit.protoStaleOnly = pb.hasOld && !pb.hasNew;
    }
    return out;
  }

  // ---------- timing (does the search stay fast at 6 months?) ----------
  const t0 = process.hrtime.bigint();
  const pairs = threadExchanges(thread).length;
  const tPairs = Number(process.hrtime.bigint() - t0) / 1e6;
  const t1 = process.hrtime.bigint();
  findInThread(thread, "cat name");
  const tFind = Number(process.hrtime.bigint() - t1) / 1e6;
  const t2 = process.hrtime.bigint();
  let n = 0; for (const m of thread.all()) n++;
  const tAll = Number(process.hrtime.bigint() - t2) / 1e6;
  const t3 = process.hrtime.bigint();
  buildHistory(thread, { entryOf, notes: "" });
  const tHist = Number(process.hrtime.bigint() - t3) / 1e6;

  // CONTROL: ordinary study questions with no planted fact. How much junk would always-on retrieval inject?
  const control = [];
  for (let i = 0; i < 40; i++) { const e = exchange(pick(["calculus", "algorithms", "clang", "cooking"])); const pr = protoRecall(thread, e.q, { limit: 2 }); control.push(pr.reduce((a, x) => a + x.snippet.length, 0)); }
  const final = { control, askedLog, sizes, pairs, ms: { threadExchanges: Math.round(tPairs), findInThread: Math.round(tFind), readAll: Math.round(tAll), buildHistory: Math.round(tHist) }, messages: n };
  fs.rmSync(dir, { recursive: true, force: true });
  return final;
}

// Same BM25 as search.js, but a 3-letter piece that is in more than DF_MAX of all messages is ignored ("and" inside "landlord"), and long messages are punished less (b 0.5).
function search2(index, query, k, { dfMax = 0.08, k1 = 1.4, b = 0.5 } = {}) {
  const q = [...new Set(terms(query))].filter((t) => (index.df.get(t) || 0) / index.n <= dfMax);
  const scored = [];
  index.docs.forEach((d, i) => {
    const tf = new Map();
    for (const t of d) tf.set(t, (tf.get(t) || 0) + 1);
    let score = 0;
    for (const t of q) { const f = tf.get(t); if (!f) continue; const dfT = index.df.get(t); score += (Math.log(1 + (index.n - dfT + 0.5) / (dfT + 0.5)) * f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.length) / index.avg)); }
    if (score > 0) scored.push({ index: i, score });
  });
  return scored.sort((a, z) => z.score - a.score).slice(0, k);
}

// ---------- PROTOTYPE of a better recall (lives only in this file; Bot is not changed) ----------
// 1. Index the USER's messages only (facts are in what the user said; Bot's long answers dilute the score).
// 2. Return a SNIPPET around the matching sentences instead of the first 500 characters.
// 3. At most one hit per day, newest first among near-equal scores, so a changed fact shows its newest version.
function protoRecall(thread, query, { limit = 4 } = {}) {
  const pairs = [];
  for (const m of thread.all()) if (m.role === "user" && !m.error) pairs.push(m);
  if (!pairs.length) return [];
  const index = createIndex(pairs.map((m) => ({ text: m.text })));
  const hits = search2(index, withTopics(query), pairs.length);
  if (!hits.length) return [];
  const best = hits[0].score;
  const q = new Set(withTopics(query).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  const out = [];
  const perDay = new Set();
  for (const h of hits) {
    if (h.score < best * 0.4 || out.length >= limit) break;
    const m = pairs[h.index];
    const day = dayOf(m.at);
    if (perDay.has(day)) continue;
    perDay.add(day);
    // the 500-character window with the most query words (a long paste with the fact at the end still works)
    const text = m.text;
    const words = [];
    for (const w of text.matchAll(/[p{L}p{N}]+/gu)) words.push({ at: w.index, hit: q.has(w[0].toLowerCase()) ? 1 : 0 });
    let bestStart = 0, bestHits = -1;
    for (let start = 0; start < Math.max(1, text.length - 100); start += 50) {
      const hits = words.filter((w) => w.at >= start && w.at < start + 500 && w.hit).length;
      if (hits > bestHits || false) { bestHits = hits; bestStart = start; }
    }
    const snippet = text.slice(bestStart, bestStart + 500);
    out.push({ at: m.at, snippet: `${day}: ${snippet}`, score: h.score });
  }
  return out.sort((a, b) => b.at - a.at); // newest first, so a changed fact reads newest on top
}

// ---------- report ----------
function pct(a, b) { return b ? Math.round((100 * a) / b) + "%" : "-"; }
function report(res) {
  const lines = [];
  const L = (s = "") => lines.push(s);
  const ageLabel = (a) => (a === 0 ? "same day" : a + "d");
  const factIds = [...new Set(res.askedLog.map((x) => x.fact))];

  L("# Long-conversation simulation (made-up data, code only)");
  L(`Thread: ${res.messages} messages over ${HORIZON} days. Questions asked: ${res.askedLog.length}.`);
  L(`Timing on this PC at 6 months: threadExchanges ${res.ms.threadExchanges} ms, findInThread (index + search) ${res.ms.findInThread} ms, read all days ${res.ms.readAll} ms, buildHistory ${res.ms.buildHistory} ms. Search pairs: ${res.pairs}.`);
  L();
  L("## Size of the thread vs the size of what a message carries");
  L("day | thread messages | thread chars | history chars carried | saved-fact chars carried");
  for (const s of res.sizes.filter((x, i) => i % 3 === 2 || i === res.sizes.length - 1)) L(`${s.day} | ${s.threadMessages} | ${s.threadChars} | ${s.historyChars} | ${s.factChars}`);

  // A. implicit questions: no recall; what do history + notes + facts carry?
  L();
  L("## A. Implicit questions (the message needs a past fact but does not ask about the past; recall does NOT run)");
  L("Share of questions whose answer is inside the prompt, by age of the fact, and by what was saved.");
  const keys = ["none", "half", "all", "all+60"];
  L("age | " + keys.map((k) => "saved=" + k).join(" | ") + " | via history | via notes");
  for (const age of AGES) {
    const rows = res.askedLog.filter((x) => x.age === age && x["implicit.none"] && !x.changedSince);
    const cells = keys.map((k) => pct(rows.filter((r) => r["implicit." + k].any).length, rows.length));
    const hist = pct(rows.filter((r) => r["implicit.none"].history).length, rows.length);
    const notes = pct(rows.filter((r) => r["implicit.none"].notes).length, rows.length);
    L(`${ageLabel(age)} | ${cells.join(" | ")} | ${hist} | ${notes}  (n=${rows.length})`);
  }

  // B. explicit
  L();
  L("## B. Explicit questions (\"what is my cat called?\"; the front desk is ASSUMED to say recall and to write good search words)");
  L("age | today: recall only (nothing saved) | today + saved facts (all) | prototype recall");
  for (const age of AGES) {
    const rows = res.askedLog.filter((x) => x.age === age && !x.changedSince);
    const a = rows.filter((r) => r.explicit.today_nothing_saved).length;
    const b = rows.filter((r) => r.explicit.today_with_facts).length;
    const c = rows.filter((r) => r.explicit.proto_only.hasNew).length;
    L(`${ageLabel(age)} | ${pct(a, rows.length)} | ${pct(b, rows.length)} | ${pct(c, rows.length)}  (n=${rows.length})`);
  }
  L();
  L("Per fact, explicit question, today's recall.js vs the prototype (every age, hit = the right value is in the excerpts):");
  L("fact | today recall | prototype | rank of gold today (0 = missed) | note");
  for (const id of factIds) {
    const rows = res.askedLog.filter((x) => x.fact === id && !x.changedSince);
    if (!rows.length) continue;
    const t = rows.filter((r) => r.explicit.recall_only.hasNew).length;
    const p = rows.filter((r) => r.explicit.proto_only.hasNew).length;
    const ranks = rows.map((r) => r.explicit.recallRankOfGold).join(",");
    L(`${id} | ${pct(t, rows.length)} | ${pct(p, rows.length)} | ${ranks}`);
  }

  L();
  L("Implicit question, per fact, at ages 3d or more (hit = the answer is inside the prompt):");
  L("fact | saved=none | saved=half | saved=all | always-on retrieval prototype (top 2 snippets)");
  for (const id of factIds) {
    const rows = res.askedLog.filter((x) => x.fact === id && x.age >= 3 && x["implicit.none"] && !x.changedSince);
    if (!rows.length) continue;
    L(id + " | " + ["none", "half", "all"].map((k) => pct(rows.filter((r) => r["implicit." + k].any).length, rows.length)).join(" | ") + " | " + pct(rows.filter((r) => r["implicit.proto"]).length, rows.length));
  }
  const allRows = res.askedLog.filter((x) => x.age >= 3 && x["implicit.none"] && !x.changedSince);
  L("All facts, age 3d+: saved=all " + pct(allRows.filter((r) => r["implicit.all"].any).length, allRows.length) + ", always-on retrieval " + pct(allRows.filter((r) => r["implicit.proto"]).length, allRows.length) + ", both together " + pct(allRows.filter((r) => r["implicit.all"].any || r["implicit.proto"]).length, allRows.length) + ".");
  const c = res.control; L("Control (40 ordinary questions, no planted fact): always-on retrieval injected something into " + pct(c.filter((x) => x > 0).length, c.length) + " of them, " + Math.round(c.reduce((a, b) => a + b, 0) / c.length) + " characters on average (the hard cap is 1,000).");

  // C. changed fact
  L();
  L("## C. The fact that changed (exam moved on day 70). Asked after the change:");
  const ch = res.askedLog.filter((x) => x.changedSince);
  L(`questions: ${ch.length}. Today's recall: newest date present ${pct(ch.filter((r) => r.explicit.recall_only.hasNew).length, ch.length)}; ONLY the old date came back (wrong answer risk) ${pct(ch.filter((r) => r.explicit.staleOnly).length, ch.length)}.`);
  L(`Prototype: newest date present ${pct(ch.filter((r) => r.explicit.proto_only.hasNew).length, ch.length)}; only the old date ${pct(ch.filter((r) => r.explicit.protoStaleOnly).length, ch.length)}.`);
  const chImp = res.askedLog.filter((x) => x.fact === "exam" && x.changedSince && x["implicit.all"]);
  L(`Implicit question about it, saved=all (desk replaced the old fact): newest date in the prompt ${pct(chImp.filter((r) => r["implicit.all"].any).length, chImp.length)}.`);
  return lines.join("\n");
}

if (require.main === module) {
  const res = run();
  const text = report(res);
  console.log(text);
  const prefix = process.argv[2];
  if (prefix) {
    fs.writeFileSync(prefix + ".json", JSON.stringify(res, null, 1));
    fs.writeFileSync(prefix + ".txt", text);
  }
}
module.exports = { run, report, protoRecall };
