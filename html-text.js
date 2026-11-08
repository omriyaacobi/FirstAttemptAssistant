// html-text.js
// Turns an HTML page (for example a Word file "saved as web page", found in a zip) into plain text for the notebook.
// The page is UNTRUSTED data: it is never rendered or run here. Only text comes out: tags, <script>, <style>, comments and the
// <head> are dropped, entities are decoded, headings and paragraphs keep their breaks, Hebrew is kept as it is.
// No package; every regex below moves forward only (no nested repeats), so a hostile 10 MB page cannot make it hang.

const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", laquo: "«", raquo: "»", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", bull: "•", middot: "·", copy: "©", reg: "®", deg: "°", times: "×", divide: "÷", plusmn: "±", le: "≤", ge: "≥", ne: "≠", infin: "∞", rlm: "", lrm: "", shy: "" };

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,8});/gi, (all, body) => {
    if (body[0] === "#") {
      const code = body[1].toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : "";
    }
    const v = NAMED[body.toLowerCase()];
    return v === undefined ? all : v;
  });
}

// Returns the readable text of an HTML string.
function htmlToText(html) {
  let s = String(html);
  s = s.replace(/<!--[\s\S]*?(?:-->|$)/g, " "); // comments, also Word's conditional ones
  s = s.replace(/<(script|style|head|xml|noscript|template)\b[\s\S]*?(?:<\/\1\s*>|$)/gi, " "); // contents that are never text
  s = s.replace(/\s+/g, " "); // in HTML a line break in the source is only a space
  s = s.replace(/<h([1-6])\b[^<>]*>/gi, (m, n) => `\n\n${"#".repeat(Math.min(3, Number(n)))} `);
  s = s.replace(/<\/h[1-6]\s*>/gi, "\n\n");
  s = s.replace(/<li\b[^<>]*>/gi, "\n- ");
  s = s.replace(/<br\b[^<>]*>/gi, "\n");
  s = s.replace(/<\/?(?:p|div|tr|table|ul|ol|blockquote|pre|section|article|header|footer|title)\b[^<>]*>/gi, "\n\n");
  s = s.replace(/<\/t[dh]\s*>/gi, " | ");
  s = s.replace(/<[a-zA-Z\/!?][^<>]*>/g, ""); // every other tag
  s = decodeEntities(s);
  s = s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f‎‏‪-‮⁦-⁩­]/g, ""); // control and direction marks
  s = s.replace(/[ \t ]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n");
  s = s.replace(/(?: \|)+(?=\n|$)/g, ""); // a table row's last separator
  return s.trim();
}

// The text of the BYTES of an html file, or null when they are not really text. UTF-8 (with or without a BOM) or UTF-16 with a BOM;
// a page that says it is windows-1255 / iso-8859-8 (old Hebrew Word pages) is read that way. Anything else, or a NUL byte: null.
function htmlBytesToText(bytes) {
  let raw;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) raw = new TextDecoder("utf-16le").decode(bytes.subarray(2));
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) raw = new TextDecoder("utf-16be").decode(bytes.subarray(2));
  else {
    if (bytes.includes(0)) return null;
    const body = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes;
    try { raw = new TextDecoder("utf-8", { fatal: true }).decode(body); } catch (error) {
      const said = /charset\s*=\s*["']?\s*(windows-1255|iso-8859-8|windows-1252|iso-8859-1)/i.exec(body.subarray(0, 4096).toString("latin1"));
      if (!said) return null;
      try { raw = new TextDecoder(said[1].toLowerCase()).decode(body); } catch (err) { return null; }
    }
  }
  return htmlToText(raw);
}

module.exports = { htmlToText, htmlBytesToText };
