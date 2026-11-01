// reminders.js
// Reminders: "remind me tomorrow at 9 to call the bank".
//
// A reminder is { id, text, at, timezone, created, status, ... } saved in data/reminders.json
// (git-ignored, it is private). `at` is the moment it is due, in milliseconds since 1970 (UTC).
//   status "pending"  -> waiting for its time
//   status "fired"    -> its time came; `delivered` becomes true once the web page has shown it
//
// The scheduler checks every 30 seconds and fires what is due. If the computer was off (or Bot was
// not running) at the due time, the reminder fires at the next check after Bot starts, marked
// `late: true`. That is the "catch-up".
//
// WHO tells you: the scheduler calls `notify(reminder)`, a function you pass in (so tests can use a
// fake). The web page also polls for fired-but-undelivered reminders and shows them with the
// browser Notification API; that is the delivery for now. Push to the phone comes later.
//
// Nothing here is cached in memory: every call reads the file and writes it back, so two parts of
// the program (the chat and the scheduler) always see the same data.
//
// Input is never trusted (it comes from a language model or from the network): see parseWhen and
// cleanText.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ID_PATTERN = /^[a-f0-9]{16}$/;
const MAX_TEXT = 500;
const MAX_PENDING = 100;
const MAX_HORIZON_MS = 5 * 365 * 24 * 3600 * 1000; // a reminder can be at most 5 years ahead
const LATE_AFTER_MS = 2 * 60 * 1000; // fired more than 2 minutes after its time -> "late"
const KEEP_DELIVERED_MS = 7 * 24 * 3600 * 1000; // delivered reminders are forgotten after a week
const TICK_MS = 30 * 1000;

// ---- Checking the input ----

function cleanText(text) {
  if (typeof text !== "string") throw new Error("the reminder needs some text");
  const clean = text.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) throw new Error("the reminder needs some text");
  if (clean.length > MAX_TEXT) throw new Error(`the reminder text is longer than ${MAX_TEXT} characters`);
  return clean;
}

// Is this a real IANA time zone name such as "Asia/Jerusalem"? (Intl throws for anything else.)
function validTimezone(timezone) {
  if (typeof timezone !== "string" || !timezone || timezone.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch (error) {
    return false;
  }
}

// How far ahead of UTC the clocks in `timezone` are at the moment `ms` (in ms; Jerusalem in summer is +3h).
function offsetMs(timezone, ms) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
  }).formatToParts(new Date(ms));
  const n = (type) => Number(parts.find((p) => p.type === type).value);
  const asIfUtc = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
  return asIfUtc - Math.floor(ms / 1000) * 1000;
}

// Turns the model's time into milliseconds and checks it is a REAL moment in the future.
//   iso      "2026-11-02T09:00:00" (wall-clock time in `timezone`) or with an offset/Z ("...+02:00")
//   timezone an IANA name; always required, so a missing zone can never silently mean UTC
// Throws an Error with a plain message when the time is not usable.
function parseWhen(iso, timezone, now = Date.now()) {
  if (!validTimezone(timezone)) throw new Error("unknown time zone");
  if (typeof iso !== "string") throw new Error("the time is missing");
  const m = iso.trim().match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:\d{2})?$/);
  if (!m) throw new Error("the time is not in ISO format (YYYY-MM-DDTHH:MM)");
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] || "0"].map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const back = new Date(guess);
  // Date.UTC quietly turns "February 30" into "March 2". Refuse such dates instead.
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d || back.getUTCHours() !== h || back.getUTCMinutes() !== mi) {
    throw new Error("that date or time does not exist");
  }
  let at;
  if (m[7]) {
    const sign = m[7] === "Z" ? 0 : (m[7][0] === "-" ? -1 : 1) * (Number(m[7].slice(1, 3)) * 60 + Number(m[7].slice(4, 6))) * 60000;
    at = guess - sign;
  } else {
    // Wall-clock time in the zone: subtract the zone's offset (twice, because the offset itself depends on the date).
    const first = guess - offsetMs(timezone, guess);
    at = guess - offsetMs(timezone, first);
  }
  if (!Number.isFinite(at)) throw new Error("the time is not usable");
  if (at <= now) throw new Error("that time is already in the past");
  if (at > now + MAX_HORIZON_MS) throw new Error("that time is more than 5 years away");
  return at;
}

// A readable time for messages, in the reminder's own zone: "Mon, 2 Nov, 09:00".
function formatWhen(at, timezone) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(at));
}

// ---- The store ----

function createReminders({ file, notify = () => {}, now = () => Date.now() } = {}) {
  if (!file) throw new Error("createReminders needs a file");
  let timer = null;

  function read() {
    try {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      return Array.isArray(data) ? data : [];
    } catch (error) {
      return []; // missing or unreadable
    }
  }

  // Write to a temporary file, then rename it into place, so a stop halfway never leaves half a file.
  function write(items) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = file + ".tmp";
    fs.writeFileSync(temp, JSON.stringify(items));
    fs.renameSync(temp, file);
  }

  const byTime = (a, b) => a.at - b.at;

  function create({ text, at, timezone }) {
    const clean = cleanText(text);
    const when = parseWhen(at, timezone, now());
    const items = read();
    if (items.filter((r) => r.status === "pending").length >= MAX_PENDING) throw new Error(`too many pending reminders (max ${MAX_PENDING})`);
    const reminder = { id: crypto.randomBytes(8).toString("hex"), text: clean, at: when, timezone, created: now(), status: "pending", delivered: false };
    write([...items, reminder]);
    return reminder;
  }

  // Everything that is still relevant: pending ones, and fired ones the page has not shown yet.
  function list() {
    return read().filter((r) => r.status === "pending" || !r.delivered).sort(byTime);
  }

  // Fired but not yet shown by the page.
  const undelivered = () => read().filter((r) => r.status === "fired" && !r.delivered).sort(byTime);

  // Removes a reminder (pending or fired). Returns false if there is no such id.
  function cancel(id) {
    if (typeof id !== "string" || !ID_PATTERN.test(id)) return false;
    const items = read();
    const rest = items.filter((r) => r.id !== id);
    if (rest.length === items.length) return false;
    write(rest);
    return true;
  }

  // The page calls this after showing a fired reminder, so it is not shown twice.
  function acknowledge(id) {
    if (typeof id !== "string" || !ID_PATTERN.test(id)) return false;
    const items = read();
    const item = items.find((r) => r.id === id && r.status === "fired" && !r.delivered);
    if (!item) return false;
    item.delivered = true;
    write(items);
    return true;
  }

  // Fires everything that is due. Safe to call at any time. Returns the reminders it fired.
  function tick() {
    const t = now();
    let items = read();
    const fired = [];
    let changed = false;
    for (const r of items) {
      if (r.status === "pending" && r.at <= t) {
        r.status = "fired";
        r.firedAt = t;
        r.late = t - r.at > LATE_AFTER_MS;
        fired.push({ ...r });
        changed = true;
      }
    }
    const kept = items.filter((r) => !(r.status === "fired" && r.delivered && t - r.firedAt > KEEP_DELIVERED_MS));
    if (kept.length !== items.length) { items = kept; changed = true; }
    // Save BEFORE notifying: if notify crashes, a reminder is never fired twice.
    if (changed) write(items);
    for (const r of fired) {
      try {
        Promise.resolve(notify(r)).catch(() => {});
      } catch (error) { /* a failing notify must never stop the scheduler */ }
    }
    return fired;
  }

  // Starts checking every 30 seconds; the first check happens at once (that is the catch-up).
  function start(intervalMs = TICK_MS) {
    if (timer) return;
    tick();
    timer = setInterval(tick, intervalMs);
    timer.unref(); // do not keep the program alive just for this timer
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { create, list, undelivered, cancel, acknowledge, tick, start, stop };
}

// The one shared store Bot uses. It is created on first use, so loading this file touches no disk.
let shared = null;
function getReminders() {
  return (shared ??= createReminders({
    file: path.join(__dirname, "data", "reminders.json"),
    notify: (r) => console.log(`[reminder] ${r.text}${r.late ? " (late)" : ""}`),
  }));
}

module.exports = { createReminders, getReminders, parseWhen, formatWhen, cleanText, validTimezone, ID_PATTERN, MAX_TEXT, MAX_PENDING, TICK_MS };
