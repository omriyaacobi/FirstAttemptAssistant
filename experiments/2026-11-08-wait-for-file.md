# Wait for the file (2026-11-08, branch claude/wait-for-file-cb0c19)

The bug: a file was uploaded to a course (reading takes minutes), and a question sent right after got an
immediate "the file is not in the course yet" from the old material.

Fix: when a message goes to a course and a file of THAT course is `queued` or `reading`, code (no model,
no special phrase) posts one short line, waits without holding a slow slot, then answers as a second
message with the same `replyTo`.

## Real check (test copy, port 3100, empty data/, no .env, fake models)
`experiments/wait-for-file-live.js` is the real server, thread, jobs, course routes and core.js; the front
desk and the course answer are fake, and the reader waits 20 s (READ_SECONDS) before marking the file ready.
Made-up course "Made-up Systems", made-up file assignment-3.txt, question sent 0.1 s after the upload.

Before (code at HEAD, same script):
- 1.2 s  Bot: "Files in the course now: assignment-3.txt (reading, 0 page). The assignment is not in the course yet."  (answered at once, wrong)

After:
- 0.3 s  upload accepted, 0.4 s question accepted
- 1.4 s  progress line "Waiting for the file to be read (Bot answers when it is done)"
- 1.4 s  message 2 (ack, replyTo = the question): "The file is still being read; I will answer when it is done (about 1 min)."
- 20.7 s message 3 (replyTo = the question): "Files in the course now: assignment-3.txt (ready, 1 page). The assignment covers summary pages 12 to 18."
- a fast message ("remind me...") sent after was accepted (202) and never waits.

Restart in the middle of the wait: after the restart the thread shows the question, the ack, then
"Bot was restarted (or stopped) before it finished this message... Please send it again." (the ack does not
count as an answer). The waiting job is not resumed (jobs live in memory only, like every other job).

## Notes
- "about N min" is a rough guess from the pages left (20 pages a minute, 1 to 15 min). The 20 s fake read showed "about 1 min".
- Not checked: a real PDF read by a real model, the real front desk deciding "course", the phone page.
- The test Bot was stopped; port 3100 is free. Nothing of the real data/ was touched.
