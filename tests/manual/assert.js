/**
 * assert.js
 *
 * #281: the single failure ledger for the manual integration suite.
 *
 * Before this, every module printed `console.log("  ❌ ...")` on a failed assertion but
 * NEVER threw and NEVER recorded the failure, so runner.js exited 0 even when assertions
 * failed. "Both transports passed" (the #280 release gate) therefore meant "the runner
 * reached the end", not "every assertion held". This ledger makes a failed assertion an
 * attributable, run-failing event.
 *
 * Every module routes its failures through fail() / expect(). runner.js reads
 * failureCount() at the end of the suite and exits 1 if it is non-zero, listing every
 * failure. The output is unchanged: fail() prints the same "  ❌ <message>" line the
 * modules printed before, so logs read identically; the only new behaviour is the exit code.
 *
 * A SKIP is neither pass nor fail. It uses a distinct glyph (⏭) so a legitimate skip
 * (bank sync opt-in, budgets_switch over stdio) can never be mistaken for a pass and can
 * never make the run exit 1.
 */

let failures = [];

/**
 * Record an assertion failure. Prints the same line the modules printed before, then
 * appends to the ledger the runner reads. This is the ONLY way a module signals failure.
 */
export function fail(message) {
  console.log(`  ❌ ${message}`);
  failures.push(String(message));
}

/** A skip is neither pass nor fail. Distinct glyph so it is never counted as a pass. */
export function skip(message) {
  console.log(`  ⏭ ${message}`);
}

/** Number of failures recorded so far this process. runner.js checks this at the end. */
export function failureCount() {
  return failures.length;
}

/** The recorded failure messages, for the end-of-suite summary. */
export function failureList() {
  return failures.slice();
}
