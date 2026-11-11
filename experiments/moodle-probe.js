// experiments/moodle-probe.js
// One LOGIN TEST against BGU Moodle with MOODLE_USER / MOODLE_PASS (or MOODLE_COOKIE) from .env. Read-only (moodle.js).
// It prints ONLY: the hosts it went through, what the login page looks like (yes/no facts), whether it ended logged in,
// and how many courses it found. Never the user name, the password, the cookie or any course name.
//
//   node experiments/moodle-probe.js [path-to-.env]        (default: the .env next to server.js)

const path = require("node:path");
const { createMoodle, loadMoodleConfig, describeLoginPage, httpsSend, USER_AGENT, HOST, ROOT } = require("../moodle");

// --look: no credentials at all, only GET the login page and describe it (is it a plain form? another site? a CAPTCHA?)
async function look() {
  const url = `https://${HOST}${ROOT}/login/index.php`;
  const r = await httpsSend({ method: "GET", url, headers: { "User-Agent": USER_AGENT, Accept: "*/*" } });
  console.log("GET /moodle/login/index.php ->", r.status, r.headers.location ? `redirect to ${new URL(r.headers.location, url).hostname}` : "");
  const text = r.bytes.toString("utf8");
  if (r.status === 403 && /edgesuite|Access Denied/i.test(text)) console.log("Blocked by the site's edge (Akamai 'Access Denied'): Moodle itself was not reached.");
  if (r.status === 200) console.log("Login page:", JSON.stringify(describeLoginPage(text, url)));
}

async function main() {
  if (process.argv[2] === "--look") return look();
  const envFile = process.argv[2] || path.join(__dirname, "..", ".env");
  const cfg = loadMoodleConfig(envFile);
  if (!cfg.enabled) { console.log(`Not run: ${cfg.reason} (file: ${envFile})`); return; }
  console.log(`Using: ${cfg.cookie ? "MOODLE_COOKIE" : "MOODLE_USER + MOODLE_PASS"} from ${envFile}`);
  const m = createMoodle(cfg);
  const r = await m.login();
  console.log("Hosts visited:", r.hosts.join(" -> "));
  if (r.page) {
    const p = r.page;
    console.log("Login page:", JSON.stringify({ passwordForm: p.hasPasswordForm, usernameField: p.hasUsernameField, formPostsTo: p.formHost, logintoken: p.hasLoginToken, captchaMarker: p.captcha, otherSignInSites: p.identityProviders, errorShown: p.errorShown }));
  }
  if (!r.ok) {
    console.log("Logged in: NO, reason:", r.reason, r.offsite ? `(sent to ${r.offsite})` : "", r.finalPath ? `(ended at ${r.finalPath})` : "");
    return;
  }
  console.log(`Logged in: YES (via ${r.via})`);
  // courses: Moodle's own JSON call first, then the links on the dashboard as a second opinion
  try {
    const [data] = await m.ajax({ methodname: "core_course_get_enrolled_courses_by_timeline_classification", args: { offset: 0, limit: 0, classification: "all", sort: "fullname" } });
    console.log("Courses (ajax, all):", Array.isArray(data && data.courses) ? data.courses.length : "unexpected answer");
  } catch (error) { console.log("Courses (ajax): failed -", error.code, error.message); }
  try {
    const { html } = await m.page("/my/courses.php");
    const ids = new Set([...html.matchAll(/course\/view\.php\?id=(\d+)/g)].map((x) => x[1]));
    console.log("Course links on /my/courses.php:", ids.size, "(0 is normal if the list is drawn by JavaScript)");
  } catch (error) { console.log("/my/courses.php: failed -", error.code, error.message); }
  console.log("Hosts visited in total:", m.state().hosts.join(", "));
}

main().catch((error) => { console.log("Probe error:", error.code || "", error.message); process.exitCode = 1; });

