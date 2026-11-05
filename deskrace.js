// deskrace.js
// Makes the front desk's SLOW TAIL shorter. One front desk call usually takes 8-15 s, but now and then a call
// takes 40-60 s (the model thinks for a long time, or returns a reply that is not valid). Two cures, both here:
//
//   hedging  - if the first call has not answered after `hedgeAfterMs`, start a second one and take whichever
//              gives a VALID reply first. The loser is stopped (its process is killed).
//              A call that fails (or gives an invalid reply) starts the next one at once, without waiting.
//   deadline - after `deadlineMs` in total, give up, so the caller can use a default instead of waiting.
//
// race() does not know about models: each "start" is a function (signal) => Promise<reply>. `accept(reply)`
// turns a reply into a result or null (invalid). Tests use fake starts and small millisecond values.

// Returns { result, index, started, errors }, where index says which start won.
// Rejects when every start failed, or when the deadline passed.
function race(starts, { accept = (r) => r, hedgeAfterMs = 9000, deadlineMs = 25000 } = {}) {
  return new Promise((resolve, reject) => {
    const controllers = [];
    const errors = [];
    let started = 0;
    let finished = false;
    let failed = 0;
    let hedgeTimer = null;
    let deadlineTimer = null;

    const stopAll = (exceptIndex) => {
      clearTimeout(hedgeTimer);
      clearTimeout(deadlineTimer);
      controllers.forEach((c, i) => { if (i !== exceptIndex) c.abort(); }); // kills the loser's process
    };
    const finish = (fn, value, winner) => {
      if (finished) return;
      finished = true;
      stopAll(winner);
      fn(value);
    };

    function startNext() {
      if (finished || started >= starts.length) return;
      const index = started++;
      const controller = new AbortController();
      controllers.push(controller);
      // A start that throws at once (not just rejects) counts as a failed call.
      Promise.resolve().then(() => starts[index](controller.signal)).then((reply) => {
        if (finished) return;
        const result = accept(reply);
        if (result) return finish(resolve, { result, index, started, errors }, index);
        throw new Error("unusable reply");
      }).catch((error) => {
        if (finished) return;
        errors.push(String(error && error.message || error).slice(0, 200));
        failed++;
        if (failed >= starts.length) return finish(reject, new Error("every front desk call failed: " + errors.join(" | ")));
        if (failed >= started) startNext(); // nothing is still running: do not wait for the hedge timer
      });
      if (started < starts.length) {
        clearTimeout(hedgeTimer);
        hedgeTimer = setTimeout(startNext, hedgeAfterMs);
      }
    }

    deadlineTimer = setTimeout(() => finish(reject, new Error(`the front desk did not answer within ${Math.round(deadlineMs / 1000)} s`)), deadlineMs);
    startNext();
  });
}

module.exports = { race };
