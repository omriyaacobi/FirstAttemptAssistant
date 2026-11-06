// Prints agy's /usage lines (pool, window, percent left). Used to see which quota pool a run spends.
const { execFile } = require("node:child_process");
const AGY = "C:/Users/User/AppData/Local/agy/bin/agy.exe";
execFile(AGY, ["-p", "/usage"], { cwd: require("node:os").tmpdir(), timeout: 90000 }, (e, out, err) => console.log(e ? "ERR " + e.message : String(out).trim()));
