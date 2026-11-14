// moodle-token.js
// Run ONCE by Omri (and again when Bot says the Moodle token stopped working, about every few months):
//
//   node moodle-token.js            asks for the Moodle user name and password, gets a token from Moodle, saves it in .env
//   node moodle-token.js --paste    saves a token Omri already has (pasted hidden)
//   node moodle-token.js --check    only says whether the saved token works
//
// What it does: sends the user name and password ONE time, to Moodle's own address for the phone app
// (https://moodle.bgu.ac.il/moodle/login/token.php), and gets back a TOKEN: a long secret string that stands in for the login.
// The password is typed hidden, used for that one request and never stored, printed or logged. The token is written to .env
// (MOODLE_TOKEN=..., git-ignored) and never printed. Bot then reads Moodle with it, read-only (moodle-ws.js).

const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const { httpsSend, HOST, ROOT } = require("./moodle");
const { createMoodleWs, tokenReader, formBody, USER_AGENT } = require("./moodle-ws");

const ENV_FILE = path.join(__dirname, ".env");
const TOKEN_URL = `https://${HOST}${ROOT}/login/token.php`;
const SERVICE = "moodle_mobile_app"; // the phone app's own service: the only one every student may use

// One line from the keyboard. hidden: what is typed is not shown.
function askLine(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = (s) => { if (/[\r\n]/.test(s)) process.stdout.write("\n"); }; // print nothing but the final new line
    process.stdout.write(question);
    rl.question("", (answer) => { rl.close(); resolve(answer); });
  });
}

// Put MOODLE_TOKEN=... into the .env text: replaces the old line, or adds one. Every other line stays as it is.
function setEnvLine(text, token) {
  const lines = String(text).split(/\r?\n/);
  const i = lines.findIndex((l) => /^\s*MOODLE_TOKEN\s*=/.test(l));
  if (i >= 0) lines[i] = `MOODLE_TOKEN=${token}`;
  else { if (lines.length && lines[lines.length - 1] === "") lines.pop(); lines.push("# Moodle read-only token (node moodle-token.js). A secret: never commit or share it.", `MOODLE_TOKEN=${token}`, ""); }
  return lines.join("\n");
}

// Moodle's answer to the login -> { token } or { error } in plain words. Never echoes what was sent.
function readTokenAnswer(status, text) {
  if (status === 403) return { error: "Moodle's edge refused the request (403) before Moodle was reached." };
  let j = null;
  try { j = JSON.parse(text); } catch (error) { /* below */ }
  if (!j || typeof j !== "object") return { error: `Moodle answered ${status} with something that is not JSON.` };
  if (typeof j.token === "string" && /^[A-Za-z0-9]{20,128}$/.test(j.token)) return { token: j.token };
  const code = String(j.errorcode || "");
  if (code === "invalidlogin") return { error: "Moodle said the user name or password is wrong. (If you enter Moodle through the BGU / Microsoft sign-in page and have no Moodle password of your own, this way cannot work: tell Claude Code.)" };
  return { error: `Moodle refused (${code || "no code"}): ${String(j.error || j.message || "").replace(/[\u0000-\u001f]+/g, " ").slice(0, 200)}` };
}

async function check() {
  const ws = createMoodleWs({ getToken: tokenReader(ENV_FILE) });
  if (!ws.enabled()) { console.log("No MOODLE_TOKEN in .env yet."); return false; }
  try {
    const { data } = await ws.ask("courses");
    console.log(`The token works: Moodle shows ${data.length} course(s) in progress.`);
    return true;
  } catch (error) { console.log(`The token does not work: ${error.code}: ${error.message}`); return false; }
}

async function main() {
  const mode = process.argv[2] || "";
  if (mode === "--check") { process.exitCode = (await check()) ? 0 : 1; return; }
  let token = "";
  if (mode === "--paste") {
    token = (await askLine("Paste the token (it is not shown), then Enter: ", { hidden: true })).trim();
    if (!/^[A-Za-z0-9]{20,128}$/.test(token)) { console.log("That does not look like a Moodle token (letters and digits only). Nothing was saved."); process.exitCode = 1; return; }
  } else {
    console.log("This asks Moodle for a read token. Your password goes to Moodle only, once, and is not saved anywhere.");
    const username = (await askLine("Moodle user name: ")).trim();
    const password = await askLine("Moodle password (it is not shown): ", { hidden: true });
    if (!username || !password) { console.log("Nothing typed. Nothing was saved."); process.exitCode = 1; return; }
    const body = formBody({ username, password, service: SERVICE });
    let r;
    try { r = await httpsSend({ method: "POST", url: TOKEN_URL, body, headers: { "User-Agent": USER_AGENT, Accept: "*/*", "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(body) } }); }
    catch (error) { console.log(`Moodle could not be reached: ${error.code || ""} ${String(error.message).split(password).join("***")}`); process.exitCode = 1; return; }
    const answer = readTokenAnswer(r.status, r.bytes.toString("utf8"));
    if (!answer.token) { console.log(answer.error, "Nothing was saved."); process.exitCode = 1; return; }
    token = answer.token;
  }
  let text = "";
  try { text = fs.readFileSync(ENV_FILE, "utf8"); } catch (error) { /* no .env yet */ }
  fs.writeFileSync(ENV_FILE + ".tmp", setEnvLine(text, token));
  fs.renameSync(ENV_FILE + ".tmp", ENV_FILE);
  console.log("Saved in .env as MOODLE_TOKEN (not shown). Checking it...");
  await check();
  console.log("Bot picks it up by itself; no restart is needed.");
}

if (require.main === module) main().catch((error) => { console.log("Stopped:", error.code || "", error.message); process.exitCode = 1; });

module.exports = { setEnvLine, readTokenAnswer, SERVICE };
