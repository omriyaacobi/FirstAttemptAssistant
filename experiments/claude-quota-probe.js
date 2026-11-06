// experiments/claude-quota-probe.js (run by hand: node experiments/claude-quota-probe.js)
// Shows what Bot's Claude quota probe sees RIGHT NOW: one tiny Claude Haiku call (a few tokens of your Claude plan) in
// stream-json mode, and the rate_limit_event rows quota.js makes from it. Run it from the folder that has your .env
// (the Claude login token), or it will report "OAuth session expired". It prints no token.
const { probeClaude, lowPools } = require("../quota");

const keepAlive = setInterval(() => {}, 1000); // the probe does not keep a program alive by itself
probeClaude().then(({ rows, errorText }) => {
  console.log("rows:", rows.length ? rows : "(none: no rate_limit_event was printed)");
  if (errorText) console.log("the call itself reported:", errorText);
  console.log("low pools:", lowPools(rows));
  clearInterval(keepAlive);
});
