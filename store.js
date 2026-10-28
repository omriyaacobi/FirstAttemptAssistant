// store.js
// Saves conversations on disk: one JSON file per conversation, in a folder you choose
// (the server uses data/conversations/, which is git-ignored because chats are private).
//
// A conversation looks like:
//   { id, title, created, updated, messages: [ { role, text, at, result?, log? }, ... ] }
//   role is "user" or "assistant"; result/log are kept for assistant messages so an old
//   chat can be shown exactly as it looked.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

// Ids are 16 hex characters. Checking this on every call matters for security: the id
// becomes part of a file path, so a value like "../../secrets" must never get through.
const ID_PATTERN = /^[a-f0-9]{16}$/;
const MAX_MESSAGES = 200; // keep each file small; older messages are dropped

function createStore(dir) {
  fs.mkdirSync(dir, { recursive: true });

  const fileFor = (id) => path.join(dir, id + ".json");

  // Write to a temporary file first, then rename it into place. If the program is stopped
  // halfway through, the old file is still intact instead of half-written.
  function write(conversation) {
    const file = fileFor(conversation.id);
    const temp = file + ".tmp";
    fs.writeFileSync(temp, JSON.stringify(conversation));
    fs.renameSync(temp, file);
  }

  function get(id) {
    if (typeof id !== "string" || !ID_PATTERN.test(id)) return null;
    try {
      return JSON.parse(fs.readFileSync(fileFor(id), "utf8"));
    } catch (error) {
      return null; // missing or unreadable
    }
  }

  function create(firstMessage) {
    const now = Date.now();
    const conversation = {
      id: crypto.randomBytes(8).toString("hex"),
      title: String(firstMessage).replace(/\s+/g, " ").trim().slice(0, 60) || "New chat",
      created: now,
      updated: now,
      messages: [],
    };
    write(conversation);
    return conversation;
  }

  function append(id, messages) {
    const conversation = get(id);
    if (!conversation) throw new Error("conversation not found");
    conversation.messages = [...conversation.messages, ...messages].slice(-MAX_MESSAGES);
    conversation.updated = Date.now();
    write(conversation);
    return conversation;
  }

  function list() {
    return fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => get(name.slice(0, -5)))
      .filter(Boolean)
      .map(({ id, title, updated }) => ({ id, title, updated }))
      .sort((a, b) => b.updated - a.updated);
  }

  function remove(id) {
    if (typeof id !== "string" || !ID_PATTERN.test(id)) return false;
    try {
      fs.unlinkSync(fileFor(id));
      return true;
    } catch (error) {
      return false;
    }
  }

  return { create, get, append, list, remove };
}

module.exports = { createStore, ID_PATTERN, MAX_MESSAGES };
