// End to end with the REAL handleTask (real front desk + real answer model). Usage: node experiments/e2e-schnitzel.js [gapSeconds]
const { handleTask } = require("../core");
const msg = "שניצלים עדיף לחמם מהמקרר במיקרו או בנינגה ?";
(async () => {
  for (let i = 1; i <= 3; i++) {
    const t = Date.now();
    const r = await handleTask(msg, { log: (l) => { if (/^\[(timing|frontdesk\] decision)/.test(l)) console.log("  " + l); } });
    console.log(`run ${i}: ${((Date.now() - t) / 1000).toFixed(1)} s, answered by ${r.used && r.used.model}`);
    await new Promise((x) => setTimeout(x, Number(process.argv[2] || 10) * 1000));
  }
  process.exit(0);
})();
