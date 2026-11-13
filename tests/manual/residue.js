/**
 * residue.js
 *
 * #280: the SINGLE source of truth for "is this object test residue?", plus the
 * sweep and the zero-residue assertion. `cleanup.js` and `runner.js` both delegate
 * here, so detection cannot drift between them.
 *
 * WHY A NAME SHAPE, NOT A PREFIX LIST
 * -----------------------------------
 * cleanup.js used to enumerate 5 prefixes. The test modules generate 31 distinct
 * name templates across 19+ prefixes, so the enumeration silently missed most of
 * them, which is how MCP-Payee-* payees accumulated in the dev budget for months.
 * Matching the machine-generated NAME SHAPE covers every current prefix and every
 * future one, and it refuses to match a human-created "MCP-Test" or "MCP-Budget"
 * account, because those carry no timestamp.
 *
 * TWO DETECTION PATHS
 * -------------------
 * 1. Named objects (accounts, payees, categories, category groups, schedules) are
 *    matched by TEST_OBJECT_RE against their `name`.
 * 2. RULES HAVE NO NAME. They are matched by a condition whose `value` starts with
 *    RULE_MARKER_PREFIX. Those markers are static (`MCP-Rule-test-marker`), carry no
 *    timestamp, and are therefore correctly REJECTED by TEST_OBJECT_RE. Do not
 *    "fix" that by loosening the regex: it would start matching human names.
 *
 * SAFETY
 * ------
 * sweepResidue() DELETES against a live budget. It refuses to run unless the caller
 * has designated the budget as disposable and that designation matches the budget the
 * server actually has loaded. See assertSweepAllowed().
 */

/**
 * Machine-generated object names: MCP-<Label>[-<Label>...]-<timestamp>[-<Suffix>]
 *
 *   label     letters and digits, e.g. Payee2 (payee.js:45), T3 (transaction.js:85), BuRU
 *   timestamp EITHER an ISO string with ':' and '.' replaced by '-'
 *             (`new Date().toISOString().replace(/[:.]/g, '-')`)
 *             OR a 13-digit epoch (`Date.now()`, used by schedule.js and notes.js)
 *   suffix    optional trailing word, e.g. -Updated
 *
 * Matches:  MCP-Payee2-2026-07-10T10-25-44-980Z
 *           MCP-Group-2026-07-10T10-25-44-980Z-Updated
 *           MCP-Schedule-OneOff-1783679144993
 * Rejects:  MCP-Test, MCP-Testing, MCP-Budget, Household MCP-Test-2026
 */
export const TEST_OBJECT_RE =
  /^MCP-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*?-(?:\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z|\d{13})(?:-[A-Za-z]+)?$/;

/** Rules carry no name; they are identified by a condition value with this prefix. */
export const RULE_MARKER_PREFIX = 'MCP-Rule-';

/** Abort the sweep rather than delete more than this many objects (wrong-budget signal). */
export const DEFAULT_SWEEP_MAX = 50;

/** Exit codes, extending the runner's existing convention (1 = assertion, 2 = runtime budget). */
export const EXIT_RESIDUE = 3;
export const EXIT_UNSAFE_BUDGET = 4;

export function isTestObjectName(name) {
  return typeof name === 'string' && TEST_OBJECT_RE.test(name);
}

export function isTestRule(rule) {
  const conditions = rule?.conditions ?? [];
  return conditions.some((c) => String(c?.value ?? '').startsWith(RULE_MARKER_PREFIX));
}

import { LISTING_KEY, listCall, listingLabel, accountTransactionsCall, remove } from './compact-calls.js';

const list = (x) => (Array.isArray(x) ? x : Array.isArray(x?.result) ? x.result : []);

// #584: three listings return their array under their own key (LISTING_KEY in compact-calls.js),
// and both test clients pass that shape through unchanged (unwrapToolResult strips only
// `result`). Reading them through `list` alone saw `[]`, so a leaked group, schedule or rule was
// invisible to the sweep and to the zero-residue assertion. A key is read only from the type
// that returns it. #680: listings are list_entities calls by `type`; see compact-calls.js.

/**
 * The array a listing returned, or null when its reply is not a listing.
 *
 * #583: null means UNREADABLE (error text, null, another object, a foreign key), never
 * empty. Decided by shape, not message text, so a new error wording cannot read as clean.
 */
function readListing(type, x) {
  if (Array.isArray(x)) return x;
  if (Array.isArray(x?.result)) return x.result;
  const key = LISTING_KEY[type];
  return key && Array.isArray(x?.[key]) ? x[key] : null;
}
/**
 * #583: a listing could not be read, so the budget was not checked and cannot be certified
 * clean. Tested with instanceof; the tool names are in `tools`.
 */
export class ResidueUnreadableError extends Error {
  constructor(tools) {
    super(`Zero-residue assertion could not read ${tools.join(', ')}: the budget was not checked, so it cannot be certified clean.`);
    this.name = 'ResidueUnreadableError';
    this.tools = tools;
  }
}

const redact = (id) => (typeof id === 'string' && id.length > 8 ? `${id.slice(0, 8)}...` : String(id));

/**
 * Guard: the sweep may only ever touch a budget the caller has explicitly designated
 * as disposable, AND that designation must match the budget the SERVER has loaded.
 *
 * `list_entities` with type budget_file returns the budget-file LIST with no active marker, so list
 * membership is not evidence: on a multi-budget server it passes while a different
 * budget is loaded. The authoritative id is the server's own ACTUAL_BUDGET_SYNC_ID,
 * which deploy-and-test.sh reads out of the container and passes in as
 * MCP_ACTIVE_BUDGET_SYNC_ID.
 *
 * @returns {'allowed'|'skip'}  throws { code: EXIT_UNSAFE_BUDGET } on a mismatch
 */
export function assertSweepAllowed(env = process.env) {
  const designated = env.MCP_TEST_BUDGET_SYNC_ID;
  const active = env.MCP_ACTIVE_BUDGET_SYNC_ID;

  if (!designated) {
    console.log('  ℹ Sweep skipped: MCP_TEST_BUDGET_SYNC_ID is not set, so no budget is designated disposable.');
    return 'skip';
  }
  if (!active) {
    console.log('  ℹ Sweep skipped: MCP_ACTIVE_BUDGET_SYNC_ID was not provided, so the active budget cannot be verified.');
    return 'skip';
  }
  if (designated !== active) {
    const err = new Error(
      `Refusing to sweep: the designated disposable budget (${redact(designated)}) is NOT the budget the server ` +
      `has loaded (${redact(active)}). Nothing was deleted.`,
    );
    err.code = EXIT_UNSAFE_BUDGET;
    throw err;
  }
  return 'allowed';
}

/**
 * Collect everything that looks like test residue, without deleting anything. Never throws:
 * a listing that could not be read (#583) is named in `unreadable` and contributes nothing,
 * so the best-effort sweep still removes what it could read and the assertion can refuse.
 */
export async function findResidue(callTool) {
  const unreadable = [];
  // #680: every listing is `list_entities` with a `type`; the type names it in `unreadable`.
  const listing = (type) => callTool(...listCall(type))
    .then((x) => readListing(type, x))
    .catch(() => null)
    .then((arr) => {
      if (arr === null) unreadable.push(listingLabel(type));
      return arr ?? [];
    });
  const [accounts, payees, categories, groups, rules, schedules, tags] = await Promise.all([
    listing('account'),
    listing('payee'),
    listing('category'),
    listing('category_group'),
    listing('rule'),
    listing('schedule'),
    // #451: tags. Added with the tags integration module, because a fixture the sweep cannot
    // see is a fixture the zero-residue assertion silently certifies as absent. tags.js deletes
    // its own tag in a `finally`, but a run killed by the wall-clock guard or by an open circuit
    // breaker never reaches it, and the next run would then inherit an invisible leftover.
    listing('tag'),
  ]);

  const named = (arr) => arr.filter((o) => isTestObjectName(o?.name));

  return {
    // Accounts are split: a CLOSED test account is an accepted terminal state, because
    // Actual keeps transactions in closed accounts and hard-deleting one caused the
    // infinite retry loops documented in cleanup.js. Only OPEN ones are residue.
    openAccounts: named(accounts).filter((a) => !a.closed),
    closedAccounts: named(accounts).filter((a) => a.closed),
    // A TRANSFER payee (`transfer_acct` set) is not residue and must never be deleted.
    // Actual auto-creates one per account, named after the account, and it is OWNED by
    // that account: removing it breaks the account's transfer linkage. Because we close
    // test accounts rather than delete them (see above), their transfer payees legitimately
    // persist. Matching a name is not the same as understanding the object: a live dry-run
    // caught this pattern about to delete 6 transfer payees belonging to closed accounts.
    payees: named(payees).filter((p) => !p.transfer_acct),
    categories: named(categories),
    groups: named(groups),
    schedules: named(schedules),
    rules: rules.filter(isTestRule),
    // A tag's word is in `tag`, not `name`, so it needs its own filter rather than `named()`.
    tags: tags.filter((t) => isTestObjectName(t?.tag)),
    unreadable: unreadable.sort(),
  };
}

/** Count only what must be zero. Closed accounts are deliberately excluded. */
export function residueCount(r) {
  return r.openAccounts.length + r.payees.length + r.categories.length +
         r.groups.length + r.schedules.length + r.rules.length + r.tags.length;
}

/**
 * Delete/close every test object, subject to the safety rails.
 * Prints a dry-run preview BEFORE touching anything, so a wrong target is visible
 * even on an unattended run.
 */
export async function sweepResidue(callTool, env = process.env) {
  const decision = assertSweepAllowed(env); // throws with code 4 on a mismatch
  if (decision === 'skip') return { swept: 0, failed: 0, skipped: true };

  const found = await findResidue(callTool);
  const total = residueCount(found);
  // #583: best effort. Sweep what could be read, but never call a budget clean when part of
  // it was not read; the post-run assertion is the check, and it refuses.
  if (found.unreadable.length > 0) {
    console.log(`  ⚠ Sweep could not read ${found.unreadable.join(', ')}; anything there is left for this run's assertion to report.`);
  }
  if (total === 0) {
    if (found.unreadable.length === 0) console.log('  ✓ Sweep: budget already clean, nothing to remove.');
    else console.log('  ℹ Sweep: nothing to remove in the listings it could read.');
    return { swept: 0, failed: 0, skipped: false };
  }

  const cap = parseInt(env.MCP_TEST_SWEEP_MAX || String(DEFAULT_SWEEP_MAX), 10);
  console.log(`\n  -- Sweep preview (${total} object(s), cap ${cap}) --`);
  for (const a of found.openAccounts) console.log(`     remove account   ${a.name}`);
  for (const p of found.payees) console.log(`     delete payee     ${p.name}`);
  for (const c of found.categories) console.log(`     delete category  ${c.name}`);
  for (const g of found.groups) console.log(`     delete group     ${g.name}`);
  for (const s of found.schedules) console.log(`     delete schedule  ${s.name}`);
  for (const r of found.rules) console.log(`     delete rule      ${r.id}`);
  // #451 review: tags are COUNTED by residueCount, so omitting them here made the preview
  // under-report what the sweep is about to delete, which is the one thing this preview exists
  // to show before anything is touched.
  for (const t of found.tags) console.log(`     delete tag       ${t.tag}`);

  if (total > cap) {
    const err = new Error(
      `Refusing to sweep ${total} objects: that exceeds MCP_TEST_SWEEP_MAX (${cap}) and suggests the wrong budget. ` +
      'Nothing was deleted.',
    );
    err.code = EXIT_UNSAFE_BUDGET;
    throw err;
  }

  // Count real outcomes. The old code swallowed each per-op failure and then printed an
  // unconditional success, so a balance-bearing account (which manage_accounts close
  // cannot close without a transfer_account_id) silently survived while the sweep claimed
  // to have removed it, and the next run failed the zero-residue assertion (#287). Count
  // only what is actually gone, and report anything that could not be removed.
  let swept = 0, failed = 0;
  const tryRemove = async (label, name, fn) => {
    try { await fn(); swept++; }
    catch (err) { console.log(`     ! ${label} "${name}" failed: ${err.message}`); failed++; }
  };

  // Order matters: rules and schedules reference payees/categories, so remove them first.
  // Tags reference nothing and nothing references them, so the order is free here.
  for (const t of found.tags) await tryRemove('tag delete', t.tag, () => remove(callTool, 'tag', t.id));
  for (const r of found.rules) await tryRemove('rule delete', r.id, () => remove(callTool, 'rule', r.id));
  for (const s of found.schedules) await tryRemove('schedule delete', s.name, () => remove(callTool, 'schedule', s.id));
  for (const p of found.payees) await tryRemove('payee delete', p.name, () => remove(callTool, 'payee', p.id));
  for (const c of found.categories) await tryRemove('category delete', c.name, () => remove(callTool, 'category', c.id));
  for (const g of found.groups) await tryRemove('group delete', g.name, () => remove(callTool, 'group', g.id));
  // Accounts (#287): an OPEN account with a non-zero balance cannot be closed without a
  // transferAccountId, so the old close-only path silently failed. Zero the balance by
  // deleting the account's transactions, then delete the account; fall back to closing it
  // (with a zero balance, close succeeds) so it lands in the accepted terminal state
  // rather than as open residue. The legacy "NEVER delete an account" caution was a
  // pre-#134 per-op-init timeout; since #134 the session is pooled and the delete is
  // bounded by the #270 op-timeout, so it no longer loops (verified live during the
  // v0.8.13 release cleanup).
  for (const a of found.openAccounts) {
    await tryRemove('account remove', a.name, async () => {
      const txns = list(await callTool(...accountTransactionsCall(a.id)).catch(() => []));
      for (const t of txns) {
        if (t?.id) await remove(callTool, 'transaction', t.id).catch(() => {});
      }
      try {
        await remove(callTool, 'account', a.id);
      } catch {
        // Balance is zero now, so close is the fallback. If this ALSO throws, it propagates
        // to tryRemove, which records the account as failed (not swept): the summary stays honest.
        await remove(callTool, 'accountClose', a.id);
      }
    });
  }

  if (failed === 0) {
    console.log(`  ✓ Sweep removed ${swept} object(s).\n`);
  } else {
    console.log(`  ⚠ Sweep removed ${swept} object(s); ${failed} could NOT be removed (see failures above). The budget is NOT clean.\n`);
  }
  return { swept, failed, skipped: false };
}

/**
 * The gate. Zero is the only pass, where zero means: no OPEN test accounts, and no test
 * payees, categories, groups, schedules, rules, or TAGS (#451). Closed test accounts are
 * reported so their growth stays visible, but they do not fail the run.
 *
 * Tags are named explicitly because this docstring omitted them for one commit while
 * residueCount already counted them, which is the same omission the printers below had: a
 * maintainer reading the contract would conclude a stray tag does not fail the run, and the
 * first live tags run proves it does.
 *
 * #583: an unreadable listing throws ResidueUnreadableError BEFORE anything is counted, so a
 * partly read budget is neither certified clean nor reported as a residue count.
 *
 * @returns {number} the residue count (0 = clean)
 * @throws {ResidueUnreadableError} when any listing could not be read
 */
export async function assertNoResidue(callTool) {
  const found = await findResidue(callTool);
  if (found.unreadable.length > 0) throw new ResidueUnreadableError(found.unreadable);
  const total = residueCount(found);

  if (found.closedAccounts.length > 0) {
    console.log(`  ℹ ${found.closedAccounts.length} closed MCP-* account(s) remain (accepted terminal state).`);
  }

  if (total === 0) {
    console.log('  ✓ Zero-residue assertion passed: the budget is clean.');
    return 0;
  }

  console.log(`\n  ✗ Zero-residue assertion FAILED: ${total} object(s) left behind:`);
  for (const a of found.openAccounts) console.log(`     OPEN account  ${a.name}`);
  for (const p of found.payees) console.log(`     payee         ${p.name}`);
  for (const c of found.categories) console.log(`     category      ${c.name}`);
  for (const g of found.groups) console.log(`     group         ${g.name}`);
  for (const s of found.schedules) console.log(`     schedule      ${s.name}`);
  for (const r of found.rules) console.log(`     rule          ${r.id} (condition value starts with ${RULE_MARKER_PREFIX})`);
  // Without this, a TAG-only failure printed "1 object(s) left behind:" followed by nothing,
  // which is the least useful possible form of a failing gate. Exactly the case that fired on
  // the first live run of the tags module.
  for (const t of found.tags) console.log(`     tag           ${t.tag}`);
  return total;
}
