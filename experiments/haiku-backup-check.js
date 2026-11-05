// experiments/haiku-backup-check.js (run by hand: node --test experiments/haiku-backup-check.js)
// A REAL test of the backup front desk: the Gemini desk is forced to fail, and the real Claude Haiku (through the real
// `claude -p`) must make the decision for a calendar message and for a reminder message. Each call takes about 4 s.
// It lives here, not with the normal tests, because the test suite (also the one Improve Bot runs) must not spend quota or need the network.
// It needs Claude's login token (CLAUDE_CODE_OAUTH_TOKEN in .env or in the environment); without one it is skipped,
// so a checkout that has no .env does not fail.

const test = require("node:test");
const assert = require("node:assert");
const { decide } = require("../frontdesk");
const { claudeEnv } = require("../providers");

const hasLogin = Boolean(claudeEnv().CLAUDE_CODE_OAUTH_TOKEN);
const NOW = Date.UTC(2026, 10, 5, 12, 0, 0); // Thursday 2026-11-05 14:00 in Jerusalem
const TZ = "Asia/Jerusalem";
const geminiDown = async () => { throw new Error("agy is down (forced by the test)"); };

test("REAL backup: with Gemini failing, Claude Haiku decides a calendar message", { skip: !hasLogin && "no Claude token", timeout: 90000 }, async () => {
  const logs = [];
  const d = await decide("What do I have tomorrow?", { askStructured: geminiDown, now: NOW, timezone: TZ, log: (l) => logs.push(l) });
  assert.strictEqual(d.via, "haiku");
  assert.strictEqual(d.action, "calendar");
  assert.deepStrictEqual(d.calendar, { from: "2026-11-06", days: 1 });
  assert.match(logs[0], /Claude Haiku decides instead/);
});

test("REAL backup: with Gemini failing, Claude Haiku decides a reminder message (checked local time)", { skip: !hasLogin && "no Claude token", timeout: 90000 }, async () => {
  const d = await decide("תזכיר לי מחר ב-9 בבוקר להתקשר לבנק", { askStructured: geminiDown, now: NOW, timezone: TZ });
  assert.strictEqual(d.via, "haiku");
  assert.strictEqual(d.action, "remind");
  assert.strictEqual(d.reminder.at, Date.UTC(2026, 10, 6, 7, 0, 0)); // 2026-11-06 09:00 in Jerusalem (UTC+2)
  assert.strictEqual(d.reminder.timezone, TZ);
  assert.ok(d.reminder.text.length > 0);
});
