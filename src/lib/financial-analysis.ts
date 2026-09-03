// Deterministic financial-analysis primitives: pure functions that turn a snapshot of Actual
// Budget rows into aggregated, integer-cent totals, so the accounting is computed in server code
// rather than re-derived by an LLM.
//
// Original implementation by @maxvanweenen (PR #399, https://github.com/agigante80/actual-mcp-server/pull/399),
// requested in #398. This file is the aggregate slice (the `actual_transactions_aggregate` tool,
// #424); the account-flow and recurring-expense functions land with their own tools (#425, #426).
//
// PURE by design: no api session, no module state, so every branch is unit-testable against fixed
// rows. The adapter owns the impure half (fetching the snapshot) in `getFinancialAnalysisSnapshot`.

export type AnalysisAccount = {
  id: string;
  name: string;
  offbudget?: boolean | number;
  closed?: boolean | number;
};

export type AnalysisCategory = {
  id: string;
  name: string;
  is_income?: boolean | number;
  group?: string | null;
};

export type AnalysisCategoryGroup = {
  id: string;
  name: string;
  is_income?: boolean | number;
};

export type AnalysisPayee = {
  id: string;
  name: string;
  transfer_acct?: string | null;
};

export type AnalysisTransaction = {
  id: string;
  date: string;
  amount: number;
  account: string;
  category?: string | null;
  payee?: string | null;
  transfer_id?: string | null;
  is_parent?: boolean;
  is_child?: boolean;
  parent_id?: string | null;
  starting_balance_flag?: boolean;
  schedule?: string | null;
  subtransactions?: AnalysisTransaction[];
};

export type FinancialAnalysisSnapshot = {
  transactions: AnalysisTransaction[];
  // Transfer counterparts and opening/closing balances are populated only by the tools that need
  // them (account-flow, #425, passes balanceAccountIds); the aggregate tool leaves them unset.
  transferCounterparts?: AnalysisTransaction[];
  accounts: AnalysisAccount[];
  categories: AnalysisCategory[];
  categoryGroups: AnalysisCategoryGroup[];
  payees: AnalysisPayee[];
  openingBalances?: Record<string, number>;
  closingBalances?: Record<string, number>;
};

export type ExternalClassification =
  | 'expense'
  | 'credit'
  | 'income'
  | 'uncategorized-inflow'
  | 'adjustment'
  | 'transfer';

export type GroupDimension = 'month' | 'category' | 'category_group' | 'payee' | 'account';

export type AggregateInput = {
  startDate: string;
  endDate: string;
  groupBy: GroupDimension[];
  accountIds?: string[];
  categoryIds?: string[];
  categoryGroupIds?: string[];
  payeeIds?: string[];
  includeIncome: boolean;
  excludeTransfers: boolean;
};

export type AggregateValues = {
  expenseOutflow: number;
  credits: number;
  netExpense: number;
  income: number;
  uncategorizedInflows: number;
  adjustments: number;
  transferInflow: number;
  transferOutflow: number;
  transactionCount: number;
  transferCount: number;
};

type Maps = ReturnType<typeof buildMaps>;

const zeroAggregate = (): AggregateValues => ({
  expenseOutflow: 0,
  credits: 0,
  netExpense: 0,
  income: 0,
  uncategorizedInflows: 0,
  adjustments: 0,
  transferInflow: 0,
  transferOutflow: 0,
  transactionCount: 0,
  transferCount: 0,
});

function bool(value: boolean | number | undefined): boolean {
  return value === true || value === 1;
}

// Money is integer cents everywhere. A non-integer amount is a data-shape error, not something to
// round, so it throws rather than silently corrupting a total.
function integer(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(`${field} must be a safe integer number of cents.`);
  }
  return value;
}

export function buildMaps(snapshot: FinancialAnalysisSnapshot) {
  return {
    accounts: new Map(snapshot.accounts.map(account => [account.id, account])),
    categories: new Map(snapshot.categories.map(category => [category.id, category])),
    categoryGroups: new Map(snapshot.categoryGroups.map(group => [group.id, group])),
    payees: new Map(snapshot.payees.map(payee => [payee.id, payee])),
    transactions: new Map(
      [...snapshot.transactions, ...(snapshot.transferCounterparts ?? [])].flatMap(transaction => [
        transaction,
        ...(transaction.subtransactions ?? []),
      ]).map(transaction => [transaction.id, transaction]),
    ),
  };
}

/**
 * Convert Actual's grouped split representation into posting rows. A normal transaction appears
 * once. A split contributes its CHILDREN and never its parent, so a split is counted exactly once.
 * A `seen` set dedups a child that arrives both grouped and top-level, in either order.
 */
export function postingRows(transactions: AnalysisTransaction[]): AnalysisTransaction[] {
  const rows: AnalysisTransaction[] = [];
  const seen = new Set<string>();

  for (const transaction of transactions) {
    if (transaction.is_parent === true || (transaction.subtransactions?.length ?? 0) > 0) {
      for (const child of transaction.subtransactions ?? []) {
        if (seen.has(child.id)) continue;
        seen.add(child.id);
        rows.push({
          ...child,
          account: child.account ?? transaction.account,
          date: child.date ?? transaction.date,
          payee: child.payee ?? transaction.payee,
          parent_id: child.parent_id ?? transaction.id,
          is_child: true,
        });
      }
      continue;
    }

    if (transaction.parent_id != null || transaction.is_child === true) {
      if (!seen.has(transaction.id)) {
        seen.add(transaction.id);
        rows.push(transaction);
      }
      continue;
    }

    if (!seen.has(transaction.id)) {
      seen.add(transaction.id);
      rows.push(transaction);
    }
  }

  return rows;
}

/**
 * Classify a posting row. A TRANSFER is detected from `transfer_id` FIRST, before any category or
 * income logic, so a transfer is never spending or income regardless of how it is categorized. That
 * is the exact fragility #398 identified in the existing summary tools.
 */
export function classifyExternal(
  transaction: AnalysisTransaction,
  category: AnalysisCategory | undefined,
): ExternalClassification {
  if (transaction.transfer_id != null) return 'transfer';
  if (transaction.starting_balance_flag === true) return 'adjustment';

  const amount = integer(transaction.amount, `Transaction ${transaction.id} amount`);
  if (category && bool(category.is_income)) return 'income';
  if (amount < 0) return 'expense';
  if (amount > 0 && category) return 'credit';
  if (amount > 0) return 'uncategorized-inflow';
  return 'expense';
}

function groupingFields(transaction: AnalysisTransaction, dimensions: GroupDimension[], maps: Maps) {
  const category = transaction.category ? maps.categories.get(transaction.category) : undefined;
  const categoryGroup = category?.group ? maps.categoryGroups.get(category.group) : undefined;
  const payee = transaction.payee ? maps.payees.get(transaction.payee) : undefined;
  const account = maps.accounts.get(transaction.account);
  const fields: Record<string, string | null> = {};

  for (const dimension of dimensions) {
    if (dimension === 'month') fields.month = transaction.date.slice(0, 7);
    if (dimension === 'category') {
      fields.categoryId = category?.id ?? null;
      fields.categoryName = category?.name ?? 'Uncategorized';
    }
    if (dimension === 'category_group') {
      fields.categoryGroupId = categoryGroup?.id ?? null;
      fields.categoryGroupName = categoryGroup?.name ?? 'Uncategorized';
    }
    if (dimension === 'payee') {
      fields.payeeId = payee?.id ?? null;
      fields.payeeName = payee?.name ?? 'Unknown payee';
    }
    if (dimension === 'account') {
      fields.accountId = transaction.account;
      fields.accountName = account?.name ?? transaction.account;
    }
  }

  return fields;
}

function matchesFilters(transaction: AnalysisTransaction, input: AggregateInput, maps: Maps): boolean {
  if (transaction.date < input.startDate || transaction.date > input.endDate) return false;
  if (input.accountIds && !input.accountIds.includes(transaction.account)) return false;
  if (input.categoryIds && (!transaction.category || !input.categoryIds.includes(transaction.category))) return false;
  if (input.payeeIds && (!transaction.payee || !input.payeeIds.includes(transaction.payee))) return false;
  if (input.categoryGroupIds) {
    const groupId = transaction.category ? maps.categories.get(transaction.category)?.group : undefined;
    if (!groupId || !input.categoryGroupIds.includes(groupId)) return false;
  }
  return true;
}

function addAggregate(target: AggregateValues, source: AggregateValues): void {
  target.expenseOutflow += source.expenseOutflow;
  target.credits += source.credits;
  target.income += source.income;
  target.uncategorizedInflows += source.uncategorizedInflows;
  target.adjustments += source.adjustments;
  target.transferInflow += source.transferInflow;
  target.transferOutflow += source.transferOutflow;
  target.transactionCount += source.transactionCount;
  target.transferCount += source.transferCount;
  target.netExpense = target.expenseOutflow - target.credits;
}

/**
 * Group posting rows over an inclusive date range into integer-cent totals. Transfers are excluded
 * by default (kept in their own inflow/outflow fields when `excludeTransfers` is false); income is
 * excluded unless `includeIncome`. Deliberately groups IN PROCESS rather than via a `.groupBy`
 * query, because a grouped query would flatten splits back to inline and reintroduce double-count.
 */
export function aggregateTransactions(snapshot: FinancialAnalysisSnapshot, input: AggregateInput) {
  const maps = buildMaps(snapshot);
  const grouped = new Map<string, { dimensions: Record<string, string | null>; values: AggregateValues }>();

  for (const transaction of postingRows(snapshot.transactions)) {
    if (!matchesFilters(transaction, input, maps)) continue;
    const category = transaction.category ? maps.categories.get(transaction.category) : undefined;
    const classification = classifyExternal(transaction, category);
    if (classification === 'income' && !input.includeIncome) continue;
    if (classification === 'transfer' && input.excludeTransfers) continue;

    const dimensions = groupingFields(transaction, input.groupBy, maps);
    const key = JSON.stringify(dimensions);
    const entry = grouped.get(key) ?? { dimensions, values: zeroAggregate() };
    const amount = integer(transaction.amount, `Transaction ${transaction.id} amount`);

    if (classification === 'expense') entry.values.expenseOutflow += Math.abs(amount);
    if (classification === 'credit') entry.values.credits += amount;
    if (classification === 'income') entry.values.income += amount;
    if (classification === 'uncategorized-inflow') entry.values.uncategorizedInflows += amount;
    if (classification === 'adjustment') entry.values.adjustments += amount;
    if (classification === 'transfer') {
      if (amount >= 0) entry.values.transferInflow += amount;
      else entry.values.transferOutflow += Math.abs(amount);
      entry.values.transferCount += 1;
    } else {
      entry.values.transactionCount += 1;
    }
    entry.values.netExpense = entry.values.expenseOutflow - entry.values.credits;
    grouped.set(key, entry);
  }

  const groups = [...grouped.values()]
    .sort((a, b) => JSON.stringify(a.dimensions).localeCompare(JSON.stringify(b.dimensions)))
    .map(entry => ({ ...entry.dimensions, ...entry.values }));
  const totals = zeroAggregate();
  for (const entry of grouped.values()) addAggregate(totals, entry.values);

  return { dateRange: { startDate: input.startDate, endDate: input.endDate }, groups, totals };
}

// ---- Account flow (#425) --------------------------------------------------------------------------
// Explain the EXACT balance change across a set of accounts, separating external cash flow from
// transfers and reconciling to the penny. Original implementation by @maxvanweenen (PR #399).

export type AccountFlowInput = {
  startDate: string;
  endDate: string;
  accountIds: string[];
};

export function summarizeAccountFlow(snapshot: FinancialAnalysisSnapshot, input: AccountFlowInput) {
  const maps = buildMaps(snapshot);
  const selected = new Set(input.accountIds);
  // Dedupe once. The balance reduces and the accounts list below MUST key off the same unique set
  // the rows are filtered against, or a repeated id (two display names resolving to one account, say)
  // doubles the balances while the Set counts postings once, making reconciliation.difference non-zero
  // and falsifying the tool's exact-by-construction guarantee.
  const uniqueAccountIds = [...selected];
  const rows = postingRows(snapshot.transactions).filter(
    transaction => selected.has(transaction.account) && transaction.date >= input.startDate && transaction.date <= input.endDate,
  );

  let income = 0;
  let incomeReversals = 0;
  let expenseOutflow = 0;
  let credits = 0;
  let uncategorizedInflows = 0;
  let startingBalance = 0;
  let intoSelection = 0;
  let outOfSelection = 0;
  let withinSelection = 0;
  let withinSelectionTimingEffect = 0;
  let netTransferEffect = 0;
  const seenPairs = new Set<string>();
  const transfersByAccount: Array<Record<string, string | number | boolean | null>> = [];

  for (const transaction of rows) {
    const amount = integer(transaction.amount, `Transaction ${transaction.id} amount`);
    const category = transaction.category ? maps.categories.get(transaction.category) : undefined;
    const classification = classifyExternal(transaction, category);

    if (classification === 'expense') expenseOutflow += Math.abs(amount);
    if (classification === 'credit') credits += amount;
    if (classification === 'income') {
      if (amount >= 0) income += amount;
      else incomeReversals += Math.abs(amount);
    }
    if (classification === 'uncategorized-inflow') uncategorizedInflows += amount;
    if (classification === 'adjustment') startingBalance += amount;
    if (classification !== 'transfer') continue;

    netTransferEffect += amount;
    const counterpart = transaction.transfer_id ? maps.transactions.get(transaction.transfer_id) : undefined;
    const payee = transaction.payee ? maps.payees.get(transaction.payee) : undefined;
    const counterpartAccountId = counterpart?.account ?? payee?.transfer_acct ?? null;
    const counterpartSelected = counterpartAccountId ? selected.has(counterpartAccountId) : false;

    if (counterpartSelected) {
      withinSelectionTimingEffect += amount;
      const pairKey = [transaction.id, transaction.transfer_id ?? transaction.id].sort().join(':');
      if (!seenPairs.has(pairKey)) {
        seenPairs.add(pairKey);
        withinSelection += Math.abs(amount);
      }
    } else if (amount >= 0) {
      intoSelection += amount;
    } else {
      outOfSelection += Math.abs(amount);
    }

    const pairKey = [transaction.id, transaction.transfer_id ?? transaction.id].sort().join(':');
    if (!seenPairs.has(`detail:${pairKey}`)) {
      seenPairs.add(`detail:${pairKey}`);
      const fromId = amount < 0 ? transaction.account : counterpartAccountId;
      const toId = amount < 0 ? counterpartAccountId : transaction.account;
      transfersByAccount.push({
        fromAccountId: fromId,
        fromAccountName: fromId ? maps.accounts.get(fromId)?.name ?? fromId : null,
        toAccountId: toId,
        toAccountName: toId ? maps.accounts.get(toId)?.name ?? toId : null,
        amount: Math.abs(amount),
        date: transaction.date,
        withinSelection: counterpartSelected,
        matchedCounterpart: counterpart != null,
      });
    }
  }

  // The tool handler always supplies balances (via balanceAccountIds), so difference is exact here.
  // If a future caller omits them, both reduce to 0 and difference reads as a false "exact": #428.
  const openingBalance = uniqueAccountIds.reduce(
    (sum, id) => sum + integer(snapshot.openingBalances?.[id] ?? 0, `Opening balance for ${id}`),
    0,
  );
  const closingBalance = uniqueAccountIds.reduce(
    (sum, id) => sum + integer(snapshot.closingBalances?.[id] ?? 0, `Closing balance for ${id}`),
    0,
  );
  const balanceChange = closingBalance - openingBalance;
  const netExternalCashFlow = income - incomeReversals + credits + uncategorizedInflows - expenseOutflow;
  const totalAdjustments = startingBalance;
  const calculatedBalanceChange = netExternalCashFlow + netTransferEffect + totalAdjustments;

  return {
    dateRange: { startDate: input.startDate, endDate: input.endDate },
    accounts: uniqueAccountIds.map(id => ({ id, name: maps.accounts.get(id)?.name ?? id })),
    openingBalance,
    closingBalance,
    balanceChange,
    external: {
      income,
      incomeReversals,
      expenseOutflow,
      credits,
      uncategorizedInflows,
      netExternalCashFlow,
    },
    transfers: {
      intoSelection,
      outOfSelection,
      withinSelection,
      withinSelectionTimingEffect,
      netTransferEffect,
    },
    transfersByAccount: transfersByAccount.sort((a, b) =>
      `${a.date}:${a.fromAccountId}:${a.toAccountId}`.localeCompare(`${b.date}:${b.fromAccountId}:${b.toAccountId}`),
    ),
    adjustments: { startingBalance, total: totalAdjustments },
    reconciliation: {
      calculatedBalanceChange,
      actualBalanceChange: balanceChange,
      difference: balanceChange - calculatedBalanceChange,
    },
  };
}
