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
 * (bank sync opt-in, for example) can never be mistaken for a pass and can
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

/**
 * An outcome the test DELIBERATELY tolerates, with the reason stated.
 *
 * #387: the ledger above made a failed assertion run-failing, but it left a second way for a
 * module to report an unexpected result and still pass: print a warning glyph and return. Before
 * #380 that let `deploy-and-test.sh full` report GREEN on both transports while printing a
 * ZodError, which makes the release gate a check that can lie.
 *
 * The fix is not to ban tolerance, which would be wrong: a few branches legitimately accept either
 * of two upstream behaviours. It is to make tolerance say WHY, so the guard has something explicit
 * to allow and a reader can see the decision was deliberate rather than a branch nobody finished.
 *
 * Use `fail()` when the outcome is simply wrong, `skip()` when a precondition is missing, and this
 * ONLY when both outcomes are genuinely acceptable and the reason says so in one line. "Might
 * depend on Actual behaviour" is not a reason: that is a question the test should answer.
 */
export function noteTolerated(reason) {
  console.log(`  ~ tolerated: ${reason}`);
}

/** Number of failures recorded so far this process. runner.js checks this at the end. */
export function failureCount() {
  return failures.length;
}

/** The recorded failure messages, for the end-of-suite summary. */
export function failureList() {
  return failures.slice();
}
