// webpush.js
// Sends push notifications to your phone, with built-in Node modules only (no npm package).
//
// How Web Push works:
//   1. On the phone, the page asks Chrome for a "subscription": an address at Google's push service
//      (fcm.googleapis.com) plus two keys made by the phone (p256dh and auth). The page sends it to Bot.
//   2. When a reminder is due, Bot ENCRYPTS the message for the phone (so Google can't read it),
//      SIGNS a short token that proves it comes from Bot (VAPID), and POSTs it to that address.
//   3. Google delivers it to the phone, where sw.js (the service worker) shows the notification.
// Bot only makes an OUTGOING request, so no port is ever opened on your computer.
//
// The two standards used:
//   - RFC 8291 + RFC 8188 ("aes128gcm"): the encryption. ECDH key agreement -> HKDF -> AES-128-GCM.
//     webpush.test.js checks our code against the official test vector in RFC 8291, appendix A.
//   - RFC 8292 (VAPID): the "this is from Bot" token, an ES256-signed JWT.
//
// The VAPID private key is created on first use and saved in data/vapid.json (git-ignored).
// Subscriptions are saved in data/push-subscriptions.json (git-ignored).

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const RECORD_SIZE = 4096;
const MAX_SUBSCRIPTIONS = 10;
const MAX_PAYLOAD = 3000; // push services accept about 4 KB; stay well below
const b64u = (buf) => Buffer.from(buf).toString("base64url");
const fromB64u = (text) => Buffer.from(String(text), "base64url");

// Only real browser push services. Bot will never POST to any other address, so a bad subscription
// can't be used to make Bot send requests to places it shouldn't (that attack is called SSRF).
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/, /(^|\.)push\.apple\.com$/];

// ---- Encryption (RFC 8291) ----

// Encrypts `payload` for one subscription. `asPrivate` and `salt` are only passed by the test (the RFC
// test vector fixes them); normally both are fresh random values for every message.
function encrypt(payload, { p256dh, auth }, { asPrivate, salt } = {}) {
  const uaPublic = fromB64u(p256dh);
  const authSecret = fromB64u(auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error("bad p256dh key");
  if (authSecret.length !== 16) throw new Error("bad auth secret");

  const ecdh = crypto.createECDH("prime256v1"); // a one-time key pair, made only for this message
  if (asPrivate) ecdh.setPrivateKey(asPrivate);
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const ecdhSecret = ecdh.computeSecret(uaPublic); // the same secret the phone can compute with its private key
  salt = salt || crypto.randomBytes(16);

  // Mix the shared secret with the phone's auth secret, then derive the AES key and the nonce.
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync("sha256", ecdhSecret, authSecret, keyInfo, 32));
  const cek = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));

  // One record: the text, then 0x02 ("this is the last record"), encrypted with AES-128-GCM.
  const cipher = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);

  // Header: salt (16) | record size (4) | key id length (1) | our one-time public key (65)
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, body]);
}

// ---- VAPID (RFC 8292): proving the message comes from Bot ----

function vapidHeader(endpoint, keys, { subject, now = Date.now() } = {}) {
  const audience = new URL(endpoint).origin;
  const jwtHeader = b64u(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const claims = b64u(JSON.stringify({ aud: audience, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject }));
  const unsigned = `${jwtHeader}.${claims}`;
  // ES256 needs the raw 64-byte signature (r|s), which Node calls "ieee-p1363".
  const signature = crypto.sign("sha256", Buffer.from(unsigned), { key: keys.privateKey, dsaEncoding: "ieee-p1363" });
  return `vapid t=${unsigned}.${b64u(signature)}, k=${keys.publicKey}`;
}

// Loads the VAPID key pair, or makes one the first time. publicKey is the raw 65-byte key, base64url,
// which is the form the page needs for pushManager.subscribe().
function loadVapidKeys(file) {
  let jwk;
  try {
    jwk = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    jwk = privateKey.export({ format: "jwk" });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(jwk), { mode: 0o600 });
  }
  const privateKey = crypto.createPrivateKey({ key: jwk, format: "jwk" });
  const publicKey = b64u(Buffer.concat([Buffer.from([4]), fromB64u(jwk.x), fromB64u(jwk.y)]));
  return { privateKey, publicKey };
}

// ---- Subscriptions ----

// Never trust what the page sends: keep only the three fields we need, and only for real push services.
function checkSubscription(input) {
  const endpoint = input && input.endpoint;
  const keys = input && input.keys;
  if (typeof endpoint !== "string" || endpoint.length > 1000) throw new Error("bad endpoint");
  let url;
  try { url = new URL(endpoint); } catch (error) { throw new Error("bad endpoint"); }
  if (url.protocol !== "https:" || url.port || !PUSH_HOSTS.some((re) => re.test(url.hostname))) throw new Error("not a known push service");
  if (!keys || typeof keys.p256dh !== "string" || typeof keys.auth !== "string") throw new Error("missing keys");
  if (fromB64u(keys.p256dh).length !== 65 || fromB64u(keys.auth).length !== 16) throw new Error("bad keys");
  return { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

// send(request) is injectable so tests don't hit the network; by default it is fetch().
function createPush({ dir, subject = "mailto:bot@localhost.invalid", send = defaultSend, log = () => {} }) {
  const subsFile = path.join(dir, "push-subscriptions.json");
  let keys = null;
  const getKeys = () => (keys ??= loadVapidKeys(path.join(dir, "vapid.json")));

  const read = () => {
    try { return JSON.parse(fs.readFileSync(subsFile, "utf8")); } catch (error) { return []; }
  };
  const write = (subs) => {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${subsFile}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(subs, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, subsFile); // atomic: never a half-written file
  };

  function subscribe(input) {
    const sub = checkSubscription(input);
    const subs = read().filter((s) => s.endpoint !== sub.endpoint);
    subs.push({ ...sub, added: Date.now() });
    write(subs.slice(-MAX_SUBSCRIPTIONS)); // the oldest are dropped
    return subs.length;
  }

  function unsubscribe(endpoint) {
    const subs = read();
    const kept = subs.filter((s) => s.endpoint !== endpoint);
    write(kept);
    return kept.length !== subs.length;
  }

  // Sends {title, body, tag} to every subscription. Gone subscriptions (404/410) are removed.
  async function notifyAll(message) {
    const payload = JSON.stringify(message);
    if (Buffer.byteLength(payload) > MAX_PAYLOAD) throw new Error("push message too long");
    const subs = read();
    let sent = 0;
    const gone = [];
    for (const sub of subs) {
      try {
        const status = await send({
          endpoint: sub.endpoint,
          headers: {
            TTL: "86400", // if the phone is offline, the push service keeps it for a day
            Urgency: "high",
            "Content-Encoding": "aes128gcm",
            "Content-Type": "application/octet-stream",
            Authorization: vapidHeader(sub.endpoint, getKeys(), { subject }),
          },
          body: encrypt(payload, sub.keys),
        });
        if (status === 404 || status === 410) gone.push(sub.endpoint);
        else if (status >= 200 && status < 300) sent++;
        else log(`[push] ${new URL(sub.endpoint).hostname} answered ${status}`);
      } catch (error) {
        log(`[push] failed: ${error.message}`);
      }
    }
    if (gone.length) write(read().filter((s) => !gone.includes(s.endpoint)));
    return { sent, removed: gone.length, total: subs.length };
  }

  return { publicKey: () => getKeys().publicKey, subscribe, unsubscribe, notifyAll, count: () => read().length };
}

async function defaultSend({ endpoint, headers, body }) {
  const res = await fetch(endpoint, { method: "POST", headers, body, signal: AbortSignal.timeout(15000) });
  return res.status;
}

module.exports = { encrypt, vapidHeader, loadVapidKeys, checkSubscription, createPush, PUSH_HOSTS };
