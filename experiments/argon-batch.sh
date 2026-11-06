#!/bin/sh
# Runs the six page tasks one after the other (parallel runs make the test suite too slow and it times out).
cd "$(dirname "$0")/.." || exit 1
R="$ARGON_RUNS"
node experiments/argon-run.js t1-colour "Change the accent colour of the default light design from purple to a teal green (#0d9488). Keep the dark mode readable." > $R/t1.log 2>&1
node experiments/argon-run.js t2-spacing "Add a little more space between the chats in the sidebar chat list (about 4px more between items)." > $R/t2.log 2>&1
node experiments/argon-run.js t3-move "Move the Quota button in the sidebar so it sits directly above the '+ New chat' button instead of below the chat list." > $R/t3.log 2>&1
node experiments/argon-run.js t4-about "Add a small line at the very bottom of the sidebar, in muted small text, saying: Bot runs on this computer." "Make that line italic and centered." > $R/t4.log 2>&1
node experiments/argon-run.js t5-phone "On phones (screen width 560px or less) make the Send button in the chat composer full width, placed under the message box." > $R/t5.log 2>&1
node experiments/argon-run.js t6-hebrew "תוסיף בתחתית הסרגל הצדדי שורה קטנה באפור עם הטקסט: נבנה עם עמרי" > $R/t6.log 2>&1
echo ALLDONE > $R/batch-done.txt
