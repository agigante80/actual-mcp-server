/**
 * tests/unit/helpers/write-cycle.mjs
 *
 * #376: prove a guarded write did its READ inside the same write-queue drain as its WRITE.
 *
 * WHY THE OBVIOUS ASSERTION IS NOT ENOUGH. Eight tool tests asserted
 * `_getWriteQueueBatchCountForTests()` advanced by exactly 1 and labelled it "read, write and
 * re-read shared ONE write-queue cycle". The counter increments once per dispatched drain, so
 * a delta of 1 proves ONE DRAIN HAPPENED. It says nothing about where the read was: a shape
 * that reads through `adapter.getX()` (its own `withActualApi` cycle) and then writes through
 * `queueWriteOperation` also measures exactly 1.
 *
 * That is not a hypothetical shape. It is what all eight of these tools did before #371 and
 * #376 moved their guards into the adapter, and `notes_update` did it as recently as v0.14.0
 * with four `adapter.get*` calls plus a write. So the assertion could not detect its own
 * feature being reverted.
 *
 * HOW THIS TELLS THEM APART. The counter increments at drain START (`writeQueueBatchCount++`
 * before any await in `processWriteQueue`), so it is CONSTANT for the duration of a drain and
 * different between drains. Sampling it from inside the raw read stub and the raw write stub
 * therefore answers the real question:
 *
 *   read outside the queue -> read samples N,      write samples N+1   (different drains)
 *   read inside the queue  -> read samples N+1,    write samples N+1   (same drain)
 *
 * USAGE. The raw api stubs must be installed BEFORE the adapter import (it destructures them
 * at module load), and they call the witness:
 *
 *   const witness = makeCycleWitness(adapterMod);
 *   apiDefault.getRules   = async () => { witness.noteRead();  return rules; };
 *   apiDefault.deleteRule = async () => { witness.noteWrite(); return true;  };
 *   ...
 *   witness.reset();
 *   await tool.call({ id });
 *   check(witness.sharedOneCycle(), 'read and write shared ONE drain', witness.describe());
 */

/**
 * @param {{ _getWriteQueueBatchCountForTests: () => number }} adapterMod
 *   The imported adapter MODULE (not its default export), for the test hook.
 */
export function makeCycleWitness(adapterMod) {
  const now = () => adapterMod._getWriteQueueBatchCountForTests();
  let before = 0;
  let readAt = null;
  let writeAt = null;

  return {
    /** Call immediately before the operation under test. */
    reset() {
      before = now();
      readAt = null;
      writeAt = null;
    },
    /** Call from inside every raw READ stub the guard uses. First sample wins. */
    noteRead() {
      if (readAt === null) readAt = now();
    },
    /** Call from inside the raw WRITE stub. First sample wins. */
    noteWrite() {
      if (writeAt === null) writeAt = now();
    },
    /** Drains dispatched since reset(). The old, weaker measure; kept for the Zod-failure case. */
    cycles() {
      return now() - before;
    },
    /**
     * THE assertion. True only when a read AND a write both happened, both inside the same
     * drain, and that drain is the one this operation started.
     */
    sharedOneCycle() {
      return readAt !== null && writeAt !== null && readAt === writeAt && readAt === before + 1;
    },
    /**
     * For a guard that REFUSES: the read happened inside the drain and no write followed.
     * Distinguishes "refused after reading in-cycle" from "never got to the queue at all".
     */
    readInCycleNoWrite() {
      return readAt === before + 1 && writeAt === null;
    },
    /** Diagnostic string for a failure message. */
    describe() {
      return `before=${before} readAt=${readAt} writeAt=${writeAt} now=${now()}`;
    },
  };
}
