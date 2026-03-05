#!/usr/bin/env node
/**
 * scripts/direct-sync/bank-sync-direct.mjs
 *
 * Direct connectivity test for Actual Budget — bypasses the MCP layer entirely.
 * Reads the same env vars as the MCP server so no extra configuration is needed.
 *
 * What it does:
 *   1. Resolves budget config from environment (same ACTUAL_* / BUDGET_n_* vars)
 *   2. Connects directly to the Actual Budget server via @actual-app/api
 *   3. Downloads the budget file
 *   4. Lists all accounts
 *   5. Runs bank sync for each account individually (with 60 s timeout)
 *   6. Writes a structured log file to logs/direct-sync-<timestamp>.log
 *   7. Prints a human-readable summary to stdout
 *
 * Usage:
 *   node scripts/direct-sync/bank-sync-direct.mjs [options]
 *
 * Options:
 *   --budget <name>   Target a specific budget by name (matches BUDGET_n_NAME or
 *                     BUDGET_DEFAULT_NAME). Default: the default budget.
 *   --list            List accounts only — skip bank sync step.
 *   --dry-run         Alias for --list.
 *   --no-file-log     Print logs to stdout only; do not write a log file.
 *   --help            Show this help.
 *
 * Environment variables (loaded from .env if present):
 *   ACTUAL_SERVER_URL       URL of the Actual Budget server (required)
 *   ACTUAL_PASSWORD         Server password (required)
 *   ACTUAL_BUDGET_SYNC_ID   Sync ID of the default budget (required)
 *   ACTUAL_BUDGET_PASSWORD  E2E encryption password (optional)
 *   BUDGET_DEFAULT_NAME     Friendly name for the default budget (optional)
 *   BUDGET_n_NAME           Name of additional budget n (optional)
 *   BUDGET_n_SYNC_ID        Sync ID of budget n (optional)
 *   BUDGET_n_SERVER_URL     Server URL of budget n — falls back to ACTUAL_SERVER_URL
 *   BUDGET_n_PASSWORD       Password for budget n — falls back to ACTUAL_PASSWORD
 *   BUDGET_n_ENCRYPTION_PASSWORD  E2E password for budget n (optional)
 *   ACTUAL_DATA_DIR         Local directory for Actual data files
 *                           Default: /tmp/actual-direct-sync-<pid>
 *   DIRECT_SYNC_LOG_DIR     Directory for log files (default: logs/ in project root)
 *   BANK_SYNC_TIMEOUT_MS    Timeout per account in ms (default: 60000)
 */

import { createReadStream, existsSync } from 'fs';
import { mkdir, writeFile, appendFile } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import os from 'os';

// ---------------------------------------------------------------------------
// Bootstrap: load dotenv if available (same pattern as MCP server)
// ---------------------------------------------------------------------------
const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..', '..');

try {
  const dotenv = await import('dotenv');
  dotenv.config({ path: resolve(projectRoot, '.env') });
} catch {
  // dotenv not installed — fine, env vars must be set another way
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Usage: node scripts/direct-sync/bank-sync-direct.mjs [options]

Options:
  --budget <name>   Target a specific budget by name.
                    Default: the default budget (ACTUAL_BUDGET_SYNC_ID).
  --list            List accounts only, skip bank sync.
  --dry-run         Alias for --list.
  --no-file-log     Console output only; do not write a log file.
  --help            Show this help.

Required env vars: ACTUAL_SERVER_URL, ACTUAL_PASSWORD, ACTUAL_BUDGET_SYNC_ID
`.trim());
  process.exit(0);
}

const budgetNameArg = (() => {
  const idx = args.indexOf('--budget');
  return idx !== -1 ? args[idx + 1] : null;
})();

const listOnly   = args.includes('--list') || args.includes('--dry-run');
const noFileLog  = args.includes('--no-file-log');

// ---------------------------------------------------------------------------
// Budget config resolution — mirrors src/lib/actual-adapter.ts registry logic
// ---------------------------------------------------------------------------
function resolveBudgets() {
  const budgets = [];

  // Default budget
  const defaultName    = process.env.BUDGET_DEFAULT_NAME || 'Default';
  const defaultSyncId  = process.env.ACTUAL_BUDGET_SYNC_ID;
  const defaultServer  = process.env.ACTUAL_SERVER_URL;
  const defaultPass    = process.env.ACTUAL_PASSWORD;
  const defaultEncPass = process.env.ACTUAL_BUDGET_PASSWORD || '';

  if (!defaultSyncId || !defaultServer || !defaultPass) {
    throw new Error(
      'Missing required env vars: ACTUAL_SERVER_URL, ACTUAL_PASSWORD, ACTUAL_BUDGET_SYNC_ID'
    );
  }

  budgets.push({
    name:               defaultName,
    syncId:             defaultSyncId,
    serverUrl:          defaultServer,
    password:           defaultPass,
    encryptionPassword: defaultEncPass,
  });

  // Additional budgets (BUDGET_1_*, BUDGET_2_*, …)
  for (let n = 1; n <= 20; n++) {
    const name = process.env[`BUDGET_${n}_NAME`];
    if (!name) break;
    const syncId = process.env[`BUDGET_${n}_SYNC_ID`];
    if (!syncId) continue;
    budgets.push({
      name,
      syncId,
      serverUrl:          process.env[`BUDGET_${n}_SERVER_URL`]           || defaultServer,
      password:           process.env[`BUDGET_${n}_PASSWORD`]             || defaultPass,
      encryptionPassword: process.env[`BUDGET_${n}_ENCRYPTION_PASSWORD`]  || '',
    });
  }

  return budgets;
}

// ---------------------------------------------------------------------------
// Logger — writes to console + optional file
// ---------------------------------------------------------------------------
class Logger {
  constructor(logFilePath) {
    this.logFilePath = logFilePath; // null = console only
    this.entries = [];
    this.runId = randomUUID().slice(0, 8);
  }

  _format(level, message, extra) {
    return JSON.stringify({
      ts:    new Date().toISOString(),
      level,
      runId: this.runId,
      message,
      ...(extra && Object.keys(extra).length > 0 ? { extra } : {}),
    });
  }

  async _write(level, message, extra = {}) {
    const line = this._format(level, message, extra);
    this.entries.push(line);

    // Console pretty-print
    const ts      = new Date().toISOString().replace('T', ' ').slice(0, 23);
    const prefix  = { INFO: '  ', WARN: '⚠ ', ERROR: '✗ ', DEBUG: '· ' }[level] ?? '  ';
    const extras  = Object.keys(extra).length
      ? '  ' + Object.entries(extra).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ')
      : '';
    console.log(`${ts} [${level}] ${prefix}${message}${extras}`);

    // File append
    if (this.logFilePath) {
      await appendFile(this.logFilePath, line + '\n').catch(() => {});
    }
  }

  info(msg, extra)  { return this._write('INFO',  msg, extra); }
  warn(msg, extra)  { return this._write('WARN',  msg, extra); }
  error(msg, extra) { return this._write('ERROR', msg, extra); }
  debug(msg, extra) { return this._write('DEBUG', msg, extra); }
}

// ---------------------------------------------------------------------------
// Bank sync per account — wraps with timeout + handles unhandled rejections
// ---------------------------------------------------------------------------
async function syncAccount(api, account, timeoutMs, logger) {
  const label = `${account.name} (${account.id})`;
  await logger.info(`  Starting bank sync`, { account: account.name, id: account.id });

  const result = { account: account.name, id: account.id, status: 'unknown', error: null };

  // We capture any BankSyncError that surfaces as unhandledRejection during this
  // account's sync window. The SDK sometimes fires these out-of-band.
  let capturedRejection = null;
  const rejectionHandler = (reason) => {
    const msg = reason?.message || String(reason);
    if (
      reason?.type === 'BankSyncError' ||
      msg.includes('BankSyncError') ||
      msg.includes('NORDIGEN_ERROR') ||
      msg.includes('Rate limit exceeded') ||
      msg.includes('Failed syncing account') ||
      msg.includes('GoCardless') ||
      msg.includes('SimpleFIN')
    ) {
      capturedRejection = reason;
    }
  };
  process.on('unhandledRejection', rejectionHandler);

  try {
    const syncPromise = api.runBankSync({ accountId: account.id });
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${timeoutMs / 1000}s`)), timeoutMs)
    );
    await Promise.race([syncPromise, timeoutPromise]);

    // Small delay for SDK background operations (pattern from Actual-sync)
    await new Promise(resolve => setTimeout(resolve, 600));

    // Check if a background rejection arrived during the delay
    if (capturedRejection) {
      throw capturedRejection;
    }

    result.status = 'success';
    await logger.info(`  ✓ Bank sync completed`, { account: account.name });
  } catch (err) {
    const msg = err?.message || String(err);
    const category = err?.category || '';
    result.status = 'failed';
    result.error  = msg;

    if (category === 'RATE_LIMIT_EXCEEDED' || msg.includes('Rate limit exceeded') || msg.includes('RATE_LIMIT_EXCEEDED')) {
      const reset = err?.details?.rateLimitHeaders?.http_x_ratelimit_account_success_reset;
      const hint  = reset ? ` Retry in ~${Math.ceil(Number(reset) / 60)} min.` : '';
      await logger.warn(`  ⚠ Rate limit exceeded — account not synced.${hint}`, {
        account: account.name,
        code: err?.code || 'RATE_LIMIT_EXCEEDED',
      });
      result.error = `RATE_LIMIT_EXCEEDED${hint}`;
    } else if (
      msg.includes('not configured') ||
      msg.includes('No bank account') ||
      msg.includes('not linked') ||
      msg === '{}'
    ) {
      await logger.info(`  ↷ Not configured for bank sync (no GoCardless/SimpleFIN link)`, {
        account: account.name,
      });
      result.status = 'not_configured';
    } else {
      await logger.error(`  ✗ Bank sync failed`, { account: account.name, error: msg });
    }
  } finally {
    process.off('unhandledRejection', rejectionHandler);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const runStart = Date.now();

  // ── log file setup ────────────────────────────────────────────────────────
  let logFilePath = null;
  if (!noFileLog) {
    const logDir = process.env.DIRECT_SYNC_LOG_DIR
      ? resolve(process.env.DIRECT_SYNC_LOG_DIR)
      : resolve(projectRoot, 'logs');
    await mkdir(logDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    logFilePath = resolve(logDir, `direct-sync-${ts}.log`);
  }

  const logger = new Logger(logFilePath);

  if (logFilePath) {
    await logger.info(`Log file: ${logFilePath}`);
  }

  // ── seat unhandledRejection guard (non-fatal bank sync errors) ────────────
  process.on('unhandledRejection', (reason) => {
    const msg = String(reason?.message || reason);
    if (
      reason?.type === 'BankSyncError' ||
      msg.includes('BankSyncError') ||
      msg.includes('NORDIGEN_ERROR') ||
      msg.includes('Rate limit exceeded') ||
      msg.includes('Failed syncing account')
    ) {
      // swallowed — handled per-account in syncAccount()
      return;
    }
    console.error('[FATAL] Unhandled rejection:', reason);
    process.exit(1);
  });

  // ── resolve budget ────────────────────────────────────────────────────────
  let budgets;
  try {
    budgets = resolveBudgets();
  } catch (err) {
    await logger.error(err.message);
    process.exit(1);
  }

  let budget;
  if (budgetNameArg) {
    const key = budgetNameArg.toLowerCase();
    budget = budgets.find(b => b.name.toLowerCase().includes(key));
    if (!budget) {
      await logger.error(`Budget "${budgetNameArg}" not found.`, {
        available: budgets.map(b => b.name),
      });
      process.exit(1);
    }
  } else {
    budget = budgets[0];
  }

  await logger.info('='.repeat(60));
  await logger.info('Actual Budget Direct Sync Test');
  await logger.info('='.repeat(60));
  await logger.info(`Budget   : ${budget.name}`);
  await logger.info(`Server   : ${budget.serverUrl}`);
  await logger.info(`SyncId   : ${budget.syncId}`);
  await logger.info(`Mode     : ${listOnly ? 'LIST ONLY (no sync)' : 'FULL SYNC'}`);
  await logger.info('='.repeat(60));

  // ── data directory ────────────────────────────────────────────────────────
  const dataDir = process.env.ACTUAL_DATA_DIR
    ? resolve(process.env.ACTUAL_DATA_DIR)
    : resolve(os.tmpdir(), `actual-direct-sync-${process.pid}`);
  await mkdir(dataDir, { recursive: true });
  await logger.debug('Data directory ready', { dataDir });

  // ── load @actual-app/api ──────────────────────────────────────────────────
  let api;
  try {
    api = await import('@actual-app/api');
  } catch {
    await logger.error(
      'Cannot load @actual-app/api. Make sure you run this from the project root: ' +
      'node scripts/direct-sync/bank-sync-direct.mjs'
    );
    process.exit(1);
  }

  // ── connect ───────────────────────────────────────────────────────────────
  await logger.info('Connecting to Actual Budget server...');
  try {
    await api.init({
      dataDir,
      serverURL: budget.serverUrl,
      password:  budget.password,
    });
    await logger.info('Connected ✓');
  } catch (err) {
    await logger.error('Connection failed', { error: err.message });
    process.exit(1);
  }

  // ── download budget ───────────────────────────────────────────────────────
  await logger.info('Downloading budget file...');
  try {
    if (budget.encryptionPassword) {
      await api.downloadBudget(budget.syncId, { password: budget.encryptionPassword });
    } else {
      await api.downloadBudget(budget.syncId);
    }
    await logger.info('Budget downloaded ✓');
  } catch (err) {
    await logger.error('Budget download failed', { error: err.message });
    try { await api.shutdown(); } catch {}
    process.exit(1);
  }

  // ── fetch accounts ────────────────────────────────────────────────────────
  await logger.info('Fetching accounts...');
  let accounts;
  try {
    accounts = await api.getAccounts();
  } catch (err) {
    await logger.error('getAccounts failed', { error: err.message });
    try { await api.shutdown(); } catch {}
    process.exit(1);
  }

  if (!Array.isArray(accounts) || accounts.length === 0) {
    await logger.warn('No accounts found in this budget.');
    try { await api.shutdown(); } catch {}
    process.exit(0);
  }

  await logger.info(`Found ${accounts.length} account(s):`);
  for (const [i, acct] of accounts.entries()) {
    const flags = [
      acct.offbudget ? 'off-budget' : 'on-budget',
      acct.closed    ? 'closed'     : 'open',
    ].join(', ');
    await logger.info(`  ${i + 1}. ${acct.name}`, { id: acct.id, flags });
  }

  // ── bank sync ─────────────────────────────────────────────────────────────
  if (listOnly) {
    await logger.info('Skipping bank sync (--list / --dry-run mode).');
    try { await api.shutdown(); } catch {}
  } else {
    const timeoutMs = parseInt(process.env.BANK_SYNC_TIMEOUT_MS || '60000', 10);
    await logger.info('='.repeat(60));
    await logger.info(`Starting bank sync — ${accounts.length} account(s), timeout: ${timeoutMs / 1000}s each`);
    await logger.info('='.repeat(60));

    const results = [];
    for (const account of accounts) {
      if (account.closed) {
        await logger.info(`  ↷ Skipping closed account`, { account: account.name });
        results.push({ account: account.name, id: account.id, status: 'skipped_closed', error: null });
        continue;
      }
      const r = await syncAccount(api, account, timeoutMs, logger);
      results.push(r);
    }

    // ── shutdown ──────────────────────────────────────────────────────────
    await logger.info('Shutting down API connection...');
    try {
      await api.shutdown();
      await logger.info('Shutdown complete ✓');
    } catch (err) {
      await logger.warn('Shutdown error (non-fatal)', { error: err.message });
    }

    // ── summary ───────────────────────────────────────────────────────────
    const durationS = ((Date.now() - runStart) / 1000).toFixed(1);
    const ok           = results.filter(r => r.status === 'success').length;
    const failed       = results.filter(r => r.status === 'failed').length;
    const notConfigured = results.filter(r => r.status === 'not_configured').length;
    const skipped      = results.filter(r => r.status === 'skipped_closed').length;

    await logger.info('='.repeat(60));
    await logger.info('SUMMARY');
    await logger.info('='.repeat(60));
    await logger.info(`Total accounts    : ${accounts.length}`);
    await logger.info(`Synced OK         : ${ok}`);
    await logger.info(`Not configured    : ${notConfigured}`);
    await logger.info(`Failed            : ${failed}`);
    await logger.info(`Skipped (closed)  : ${skipped}`);
    await logger.info(`Duration          : ${durationS}s`);
    if (logFilePath) {
      await logger.info(`Log file          : ${logFilePath}`);
    }
    await logger.info('='.repeat(60));

    // Per-account result table
    for (const r of results) {
      const icon = {
        success:        '✓',
        not_configured: '↷',
        skipped_closed: '-',
        failed:         '✗',
        unknown:        '?',
      }[r.status] ?? '?';
      const detail = r.error ? `  [${r.error}]` : '';
      await logger.info(`  ${icon} ${r.account}${detail}`);
    }

    process.exit(failed > 0 ? 1 : 0);
  }
}

main().catch(async (err) => {
  console.error('[FATAL]', err.message || err);
  process.exit(1);
});
