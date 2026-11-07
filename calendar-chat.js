// calendar-chat.js
// The glue between the chat and calendar.js, for READING the calendar only (proof, 2026-11-05).
//
// The flow: the front desk model only EXTRACTS a start day and a number of days from the message
// (it never sees any event). Code checks them (checkRequest), calendar.js fetches the events,
// and CODE writes the reply (formatEvents). No model ever reads an event title, so a title that
// says "ignore your rules" is just text on the screen.
//
// Nothing here can add, change or delete an event: calendar.js has no such function for reading,
// and this file imports only listEvents.

const calendar = require("./calendar");

const MAX_DAYS = 14;

// Checks what the model extracted. Returns { from: "2026-11-05", days: 1..14 } or throws.
function checkRequest({ from, days }) {
  if (typeof from !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error("the day is missing or not a date");
  const d = new Date(`${from}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== from) throw new Error("that date does not exist");
  const n = Number(days);
  if (!Number.isInteger(n) || n < 1 || n > MAX_DAYS) throw new Error(`days must be a whole number from 1 to ${MAX_DAYS}`);
  return { from, days: n };
}

const dayName = (iso) => new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
const hhmm = (dateTime) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(dateTime));
const localDay = (dateTime) => {
  const p = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(dateTime));
  return p; // en-CA prints 2026-11-05
};

// Plain text, one block per day, in time order. Titles are cut and stripped of control characters.
function formatEvents(events, { from, days }) {
  const clean = (s) => String(s).replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 120);
  const byDay = new Map();
  for (let i = 0; i < days; i++) {
    const d = new Date(`${from}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    byDay.set(d.toISOString().slice(0, 10), []);
  }
  for (const e of events) {
    const timed = typeof e.start === "string" && e.start.includes("T");
    const key = timed ? localDay(e.start) : e.start;
    if (!byDay.has(key)) continue;
    byDay.get(key).push(timed ? `${hhmm(e.start)}-${hhmm(e.end)}  ${clean(e.summary)}` : `all day  ${clean(e.summary)}`);
  }
  const blocks = [];
  for (const [day, lines] of byDay) blocks.push(`${dayName(day)}\n${lines.length ? lines.map((l) => "  " + l).join("\n") : "  (nothing)"}`);
  return blocks.join("\n\n");
}

// Plain-English version of the errors a person can fix. Everything else is passed on as it is.
function friendlyError(error) {
  const text = String(error && error.message || error);
  if (/invalid_grant|Not signed in/.test(text)) return "Bot's Google login has expired (Google ends it every 7 days while the app is in Testing mode). On the PC run: node calendar.js login";
  if (/No Google client found/.test(text)) return "Google Calendar is not connected yet. It needs a one-time setup on the PC; the steps are in calendar-setup.md.";
  return `Bot could not read the calendar: ${text}`;
}

// The real fetch. Tests pass their own `list`.
async function readCalendar(request, { list = calendar.listEvents, credentials } = {}) {
  const { from, days } = checkRequest(request);
  const events = await list(from, { credentials: credentials || calendar.loadCredentials() }, days);
  return { from, days, events, text: formatEvents(events, { from, days }) };
}

module.exports = { checkRequest, formatEvents, friendlyError, readCalendar, MAX_DAYS };
