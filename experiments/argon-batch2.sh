#!/bin/sh
# Second batch: the spacing task again (its first run hit a flaky baseline test), then the same two tasks with Claude Sonnet for comparison.
cd "$(dirname "$0")/.." || exit 1
R="$ARGON_RUNS"
node experiments/argon-run.js t2-spacing "Add a little more space between the chats in the sidebar chat list (about 4px more between items)." > $R/t2.log 2>&1
node experiments/argon-run.js s3-move "Move the Quota button in the sidebar so it sits directly above the '+ New chat' button instead of below the chat list." --model sonnet > $R/s3.log 2>&1
node experiments/argon-run.js s1-colour "Change the accent colour of the default light design from purple to a teal green (#0d9488). Keep the dark mode readable." --model sonnet > $R/s1.log 2>&1
echo ALLDONE > $R/batch2-done.txt
