// server.js
// A tiny web server that lets you use the orchestrator from Chrome.
// Start it with:  node server.js   then open  http://localhost:3000
//
// A server is a program that waits for requests and sends back responses. Ours has 3 routes:
//   GET  /           -> the page itself (public/index.html)
//   GET  /api/usage  -> your agy quota, as JSON
//   POST /api/ask    -> run a task through the orchestrator, streaming progress as it goes
//
// SECURITY: this server can start tools that run under YOUR logins and spend YOUR quota,
// so it is locked down in several ways (see the checks below). Only built-in Node modules
// are used, so there is nothing to install.

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { handleTask } = require("./core");

const HOST = "127.0.0.1"; // listen on this computer only; other devices on your network can't connect
const PORT = Number(process.env.PORT) || 3000;
const MAX_BODY = 20000; // bytes; a bigger request is refused
const MAX_TASK_CHARS = 8000;
const MAX_RUNNING = 2; // at most 2 tasks at once, so a bug or a loop can't burn your whole quota
const PAGE = path.join(__dirname, "public", "index.html");
const AGY_CMD = process.env.AGY_CMD || "C:\\Users\\User\\AppData\\Local\\agy\\bin\\agy.exe";

// agy prints tab-separated lines like: Gemini Models<TAB>Five Hour Limit Remaining<TAB>99%<TAB>2026-10-28T01:41:40Z
function parseUsage(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.split("\t"))
    .filter((cols) => cols.length >= 4)
    .map(([pool, window, remaining, resets]) => ({ pool, window, remaining: parseInt(remaining, 10), resets }));
}

function getUsage() {
  return new Promise((resolve, reject) => {
    execFile(AGY_CMD, ["-p", "/usage"], { timeout: 60000 }, (error, stdout, stderr) => {
      if (error) return reject(new Error(String(stderr || error.message).slice(0, 200)));
      resolve(parseUsage(stdout));
    });
  });
}

// Reads the request body, but gives up if it gets too big.
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY) {
        reject(Object.assign(new Error("request too large"), { status: 413 }));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

const sendJson = (res, status, data) => {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
};

function createServer({ handle = handleTask, usage = getUsage } = {}) {
  let running = 0;

  const server = http.createServer(async (req, res) => {
    const port = server.address().port;
    const me = [`localhost:${port}`, `127.0.0.1:${port}`];

    // CHECK 1 - the Host header must be our own address. This blocks "DNS rebinding", a trick
    // where a malicious website points its own name at 127.0.0.1 to talk to local servers.
    if (!me.includes(req.headers.host)) return sendJson(res, 403, { error: "bad host" });

    // CHECK 2 - browsers say which site a request came from. Refuse anything not from this page.
    // This blocks other websites you have open from sending tasks to this server.
    const origin = req.headers.origin;
    if (origin && !me.map((h) => `http://${h}`).includes(origin)) return sendJson(res, 403, { error: "bad origin" });
    const site = req.headers["sec-fetch-site"];
    if (site && !["same-origin", "none"].includes(site)) return sendJson(res, 403, { error: "cross-site request" });

    const url = new URL(req.url, `http://${req.headers.host}`);

    // The page itself
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      fs.readFile(PAGE, (error, html) => {
        if (error) return sendJson(res, 500, { error: "page missing" });
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        res.end(html);
      });
      return;
    }

    // Quota panel
    if (req.method === "GET" && url.pathname === "/api/usage") {
      try {
        return sendJson(res, 200, { rows: await usage() });
      } catch (error) {
        return sendJson(res, 502, { error: error.message });
      }
    }

    // Run a task
    if (req.method === "POST" && url.pathname === "/api/ask") {
      // CHECK 3 - only accept JSON. A web page on another site can't send JSON to us without
      // the browser first asking our permission, and we never give it.
      if (!String(req.headers["content-type"] || "").startsWith("application/json")) {
        return sendJson(res, 415, { error: "send JSON" });
      }

      let input;
      try {
        input = JSON.parse(await readBody(req));
      } catch (error) {
        return sendJson(res, error.status || 400, { error: error.status ? error.message : "invalid JSON" });
      }

      // Never trust what arrives: check the type and the size.
      const task = typeof input.task === "string" ? input.task.trim() : "";
      if (!task) return sendJson(res, 400, { error: "task is empty" });
      if (task.length > MAX_TASK_CHARS) return sendJson(res, 413, { error: `task is longer than ${MAX_TASK_CHARS} characters` });

      // CHECK 4 - a cap on simultaneous tasks
      if (running >= MAX_RUNNING) return sendJson(res, 429, { error: "busy, wait for the current tasks to finish" });
      running++;

      // We answer as a stream of lines (NDJSON): progress lines first, the final result last,
      // so the page can show what is happening while the models work.
      res.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" });
      const send = (obj) => res.write(JSON.stringify(obj) + "\n");
      try {
        const result = await handle(task, { noPlan: input.noPlan === true, log: (text) => send({ type: "log", text }) });
        send({ type: "result", result });
      } catch (error) {
        send({ type: "error", message: String(error.message).slice(0, 500) });
      } finally {
        running--;
        res.end();
      }
      return;
    }

    sendJson(res, 404, { error: "not found" });
  });

  return server;
}

module.exports = { createServer, parseUsage, MAX_BODY, MAX_TASK_CHARS, MAX_RUNNING };

// Start listening only when run directly ("node server.js"), not when a test imports this file.
if (require.main === module) {
  const server = createServer();
  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") console.error(`Port ${PORT} is already in use. Is the server already running? Or try: PORT=3001 node server.js`);
    else console.error("Server error:", error.message);
    process.exit(1);
  });
  server.listen(PORT, HOST, () => {
    console.log(`Orchestrator web page: http://localhost:${PORT}  (only reachable from this computer)`);
    console.log("Press Ctrl+C to stop.");
  });
}
