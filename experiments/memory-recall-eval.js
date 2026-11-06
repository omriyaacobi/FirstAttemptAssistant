// experiments/memory-recall-eval.js
// Does the fact a message needs actually reach the prompt? 100 MADE-UP facts, 24 made-up questions, English and Hebrew.
// Compares: the old way (newest first up to 2000 characters), plain keyword search, and keyword search with the word families.
//   node experiments/memory-recall-eval.js
// Not part of Bot itself. No model is called.
const { pickFacts, bestMatches } = require("../profile");
const { createIndex, search } = require("../search");

// [the fact a question needs, the question, shares a word with the fact?]
const CASES = [
  ["Noa is allergic to peanuts", "does halva have peanuts in it?", "word"],
  ["Noa's dog is called Pixel", "what's my dog's name again?", "word"],
  ["Noa's sister Maya lives in Haifa", "where does my sister live?", "word"],
  ["Noa's student advisor is Dr. Levi", "who is my advisor?", "word"],
  ["Noa's bike is a red Trek", "what color is my bike?", "word"],
  ["Noa takes Calculus 2 this semester", "am I taking calculus now?", "word"],
  ["Noa's reserve duty is usually in March", "when is my reserve duty?", "word"],
  ["לנועה יש כלבה בשם פיקסל", "איך קוראים לכלבה שלי?", "word"],
  ["נועה לומדת במעבדה ביום שני", "באיזה יום המעבדה?", "word"],
  ["אחותה של נועה גרה בחיפה", "איפה גרה אחותי?", "word"],
  ["נועה אלרגית לבוטנים", "יש בוטנים בחלבה?", "word"],
  ["הרופאה של נועה היא ד\"ר כהן", "מי הרופאה שלי?", "word"],
  ["Noa is vegetarian", "what should I cook tonight?", "gap"],
  ["Noa is vegetarian", "suggest a restaurant for dinner", "gap"],
  ["Noa is allergic to peanuts", "plan my meals for the week", "gap"],
  ["Noa's mother's birthday is in June", "what gift should I get for mom?", "gap"],
  ["Noa's dog is called Pixel", "can I bring a pet on the train?", "gap"],
  ["Noa has a budget of 300 shekels a week", "should I buy these shoes for this price?", "gap"],
  ["Noa goes to the gym on Mondays", "I need a workout plan", "gap"],
  ["Noa's exam period starts in February", "help me plan my study schedule", "gap"],
  ["נועה צמחונית", "מה לבשל הערב?", "gap"],
  ["נועה צמחונית", "תמליץ לי על מסעדה", "gap"],
  ["לנועה יש תקציב של 300 שקל בשבוע", "כדאי לי לקנות במחיר הזה?", "gap"],
  ["אמא של נועה חוגגת יום הולדת ביוני", "איזו מתנה לקנות לאמא?", "gap"],
];

const NOISE = ["keeps a list of films to watch", "drinks tea with no sugar", "has a window seat at the library", "wants to learn the guitar", "uses a Linux laptop", "listens to podcasts while walking", "likes the color green", "reads science fiction", "takes photos of sunsets", "collects old maps"];

function memory(targets) {
  // The needed facts are the OLDEST, so the old way has to work to reach them.
  const unique = [...new Set(targets)];
  const facts = unique.map((text, i) => ({ id: `t${i}`, text, at: i }));
  for (let i = facts.length; i < 100; i++) facts.push({ id: `n${i}`, text: `Noa ${NOISE[i % NOISE.length]} (note ${i})`, at: i });
  return facts;
}

const facts = memory(CASES.map((c) => c[0]));
const textOf = (f) => f.text;

function oldWay() {
  const out = [];
  let total = 0;
  for (const f of [...facts].sort((a, b) => b.at - a.at)) {
    const size = f.text.length + 3;
    if (total + size > 2000) break;
    out.push(f);
    total += size;
  }
  return out.map(textOf);
}

function keywordOnly(query) {
  const hits = search(createIndex(facts), query, 12);
  return hits.map((h) => facts[h.index].text);
}

const WAYS = {
  "old (newest first, 2000 chars)": oldWay,
  "keywords only": keywordOnly,
  "keywords + word families (Bot now)": (q) => pickFacts(facts, q).map(textOf),
};

for (const [name, way] of Object.entries(WAYS)) {
  const row = { word: [0, 0], gap: [0, 0] };
  let chars = 0;
  const misses = [];
  for (const [target, question, kind] of CASES) {
    const got = way(question);
    row[kind][1]++;
    if (got.includes(target)) row[kind][0]++;
    else misses.push(question);
    chars += got.reduce((a, t) => a + t.length + 3, 0);
  }
  console.log(`${name}: shares a word ${row.word.join("/")}, no shared word ${row.gap.join("/")}, average ${Math.round(chars / CASES.length)} chars of facts per prompt`);
  if (misses.length) console.log(`   missed: ${misses.join(" | ")}`);
}

// A message about nothing saved: what does an idle message cost?
for (const q of ["hi bot, how are you?", "prove that the square root of 2 is irrational", "מה ההבדל בין מחסנית לתור?"]) {
  const got = pickFacts(facts, q);
  console.log(`"${q}": ${got.length} facts, ${got.reduce((a, f) => a + f.text.length + 3, 0)} chars`);
}
console.log("sample bestMatches:", bestMatches(facts, "what should I cook tonight?").slice(0, 3).map(textOf));
