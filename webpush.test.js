// webpush.test.js
// Tests the push encryption against the official example in RFC 8291 (appendix A), the VAPID
// signature, and the subscription checks. No network: sending uses a fake.
// Run with:  node --test

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { encrypt, vapidHeader, loadVapidKeys, checkSubscription, createPush } = require("./webpush");

const b = (text) => Buffer.from(text, "base64url");

// RFC 8291 appendix A
const RFC = {
  plaintext: "When I grow up, I want to be a watermelon",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  message: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

// What the phone does: decrypt with its private key. Used to check round trips.
function decrypt(message, uaPrivate, authSecret) {
  const salt = message.subarray(0, 16);
  const idlen = message[20];
  const asPublic = message.subarray(21, 21 + idlen);
  const body = message.subarray(21 + idlen);
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.setPrivateKey(uaPrivate);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), ecdh.getPublicKey(), asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync("sha256", ecdh.computeSecret(asPublic), authSecret, keyInfo, 32));
  const cek = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const decipher = crypto.createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(body.subarray(-16));
  const plain = Buffer.concat([decipher.update(body.subarray(0, -16)), decipher.final()]);
  assert.strictEqual(plain[plain.length - 1], 2); // "last record" marker
  return plain.subarray(0, -1).toString();
}

function phoneKeys() {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  return { priv: ecdh.getPrivateKey(), auth, sub: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: auth.toString("base64url") } };
}

test("encryption matches the RFC 8291 test vector byte for byte", () => {
  const out = encrypt(RFC.plaintext, { p256dh: RFC.uaPublic, auth: RFC.auth }, { asPrivate: b(RFC.asPrivate), salt: b(RFC.salt) });
  assert.strictEqual(out.toString("base64url"), RFC.message);
});

test("the phone can decrypt what we send (round trip with fresh keys)", () => {
  const phone = phoneKeys();
  const out = encrypt('{"title":"Bot","body":"call the bank"}', phone.sub);
  assert.strictEqual(decrypt(out, phone.priv, phone.auth), '{"title":"Bot","body":"call the bank"}');
});

test("every message uses a new salt and one-time key", () => {
  const phone = phoneKeys();
  assert.notDeepStrictEqual(encrypt("x", phone.sub).subarray(0, 86), encrypt("x", phone.sub).subarray(0, 86));
});

test("VAPID token is a valid ES256 JWT for the push service's origin", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-push-"));
  const keys = loadVapidKeys(path.join(dir, "vapid.json"));
  const header = vapidHeader("https://fcm.googleapis.com/fcm/send/abc", keys, { subject: "mailto:a@b.invalid", now: 1_000_000_000_000 });
  const [, token, k] = header.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.strictEqual(k, keys.publicKey);
  const [h, c, s] = token.split(".");
  const claims = JSON.parse(b(c).toString());
  assert.strictEqual(claims.aud, "https://fcm.googleapis.com");
  assert.strictEqual(claims.exp, 1_000_000_000 + 12 * 3600);
  const publicKey = crypto.createPublicKey({ key: { kty: "EC", crv: "P-256", x: b(k).subarray(1, 33).toString("base64url"), y: b(k).subarray(33).toString("base64url") }, format: "jwk" });
  assert.ok(crypto.verify("sha256", Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, b(s)));
});

test("VAPID keys are made once and then reused", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bot-push-")), "vapid.json");
  assert.strictEqual(loadVapidKeys(file).publicKey, loadVapidKeys(file).publicKey);
  assert.strictEqual(b(loadVapidKeys(file).publicKey).length, 65);
});

test("SECURITY: subscriptions are only accepted for real push services over https", () => {
  const { sub } = phoneKeys();
  assert.ok(checkSubscription({ endpoint: "https://fcm.googleapis.com/fcm/send/x", keys: sub }));
  for (const endpoint of ["http://fcm.googleapis.com/x", "https://evil.example/x", "https://fcm.googleapis.com.evil.example/x", "https://127.0.0.1/x", "https://fcm.googleapis.com:8443/x", "nonsense"]) {
    assert.throws(() => checkSubscription({ endpoint, keys: sub }), /endpoint|push service/, endpoint);
  }
  assert.throws(() => checkSubscription({ endpoint: "https://fcm.googleapis.com/x", keys: { p256dh: "short", auth: sub.auth } }), /bad keys/);
});

test("notifyAll encrypts for each phone, and forgets subscriptions the push service says are gone", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-push-"));
  const a = phoneKeys();
  const gone = phoneKeys();
  const sent = [];
  const push = createPush({
    dir,
    send: async (req) => { sent.push(req); return req.endpoint.endsWith("/gone") ? 410 : 201; },
  });
  push.subscribe({ endpoint: "https://fcm.googleapis.com/fcm/send/a", keys: a.sub });
  push.subscribe({ endpoint: "https://fcm.googleapis.com/fcm/send/gone", keys: gone.sub });
  const result = await push.notifyAll({ title: "Bot", body: "call the bank" });
  assert.deepStrictEqual(result, { sent: 1, removed: 1, total: 2 });
  assert.strictEqual(push.count(), 1);
  assert.strictEqual(sent[0].headers["Content-Encoding"], "aes128gcm");
  assert.match(sent[0].headers.Authorization, /^vapid t=/);
  assert.deepStrictEqual(JSON.parse(decrypt(sent[0].body, a.priv, a.auth)), { title: "Bot", body: "call the bank" });
});

test("subscribing the same phone twice keeps one entry", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-push-"));
  const push = createPush({ dir, send: async () => 201 });
  const { sub } = phoneKeys();
  push.subscribe({ endpoint: "https://fcm.googleapis.com/fcm/send/a", keys: sub });
  push.subscribe({ endpoint: "https://fcm.googleapis.com/fcm/send/a", keys: sub });
  assert.strictEqual(push.count(), 1);
  assert.strictEqual(push.unsubscribe("https://fcm.googleapis.com/fcm/send/a"), true);
  assert.strictEqual(push.count(), 0);
});
