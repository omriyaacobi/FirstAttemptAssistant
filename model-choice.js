// model-choice.js
// Omri picks which model answers him (2026-11-22, to-do t10): a picker next to Send keeps one model FIRST for an hour, on the PC and
// the phone alike (saved in data/model-choice.json). Code puts the chosen model first and the normal order stays behind it, so if
// it fails another model still answers. A CLOSED list of choices; only the page's picker sets it, never Omri's words or a model.
// With a photo only agy can look, so a Claude Code choice is skipped for photo messages (brain.js says so in the log).

const fs = require("fs");
const path = require("path");
const { MODELS } = require("./router");

const HOUR_MS = 60 * 60 * 1000;

// key -> the label the page shows. The keys are MODELS names in router.js.
const CHOICES = {
  neonMedium: "Neon medium",
  neonLow: "Neon low",
  // Carbon (2026-11-24, a trial): only here, never in a chain; same "Gemini Models" pool as Neon (experiments/2026-11-24-carbon-check.md)
  carbonMedium: "Carbon medium (trial)",
  carbonLow: "Carbon low (trial)",
  hydrogenMedium: "Hydrogen medium",
  // (Argon medium / low left on 2026-11-23: same pool as Neon, which is newer)
  sonnetInAgy: "Claude Sonnet in agy",
  claudeSonnet: "Claude Code Sonnet (your Pro plan)",
};

function createModelChoice({ file, now = Date.now } = {}) {
  function read() {
    try {
      const saved = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!saved || !Object.prototype.hasOwnProperty.call(CHOICES, saved.key)) return null;
      if (!Number.isFinite(saved.until) || saved.until <= now()) return null; // the hour is over: back to the normal order
      return { key: saved.key, label: CHOICES[saved.key], until: saved.until, model: MODELS[saved.key] };
    } catch (error) {
      return null; // no choice, or a broken file: the normal order
    }
  }
  function write(value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = file + ".tmp";
    fs.writeFileSync(temp, JSON.stringify(value));
    fs.renameSync(temp, file);
  }
  return {
    get: read,
    // key null / "auto" = back to the normal order.
    set(key) {
      if (key === null || key === "auto") { fs.rmSync(file, { force: true }); return null; }
      if (typeof key !== "string" || !Object.prototype.hasOwnProperty.call(CHOICES, key)) throw Object.assign(new Error("not a model Bot can pick"), { status: 400 });
      write({ key, until: now() + HOUR_MS });
      return read();
    },
  };
}

// The model to put first for this message, or null. A photo needs agy.
function chosenFor(choice, { photo = false } = {}) {
  if (!choice || !choice.model) return null;
  if (photo && choice.model.provider !== "agy") return null;
  return choice.model;
}

module.exports = { createModelChoice, chosenFor, CHOICES, HOUR_MS };
