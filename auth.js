// auth.js
// The phone login. On this computer Bot needs no login (only this computer can reach 127.0.0.1).
// The phone reaches Bot through Tailscale, which forwards to 127.0.0.1, so for those requests
// "it comes from localhost" proves nothing. They must log in.
//
// Settings, in .env (git-ignored, never committed):
//   BOT_PHONE_HOST=my-pc.tailXXXX.ts.net   the exact Tailscale name of this PC
//   BOT_PHONE_TOKEN=<a long random password> you type it once on the phone
//   BOT_ADMIN_PIN=<at least 6 characters>   optional second lock, see below
// If either is missing, phone access is OFF and only this computer can use Bot.
//
// How logging in works:
//   - The phone sends the token once. We compare it in constant time (crypto.timingSafeEqual), so
//     the time the check takes doesn't leak how many characters were right.
//   - We answer with a COOKIE that the browser sends back on every request. It is
//       HttpOnly  -> the page's JavaScript can't read it (a bug in the page can't leak it)
//       Secure    -> only sent over HTTPS
//       SameSite=Strict -> never sent by requests that other websites trigger
//     Its value is an HMAC of the token (a keyed fingerprint), so changing the token in .env logs
//     every phone out, and the token itself is never stored on the phone.
//   - After 5 wrong tokens, logins are refused for 15 minutes, so the token can't be guessed.
//
// The PIN: Improve Bot and Restart change the code that runs on this computer, so on the phone they
// need more than the saved login: someone holding your unlocked phone is logged in too. The PIN is
// never stored on the phone. Typing it gives a random "unlocked" value that the server keeps in MEMORY
// for 15 minutes, so a restart locks it again. It has its own lockout. Without BOT_ADMIN_PIN those
// features stay PC-only.

const crypto = require("node:crypto");
const fs = require("node:fs");

const COOKIE = "bot_session";
const MIN_TOKEN = 24;
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;
const COOKIE_DAYS = 30;
const ADMIN_COOKIE = "bot_admin";
const MIN_PIN = 6;
const UNLOCK_MS = 15 * 60 * 1000;

// Minimal .env reader: KEY=value lines, # comments.
function parseEnv(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith("#")) out[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return out;
}

function loadPhoneConfig(envFile) {
  let env = {};
  try { env = parseEnv(fs.readFileSync(envFile, "utf8")); } catch (error) { /* no .env: phone access off */ }
  const host = String(env.BOT_PHONE_HOST || "").toLowerCase();
  const token = String(env.BOT_PHONE_TOKEN || "");
  if (!host || !token) return { enabled: false, reason: "BOT_PHONE_HOST or BOT_PHONE_TOKEN is not set in .env" };
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.ts\.net$/.test(host)) return { enabled: false, reason: "BOT_PHONE_HOST must be this PC's Tailscale name, ending in .ts.net" };
  if (token.length < MIN_TOKEN) return { enabled: false, reason: `BOT_PHONE_TOKEN must be at least ${MIN_TOKEN} characters` };
  const pin = String(env.BOT_ADMIN_PIN || "");
  return { enabled: true, host, token, ...(pin.length >= MIN_PIN ? { adminPin: pin } : {}) };
}

const sameText = (a, b) => {
  const x = crypto.createHash("sha256").update(String(a)).digest();
  const y = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(x, y); // hashing first makes the lengths equal, as timingSafeEqual needs
};

function readCookie(req, name) {
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

function createAuth({ config, now = () => Date.now() }) {
  const sessionValue = config.enabled ? crypto.createHmac("sha256", config.token).update("bot-phone-session-v1").digest("base64url") : null;
  let fails = [];
  let pinFails = [];
  let unlocked = null; // { value, until }, in memory only

  const recent = (list) => list.filter((t) => now() - t < LOCK_MS);
  const lockTime = (list) => (list.length >= MAX_FAILS ? list[0] + LOCK_MS : 0);
  const lockedUntil = () => lockTime((fails = recent(fails)));
  const adminCookie = (value, seconds) => `${ADMIN_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${seconds}`;

  return {
    enabled: config.enabled,
    host: config.enabled ? config.host : null,
    reason: config.reason,
    adminEnabled: Boolean(config.enabled && config.adminPin),
    isUnlocked(req) {
      const value = readCookie(req, ADMIN_COOKIE);
      return Boolean(unlocked && value && now() < unlocked.until && sameText(value, unlocked.value));
    },
    // Returns { ok, cookie } or { ok: false, status, error }.
    unlock(pin) {
      if (!config.enabled || !config.adminPin) return { ok: false, status: 403, error: "no PIN is set" };
      const until = lockTime((pinFails = recent(pinFails)));
      if (until) return { ok: false, status: 429, error: `too many wrong PINs, try again in ${Math.ceil((until - now()) / 60000)} min` };
      if (typeof pin !== "string" || !sameText(pin, config.adminPin)) {
        pinFails.push(now());
        return { ok: false, status: 401, error: "wrong PIN" };
      }
      pinFails = [];
      unlocked = { value: crypto.randomBytes(32).toString("base64url"), until: now() + UNLOCK_MS };
      return { ok: true, cookie: adminCookie(unlocked.value, UNLOCK_MS / 1000) };
    },
    lock() {
      unlocked = null;
      return adminCookie("", 0);
    },
    isLoggedIn(req) {
      const value = readCookie(req, COOKIE);
      return Boolean(sessionValue && value && sameText(value, sessionValue));
    },
    // Returns { ok, cookie } or { ok: false, status, error }.
    login(token) {
      if (!config.enabled) return { ok: false, status: 403, error: "phone access is off" };
      const until = lockedUntil();
      if (until) return { ok: false, status: 429, error: `too many wrong tokens, try again in ${Math.ceil((until - now()) / 60000)} min` };
      if (typeof token !== "string" || !sameText(token, config.token)) {
        fails.push(now());
        return { ok: false, status: 401, error: "wrong token" };
      }
      fails = [];
      return { ok: true, cookie: `${COOKIE}=${sessionValue}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${COOKIE_DAYS * 86400}` };
    },
    logoutCookie: () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`,
  };
}

module.exports = { parseEnv, loadPhoneConfig, createAuth, readCookie, COOKIE, MAX_FAILS, LOCK_MS, MIN_TOKEN, UNLOCK_MS };
