// morning.js
// The morning brief: once a day, Bot tells you what today holds (calendar and reminders).
//
// It is OFF until you turn it on in the page, and only the page can turn it on: no model and nothing in memory can reach
// these settings. CODE writes the brief, like the calendar replies: no model reads your events, and it costs no quota.
//
// The brief is saved as a new chat, so it waits for you. The phone push only says how much is on today, never the titles,
// because a push shows on the lock screen. If the computer was off at that time, the brief goes out when Bot next runs,
// but only for CATCH_UP_HOURS: a morning brief at night helps nobody.
//
// Settings live in data/morning.json (git-ignored): { on, time, lastDay }. lastDay is saved BEFORE sending, so a crash can
// never send the brief twice.

const fs = require("node:fs");
const path = require("node:path");
const { localIso, formatWhen } = require("./reminders");
const { readCalendar, friendlyError } = require("./calendar-chat");

const TICK_MS = 30 * 1000;
const CATCH_UP_HOURS = 4;
const DEFAULT_TIME = "08:00";
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const minutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const clean = (text) => String(text).replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function createMorning({ file, store, reminders, push, calendar = readCalendar, now = () => Date.now(), timezone = localZone(), log = () => {} }) {
  if (!file) throw new Error("createMorning needs a file");
  let timer = null;

  function read() {
    try {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      return { on: data.on === true, time: TIME_PATTERN.test(data.time) ? data.time : DEFAULT_TIME, lastDay: typeof data.lastDay === "string" ? data.lastDay : "" };
    } catch (error) {
      return { on: false, time: DEFAULT_TIME, lastDay: "" }; // missing or unreadable: off
    }
  }

  function write(settings) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = file + ".tmp";
    fs.writeFileSync(temp, JSON.stringify(settings));
    fs.renameSync(temp, file);
  }

  // Today in the local time zone, like "2026-11-06", and the minutes since midnight.
  const today = () => localIso(now(), timezone).slice(0, 10);
  const minuteOfDay = () => minutes(localIso(now(), timezone).slice(11, 16));

  // Only the two settings a person chooses; each is checked. Anything else in the request is ignored.
  function update({ on, time }) {
    const settings = read();
    const wasOn = settings.on;
    if (on !== undefined) {
      if (typeof on !== "boolean") throw new Error("on must be true or false");
      settings.on = on;
    }
    if (time !== undefined) {
      if (typeof time !== "string" || !TIME_PATTERN.test(time)) throw new Error("the time must look like 08:00");
      settings.time = time;
    }
    // Turned on after today's time has passed: it starts tomorrow, instead of firing the moment you tap ("Show me one now" is for that).
    if (on === true && !wasOn && minuteOfDay() >= minutes(settings.time)) settings.lastDay = today();
    write(settings);
    return { on: settings.on, time: settings.time };
  }

  // The text of today's brief. A calendar problem (the login expires every 7 days) is one line in it, never a failure.
  async function compose() {
    const day = today();
    const lines = [];
    let events = 0;
    try {
      const got = await calendar({ from: day, days: 1 });
      events = got.events.length;
      lines.push(events ? got.text : "Nothing on your calendar today.");
    } catch (error) {
      lines.push(friendlyError(error));
    }
    const pending = reminders.list().filter((r) => r.status === "pending" && localIso(r.at, timezone).slice(0, 10) === day);
    if (pending.length) lines.push("Reminders today\n" + pending.map((r) => `  ${formatWhen(r.at, r.timezone).split(", ").pop()}  ${clean(r.text)}`).join("\n"));
    const missed = reminders.list().filter((r) => r.status === "fired");
    if (missed.length) lines.push("Reminders you have not seen yet\n" + missed.map((r) => `  ${clean(r.text)}`).join("\n"));
    return { text: `Good morning. Here is your day.\n\n${lines.join("\n\n")}`, summary: `Today: ${plural(events, "event")}, ${plural(pending.length, "reminder")}.` };
  }

  // Writes today's brief into a new chat and tells the phones.
  async function send() {
    const { text, summary } = await compose();
    const title = `Morning brief, ${today()}`;
    const chat = store.create(title);
    const result = { mode: "single", rule: "morning brief", reason: "you turned on the morning brief", chain: [], used: { provider: "code", model: "no model" }, answer: text, seconds: 0 };
    store.append(chat.id, [{ role: "assistant", text, result, at: now() }]);
    log("[morning] brief saved");
    try {
      await push.notifyAll({ title: "Your morning brief", body: summary, tag: `morning-${today()}` });
    } catch (error) {
      log(`[morning] push failed: ${error.message}`);
    }
    return { conversationId: chat.id };
  }

  // Sends today's brief if it is on, the time has come and it was not sent yet. Safe to call at any time.
  async function tick() {
    const settings = read();
    const start = minutes(settings.time);
    const minute = minuteOfDay();
    if (!settings.on || settings.lastDay === today() || minute < start || minute > start + CATCH_UP_HOURS * 60) return false;
    write({ ...settings, lastDay: today() });
    await send();
    return true;
  }

  function start(intervalMs = TICK_MS) {
    if (timer) return;
    const run = () => tick().catch((error) => log(`[morning] failed: ${error.message}`));
    run();
    timer = setInterval(run, intervalMs);
    timer.unref(); // do not keep the program alive just for this timer
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  // The web routes. All of server.js's checks (host, origin, phone login) have already run. Returns true if it answered.
  async function handle(req, res, url, { sendJson, readJsonBody }) {
    if (req.method === "GET" && url.pathname === "/api/morning") {
      const { on, time } = read();
      sendJson(res, 200, { on, time, devices: push.count() });
      return true;
    }
    if (req.method === "POST" && url.pathname === "/api/morning") {
      const input = await readJsonBody(req, res);
      if (!input) return true;
      try {
        sendJson(res, 200, update(input));
      } catch (error) {
        sendJson(res, 400, { error: error.message });
      }
      return true;
    }
    // "Show me one now": does not count as today's brief.
    if (req.method === "POST" && url.pathname === "/api/morning/now") {
      if (!(await readJsonBody(req, res))) return true;
      try {
        sendJson(res, 200, await send());
      } catch (error) {
        sendJson(res, 500, { error: error.message });
      }
      return true;
    }
    return false;
  }

  return { settings: () => { const { on, time } = read(); return { on, time }; }, update, compose, send, tick, start, stop, handle };
}

module.exports = { createMorning, DEFAULT_TIME, CATCH_UP_HOURS };
