// experiments/answer-check.js
// Mechanical quality check of the answers recorded by answer-warm-ab.js: for each question the answer must mention the facts a good
// answer cannot skip (all patterns must match), be in the right language and not be cut short. Compares the variants (cold / warm / overlap).
// Usage: node experiments/answer-check.js <answer-warm-ab.json>
const rows = require(require("node:path").resolve(process.argv[2]));
const NEED = {
  "שניצלים": [/מיקרו|microwave/i, /נינג|אייר|air.?fr/i],
  "How long should I boil an egg": [/\b(6|6\.5|7)\b/, /ice|cold water|ice bath/i],
  "מה ההבדל בין מכונת כביסה": [/קדמי/, /עליון/],
  "What is the difference between TCP": [/reliab|handshake|ordered|guarantee/i, /fast|speed|connectionless|latency|overhead/i],
  "איך מורידים כתם": [/קר|סבון|חומץ|מי חמצן|סודה|אנזים|שפשוף/],
  "Why does my car shake": [/rotor|warp|disc|disk|brake|pad|רוטור|דיסק/i],
  "תן לי תוכנית ארוחות": [/בוקר/, /צהריים/, /ערב/],
  "How do I make a basic": [/butter/i, /flour/i, /milk/i],
  "כמה זמן אפשר לשמור": [/\b[34]\b|שלושה|ארבעה|3-4|3–4/],
  "Explain in about 150": [/refrigerant|compressor|evaporator|condenser/i],
  "מה זה אינפלציה": [/מחירים|יוקר|כוח קנייה|שער/],
  "What does a mutex": [/mutual exclusion|lock|thread/i],
};
const need = (q) => Object.entries(NEED).find(([k]) => q.startsWith(k.slice(0, 28)))?.[1];
const out = {};
for (const r of rows) {
  const o = (out[r.variant] ??= { n: 0, factMisses: 0, languageWrong: 0, tooShort: 0, errors: 0, details: [] });
  o.n++;
  if (r.error) { o.errors++; continue; }
  const patterns = need(r.q) || [];
  const missing = patterns.filter((p) => !p.test(r.answer));
  if (missing.length) { o.factMisses++; o.details.push(r.q + " missing " + missing.map(String).join(" ")); }
  if (!r.languageOk) o.languageWrong++;
  if (r.chars < 100) o.tooShort++;
}
for (const [v, o] of Object.entries(out)) console.log(v, JSON.stringify({ ...o, details: undefined }), o.details.slice(0, 6).join(" | "));
