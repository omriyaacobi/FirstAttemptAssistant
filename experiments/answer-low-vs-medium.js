// answer-low-vs-medium.js
// Experiment 2026-11-05: would the gemini-flash destination make more mistakes with gemini-3.8-flash-low than with -medium?
// Every question goes through BOTH models, REPS times, with exactly the call the live answer step makes
// (providers.ask("agy", model, personalize(chain, question, about))). Nothing here changes the live routing.
// The answers are saved with the model name; grade.js-style blind grading happens afterwards from a shuffled copy
// that has no model names in it (see the report).
//
// Run:  node experiments/answer-low-vs-medium.js <output.json> [reps] [concurrency]
// Results are saved after every call, and a re-run continues where it stopped.

const fs = require("node:fs");
const { ask } = require("../providers");
const { personalize, aboutBlock } = require("../profile");
const { MODELS } = require("../router");

// q = the question as a user would type it. lang = language the answer must be in ("he" or "en").
// facts = regexes that must ALL match a correct answer. bad = regexes that mean a wrong fact if they match.
// The regexes only flag candidates; every answer is also read by hand (see the report).
const Q = [
  { id: 1, q: "How long should I boil a hard-boiled egg?", lang: "en", facts: [/\b(9|10|11|12|13|14|15)\b[^.\n]{0,40}min/i] },
  { id: 2, q: "מה הטמפרטורה הבטוחה לבישול חזה עוף?", lang: "he", facts: [/74|75|165/] },
  { id: 3, q: "How many tablespoons are in a 1/4 cup?", lang: "en", facts: [/\b4\b|four/i] },
  { id: 4, q: "כמה כפיות יש בכף אחת?", lang: "he", facts: [/\b3\b|שלוש/] },
  { id: 5, q: "What temperature should my fridge be set to?", lang: "en", facts: [/\b(3|4|5)\s*°?\s*C|\b(37|38|39|40)\s*°?\s*F/i] },
  { id: 6, q: "איך מסירים כתם שמן מחולצה בלי להרוס אותה?", lang: "he", facts: [/סבון/] },
  { id: 7, q: "How do I descale a kettle with vinegar?", lang: "en", facts: [/vinegar/i, /boil|heat|soak/i, /rinse/i] },
  { id: 8, q: "מה היחס בין מים לאורז לבן כשמבשלים בסיר?", lang: "he", facts: [/2|שניים|פי/] },
  { id: 9, q: "How long can cooked rice sit at room temperature before it is unsafe?", lang: "en", facts: [/\b(1|2|one|two)\b[^.\n]{0,20}hour/i], bad: [/\b(4|5|6|8|12|24)\s*hours?\b/i] },
  { id: 10, q: "Can I freeze cooked pasta? For how long?", lang: "en", facts: [/yes|can/i, /month/i] },
  { id: 11, q: "מה ההבדל בין סודה לשתייה לאבקת אפייה?", lang: "he", facts: [/חומצ/] },
  { id: 12, q: "What is 350°F in Celsius?", lang: "en", facts: [/17[5-9]|180/] },
  { id: 13, q: "כמה גרם יש באונקיה אחת?", lang: "he", facts: [/28/] },
  { id: 14, q: "What is 2.5 pounds in kilograms?", lang: "en", facts: [/1\.1[2-4]/] },
  { id: 15, q: "What does the oil pressure warning light in my car mean, and what should I do?", lang: "en", facts: [/oil/i, /stop|pull over|turn off|park|switch off/i] },
  { id: 16, q: "מה לחץ האוויר הנכון בצמיגים של רכב פרטי רגיל?", lang: "he", facts: [/דלת|מדבקה|תווית|ספר|יצרן|2[.,]\d|3[0-9]/] },
  { id: 17, q: "How often should I change the engine oil in a regular petrol car?", lang: "en", facts: [/\d[,.]?\d{3}|\b(six|6|12|twelve)\b[^.\n]{0,12}month/i] },
  { id: 18, q: "What does the ABS light on the dashboard mean?", lang: "en", facts: [/anti-?lock/i, /brak/i] },
  { id: 19, q: "כל כמה זמן עושים טסט שנתי לרכב פרטי בישראל?", lang: "he", facts: [/שנה|שנתי/], bad: [/כל חצי שנה|כל שנתיים/] },
  { id: 20, q: "How do I jump-start a car? Which cable do I connect first?", lang: "en", facts: [/positive|red|\+/i, /ground|unpainted|metal|bolt|engine block/i] },
  { id: 21, q: "מה ההבדל בין בנזין 95 ל-98?", lang: "he", facts: [/אוקטן/] },
  { id: 22, q: "Convert 100 km/h to mph.", lang: "en", facts: [/62/] },
  { id: 23, q: "Explain what a primary key is in a database, briefly.", lang: "en", facts: [/unique/i, /row|record|tuple/i] },
  { id: 24, q: "מה ההבדל בין stack ל-queue?", lang: "he", facts: [/LIFO/i, /FIFO/i] },
  { id: 25, q: "What is the time complexity of binary search?", lang: "en", facts: [/log/i] },
  { id: 26, q: "מהי הנגזרת של x בשלישית?", lang: "he", facts: [/3\s*x\s*(\^|\*\*)?\s*2|3x²|3x\^\{?2/i] },
  { id: 27, q: "What is the derivative of sin(x)?", lang: "en", facts: [/cos/i], bad: [/-\s*cos/] },
  { id: 28, q: "Explain Newton's second law in one short paragraph.", lang: "en", facts: [/F\s*=\s*m\s*\*?\s*a|force|mass/i, /accelerat/i] },
  { id: 29, q: "מה זה DNS ולמה צריך אותו?", lang: "he", facts: [/IP/] },
  { id: 30, q: "What is the difference between TCP and UDP?", lang: "en", facts: [/reliab|guarantee|handshake|ordered/i, /UDP/, /fast|connectionless|no guarantee|lightweight|lower/i] },
  { id: 31, q: "What is the capital of Australia, and why isn't it Sydney?", lang: "en", facts: [/Canberra/] },
  { id: 32, q: "באיזו שנה נפלה חומת ברלין?", lang: "he", facts: [/1989/] },
  { id: 33, q: "How many bytes are in a kibibyte, and how is it different from a kilobyte?", lang: "en", facts: [/1,?024/, /1,?000/] },
  { id: 34, q: "מה זה פוטוסינתזה? הסבר קצר.", lang: "he", facts: [/אור|שמש/, /גלוקוז|סוכר/, /פחמן|CO2|CO₂/] },
  { id: 35, q: "What is the Pythagorean theorem? Give an example with numbers.", lang: "en", facts: [/a\s*[²2^]\s*\+?\s*b|a\^2/i, /\b25\b|\b5\b/] },
  { id: 36, q: "מה זה אינפלציה, בקצרה?", lang: "he", facts: [/מחיר/] },
  { id: 37, q: "Translate to Hebrew: \"The meeting has been moved to Thursday at 10 AM.\"", lang: "he", facts: [/פגישה|ישיבה/, /חמישי/, /10|עשר/] },
  { id: 38, q: "תרגם לאנגלית: \"אני צריך לקחת את האוטו לטסט ביום ראשון\"", lang: "en", facts: [/car/i, /test|inspection|MOT/i, /Sunday/i] },
  { id: 39, q: "Translate to English: \"הכלב שלי אוהב לשחק בפארק כל בוקר\"", lang: "en", facts: [/dog/i, /park/i, /morning/i] },
  { id: 40, q: "Translate to Hebrew: \"Please remember to turn off the oven before you leave.\"", lang: "he", facts: [/תנור/, /כב[הת]|לכבות|תכבו|כיבוי/] },
  { id: 41, q: "How do you say \"I am allergic to peanuts\" in Hebrew?", lang: "en", facts: [/אלרגי/, /בוטנים/] },
  { id: 42, q: "Summarize in two sentences: \"The city council voted 7 to 2 on Tuesday to extend the bike lane on Herzl Street by 3 kilometers. Construction will begin in March and cost 12 million shekels. Opponents said it would remove 80 parking spots.\"", lang: "en", facts: [/\b7\b/, /\b3\b/, /12/, /March/i] },
  { id: 43, q: "סכם בשני משפטים: \"ועד הבית החליט ביום שני להחליף את המעלית בבניין ב-85 אלף שקל. העבודה תיארך שלושה שבועות ותתחיל ב-1 בדצמבר. כל דייר ישלם 2,100 שקל.\"", lang: "he", facts: [/85/, /2,?100/, /דצמבר/] },
  { id: 44, q: "Rewrite this email to sound polite: \"Send me the report now. You're late again.\"", lang: "en", facts: [/report/i, /please|would|could|appreciate|kindly/i] },
  { id: 45, q: "What can I use instead of buttermilk in a recipe?", lang: "en", facts: [/lemon|vinegar/i, /milk/i] },
  { id: 46, q: "מה אפשר לעשות עם לחם יבש?", lang: "he", facts: [/פירורי|קרוטונים|פרנץ|טוסט|בורקס|פודינג|מרק|ציפוי/] },
  { id: 47, q: "How many minutes should I rest a steak after cooking?", lang: "en", facts: [/\b(5|10|3|five|ten)\b/i] },
  { id: 48, q: "כמה קלוריות יש בגרם אחד של שומן?", lang: "he", facts: [/\b9\b|תשע/] },
];

const MODEL_LIST = [MODELS.flashLow, MODELS.flashMedium].map((m) => m.model);

async function main() {
  const [out, repsArg, concArg] = process.argv.slice(2);
  if (!out) { console.error("usage: node answer-low-vs-medium.js <output.json> [reps] [concurrency]"); process.exit(1); }
  const reps = Number(repsArg || 2), conc = Number(concArg || 3);
  const results = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, "utf8")) : [];
  const done = new Set(results.map((r) => `${r.id}|${r.model}|${r.rep}`));
  let about = "";
  try { about = aboutBlock() || ""; } catch (error) { /* no profile */ }
  // All calls, in a random order, so slow moments of the network hit both models alike.
  const jobs = [];
  for (const item of Q) for (const model of MODEL_LIST) for (let rep = 1; rep <= reps; rep++) if (!done.has(`${item.id}|${model}|${rep}`)) jobs.push({ item, model, rep });
  for (let i = jobs.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [jobs[i], jobs[j]] = [jobs[j], jobs[i]]; }
  console.log(`${jobs.length} calls to make (${results.length} already done)`);
  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const { item, model, rep } = jobs[next++];
      const t0 = Date.now();
      let answer = null, error = null;
      try { answer = await ask("agy", model, personalize([MODELS.flashMedium], item.q, about)); } catch (e) { error = String(e.message).slice(0, 200); }
      results.push({ id: item.id, model, rep, seconds: Number(((Date.now() - t0) / 1000).toFixed(1)), answer, error });
      fs.writeFileSync(out, JSON.stringify(results));
      console.log(`${results.length}/${Q.length * MODEL_LIST.length * reps}  q${item.id} ${model} #${rep} ${error ? "ERROR " + error : ((Date.now() - t0) / 1000).toFixed(1) + " s"}`);
    }
  }
  await Promise.all(Array.from({ length: conc }, worker));
}

if (require.main === module) main().catch((error) => { console.error(error); process.exit(1); });
module.exports = { Q, MODEL_LIST };
