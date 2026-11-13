// #576: delete what a step 9 harness script created on the test budget.
//
// regression-270-stall.mjs and diag-270-http.mjs create categories (and, when the
// budget has no group, a category group) named `<PREFIX>-<label>-<runId>`, where the
// prefix is MCP-REG270 or MCP-DIAG270 and runId is the run's 13-digit Date.now(). They
// used to leave them behind forever: 236 REG270-* categories had piled up on the
// disposable budget by 2026-10-21, invisible to the gate because step 9 runs after
// the zero-residue assertion.
//
// The match is EXACT on this run's id, so a concurrent run's objects and a human
// "REG270 budget" are never touched. Leftovers of a crashed run (a different id) are
// the pre-run sweep's job: the names are in the shape TEST_OBJECT_RE in
// tests/manual/residue.js already matches, so the sweep regex was not loosened.
//
// Every call is bounded. Cleanup runs right after the stalled op, which may still be
// holding the server's api lock; an unbounded delete queued behind it would turn a
// leak into a hang that fails the gate for a reason unrelated to the change.
//
// #680: the calls are the COMPACT ones (list_entities, manage_categories). Step 9 runs
// against the gate container, which publishes the default compact surface and refuses a
// legacy name; the shapes come from tests/manual/compact-calls.js, which a unit test runs
// through the real compact dispatcher.
import { unwrapToolResult } from '../../tests/shared/mcp-protocol.js';
import { listCall, listingLabel, REMOVE } from '../../tests/manual/compact-calls.js';

const DEFAULT_BOUND_MS = 15000;

const textOf = (r) => r?.content?.find((c) => c.type === 'text')?.text ?? '';

function listOf(result) {
  let parsed;
  try { parsed = JSON.parse(textOf(result) || 'null'); } catch { return []; }
  const v = parsed && typeof parsed === 'object' ? unwrapToolResult(parsed) : parsed;
  if (Array.isArray(v)) return v;
  if (Array.isArray(v?.groups)) return v.groups;
  return [];
}

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `^<prefix>-<letters>-<runId>$`: the names one run of a harness script creates. */
export function ownNameRe(prefix, runId) {
  return new RegExp(`^${escapeRe(prefix)}-[A-Za-z]+-${Number(runId)}$`);
}

/**
 * Best-effort delete of every category, then every category group, whose name matches
 * ownNameRe(prefix, runId). Never throws. Returns { deleted, failed, timedOut }.
 *
 * @param {(name: string, args: object) => Promise<object>} callTool  raw MCP callTool
 */
export async function deleteOwnObjects(callTool, { prefix, runId, boundMs = DEFAULT_BOUND_MS, log = console.log }) {
  const re = ownNameRe(prefix, runId);
  const out = { deleted: 0, failed: 0, timedOut: false };
  const TIMEOUT = Symbol('timeout');
  const bounded = (p) => Promise.race([p, new Promise((r) => setTimeout(() => r(TIMEOUT), boundMs).unref?.())]);

  // One timed-out call means the server is still busy (the stalled op holds the lock);
  // every later call would queue behind it, so stop rather than wait N times.
  const call = async (name, args) => {
    if (out.timedOut) return TIMEOUT;
    const r = await bounded(callTool(name, args).catch((e) => ({ isError: true, content: [{ type: 'text', text: String(e?.message || e) }] })));
    if (r === TIMEOUT) { out.timedOut = true; log(`  cleanup: ${name}${args?.type ? ` type ${args.type}` : ''} did not answer within ${boundMs}ms; leaving the rest to the pre-run sweep`); }
    return r;
  };

  const sweep = async (type, kind) => {
    const getTool = listingLabel(type);
    const listed = await call(...listCall(type));
    if (listed === TIMEOUT) return;
    // An error result parses to no list; without this the log would read "deleted 0" as
    // if nothing of ours existed.
    if (listed?.isError) { out.failed++; log(`  cleanup: ${getTool} failed: ${textOf(listed)}`); return; }
    for (const o of listOf(listed).filter((x) => re.test(String(x?.name)))) {
      const r = await call(...REMOVE[kind](o.id));
      if (r === TIMEOUT) return;
      if (r?.isError) { out.failed++; log(`  cleanup: could not delete ${o.name}: ${textOf(r)}`); } else out.deleted++;
    }
  };

  // Categories first: a group that still holds categories cannot be deleted.
  await sweep('category', 'category');
  await sweep('category_group', 'group');
  log(`  cleanup: deleted ${out.deleted} ${prefix}-*-${runId} object(s)${out.failed ? `, ${out.failed} failed` : ''}`);
  return out;
}
