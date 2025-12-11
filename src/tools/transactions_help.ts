import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';

const InputSchema = z.object({
  topic: z
    .enum([
      'overview',
      'fields',
      'splits',
      'import',
      'search',
      'amounts',
      'reconciliation',
      'examples',
      'all',
    ])
    .optional()
    .describe(
      'Topic to get help on: overview, fields, splits, import, search, amounts, reconciliation, examples, all'
    ),
  keyword: z
    .string()
    .optional()
    .describe('Search for specific keyword in help content (e.g., "cleared", "split", "import")'),
});

const TRANSACTIONS_OVERVIEW = `
# Transactions Overview

Transactions are the core of Actual Budget, representing money movement in/out of accounts.

## Key Concepts

**Transaction Types:**
- **Regular Transaction**: Single entry (one account, one category)
- **Split Transaction**: Multiple categories for one transaction (e.g., grocery store: food + household items)
- **Transfer**: Money between accounts (marked by payee.transfer_acct)
- **Starting Balance**: Initial account balance (special payee)

**Transaction States:**
- **Cleared**: Transaction has cleared the bank (boolean)
- **Reconciled**: Transaction reconciled against statement (boolean)
- **Pending**: Not cleared yet (cleared=false)

**Amount Convention:**
- **Negative amounts**: Expenses/outflows (-5000 = -$50.00)
- **Positive amounts**: Income/inflows (10000 = $100.00)
- **Always in cents**: Never use decimals (5000, not 50.00)

## Available Tools

**Create/Modify:**
- \`actual_transactions_create\` - Create single transaction
- \`actual_transactions_update\` - Update existing transaction
- \`actual_transactions_delete\` - Delete transaction
- \`actual_transactions_import\` - Bulk import from array

**Retrieve:**
- \`actual_transactions_get\` - Get single transaction by ID
- \`actual_transactions_filter\` - Filter by account/date/amount
- \`actual_transactions_search_by_amount\` - Search by amount range
- \`actual_transactions_search_by_category\` - Search by category
- \`actual_transactions_search_by_month\` - Search by month
- \`actual_transactions_search_by_payee\` - Search by payee

**Aggregate:**
- \`actual_transactions_summary_by_category\` - Total per category
- \`actual_transactions_summary_by_payee\` - Total per payee

**Custom Queries:**
- \`actual_query_run\` - Custom ActualQL queries (use actual_query_help first!)
`;

const TRANSACTION_FIELDS = `
# Transaction Fields Reference

## Required Fields

**\`account\`** (string, UUID)
- Account ID where transaction occurs
- Get from \`actual_accounts_list\`
- Example: \`"550e8400-e29b-41d4-a716-446655440000"\`

**\`date\`** (string, YYYY-MM-DD)
- Transaction date (not time)
- Format: \`"2025-12-12"\`
- Cannot be in future (usually)

**\`amount\`** (integer, cents)
- Transaction amount in cents
- Negative = expense: \`-5000\` = -$50.00
- Positive = income: \`10000\` = $100.00
- Zero not allowed

## Optional Fields

**\`payee\`** (string, UUID or name)
- Payee UUID from \`actual_payees_get\`
- Or payee name (will create/match automatically)
- Example: \`"Amazon"\` or UUID
- For transfers: use account ID and it creates transfer payee

**\`category\`** (string, UUID)
- Category UUID from \`actual_categories_get\`
- Leave null/empty for uncategorized
- Income transactions: use income category

**\`notes\`** (string)
- Memo/notes field
- Searchable with \`$like\` operator in queries
- Example: \`"#recurring monthly subscription"\`

**\`cleared\`** (boolean)
- Default: \`false\`
- Set \`true\` when transaction clears bank
- Used in reconciliation

**\`reconciled\`** (boolean)
- Default: \`false\`
- Set \`true\` after reconciling statement
- Reconciled transactions shouldn't be modified

**\`imported_id\`** (string)
- External ID from bank import
- Prevents duplicate imports
- Usually bank's transaction ID

**\`imported_payee\`** (string)
- Original payee name from import
- Before payee rules applied
- Useful for debugging rules

**\`transfer_id\`** (string, UUID)
- Links transfer transactions
- Automatically set for transfers
- Don't set manually

**\`subtransactions\`** (array)
- For split transactions only
- See Split Transactions section
- Each has: amount, category, notes

## Field Validation Rules

**UUIDs:**
- Format: \`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx\`
- 36 characters with hyphens
- Use actual UUIDs from your budget data

**Dates:**
- Must be valid calendar date
- Format: YYYY-MM-DD (ISO 8601)
- No times or timezones

**Amounts:**
- Integer only (no decimals)
- Range: -2147483648 to 2147483647 (int32)
- In cents: multiply dollars by 100

**Booleans:**
- Use \`true\` or \`false\`
- Not strings: \`"true"\` is wrong

## Read-Only Fields

**\`id\`** (string, UUID)
- Transaction UUID
- Auto-generated on create
- Use for updates/deletes

**\`is_parent\`** (boolean)
- True if transaction has splits
- Read-only, computed field

**\`is_child\`** (boolean)
- True if transaction is a split subtransaction
- Read-only, computed field

**\`sort_order\`** (number)
- Display order for same date
- Auto-managed by Actual
`;

const SPLIT_TRANSACTIONS = `
# Split Transactions

Split transactions divide one transaction across multiple categories.

## When to Use Splits

**Use split transactions for:**
- Mixed-category purchases (grocery store: food + household)
- Partial reimbursements (meal: $50 personal, $20 business)
- Shared expenses (bill split between categories)
- Complex income (paycheck: salary + bonus + reimbursement)

**Don't use splits for:**
- Multiple separate transactions (use separate transactions!)
- Transfers (use transfer payee)
- Simple single-category transactions

## Creating Split Transactions

### Method 1: Single API Call with Subtransactions

\`\`\`javascript
{
  account: "account-uuid",
  date: "2025-12-12",
  amount: -7500,  // Total: -$75.00
  payee: "Target",
  notes: "Shopping trip",
  subtransactions: [
    {
      amount: -5000,  // -$50.00
      category: "groceries-category-uuid",
      notes: "Food items"
    },
    {
      amount: -2500,  // -$25.00
      category: "household-category-uuid",
      notes: "Cleaning supplies"
    }
  ]
}
\`\`\`

**Important:**
- Parent \`amount\` must equal sum of subtransaction amounts
- Each subtransaction needs: amount, category (optional: notes)
- Parent category is ignored (can be null)

### Method 2: Create Parent Then Add Splits

\`\`\`javascript
// 1. Create parent transaction
const parent = await actual_transactions_create({
  account: "account-uuid",
  date: "2025-12-12",
  amount: -7500,
  payee: "Target"
});

// 2. Update with splits
await actual_transactions_update({
  id: parent.id,
  subtransactions: [
    { amount: -5000, category: "groceries-uuid" },
    { amount: -2500, category: "household-uuid" }
  ]
});
\`\`\`

## Querying Split Transactions

See \`actual_query_help\` for detailed info on split handling.

**Three query modes:**

### 1. inline (Default)
Returns only subtransactions, hides parent.
\`\`\`javascript
q('transactions')
  .select('*')
  .options({ splits: 'inline' })  // Default
// Result: Flat array with subtransactions only
// Good for: Summing amounts (no double-counting)
\`\`\`

### 2. grouped
Returns parent with nested subtransactions.
\`\`\`javascript
q('transactions')
  .select('*')
  .options({ splits: 'grouped' })
// Result: Parent with subtransactions array
// Good for: Displaying split structure
\`\`\`

### 3. all
Returns both parent and subtransactions separately.
\`\`\`javascript
q('transactions')
  .select('*')
  .options({ splits: 'all' })
// Result: Flat array with duplicates
// Good for: Advanced processing
\`\`\`

## Modifying Split Transactions

**Update parent:**
\`\`\`javascript
await actual_transactions_update({
  id: "parent-uuid",
  notes: "Updated notes"  // Affects parent only
});
\`\`\`

**Update split distribution:**
\`\`\`javascript
await actual_transactions_update({
  id: "parent-uuid",
  subtransactions: [
    { amount: -6000, category: "cat1-uuid" },  // Changed from -5000
    { amount: -1500, category: "cat2-uuid" }   // Changed from -2500
  ]
});
\`\`\`

**Delete split (convert to regular):**
\`\`\`javascript
await actual_transactions_update({
  id: "parent-uuid",
  category: "groceries-uuid",  // Set single category
  subtransactions: []          // Clear splits
});
\`\`\`

## Common Mistakes

❌ **Amounts don't sum:**
\`\`\`javascript
{
  amount: -7500,
  subtransactions: [
    { amount: -5000 },
    { amount: -3000 }  // Total = -8000 ≠ -7500 ERROR!
  ]
}
\`\`\`

❌ **Setting parent category:**
\`\`\`javascript
{
  amount: -7500,
  category: "food-uuid",  // Ignored! Use subtransaction categories
  subtransactions: [...]
}
\`\`\`

❌ **Missing subtransaction amounts:**
\`\`\`javascript
{
  subtransactions: [
    { category: "food-uuid" }  // Missing amount! ERROR
  ]
}
\`\`\`

✅ **Correct split:**
\`\`\`javascript
{
  amount: -7500,
  subtransactions: [
    { amount: -5000, category: "food-uuid" },
    { amount: -2500, category: "household-uuid" }
  ]
  // Sum: -5000 + -2500 = -7500 ✓
}
\`\`\`
`;

const IMPORT_GUIDE = `
# Importing Transactions

Import transactions in bulk from bank files or external sources.

## Using actual_transactions_import

**Syntax:**
\`\`\`javascript
actual_transactions_import({
  account: "account-uuid",
  transactions: [
    {
      date: "2025-12-01",
      amount: -5000,
      payee: "Starbucks",
      notes: "Morning coffee",
      imported_id: "bank-txn-001"
    },
    {
      date: "2025-12-02",
      amount: 100000,
      payee: "Salary Deposit",
      category: "income-category-uuid",
      imported_id: "bank-txn-002"
    }
  ]
})
\`\`\`

## Import Fields

**Required in each transaction:**
- \`date\` - Transaction date (YYYY-MM-DD)
- \`amount\` - Amount in cents (negative=expense)

**Recommended:**
- \`imported_id\` - External ID (prevents duplicates)
- \`payee\` - Payee name (auto-creates if new)
- \`notes\` - Transaction memo

**Optional:**
- \`category\` - Category UUID (leave empty for uncategorized)
- \`cleared\` - Usually \`true\` for imports
- \`imported_payee\` - Original payee name before rules

## Duplicate Prevention

**Using imported_id:**
\`\`\`javascript
{
  imported_id: "BANK-2025-12-01-001",  // Unique per transaction
  // ... other fields
}
\`\`\`

Actual Budget checks \`imported_id\` and skips if already imported.

**Without imported_id:**
Risk of duplicate imports! Manual deduplication required.

## Import Processing Flow

1. **Import transactions** (\`actual_transactions_import\`)
2. **Payee rules apply automatically** (creates payees, matches existing)
3. **Manual categorization** (if rules don't match)
4. **Reconcile** (mark as reconciled after verifying)

## Payee Mapping

**Auto-create payees:**
\`\`\`javascript
{
  payee: "New Coffee Shop",  // Creates payee if doesn't exist
  imported_payee: "NEW COFFEE SHOP #123"  // Original from bank
}
\`\`\`

**Use existing payee:**
\`\`\`javascript
{
  payee: "existing-payee-uuid",  // Use UUID for exact match
}
\`\`\`

**Payee rules trigger:**
Actual's payee rules automatically match and categorize based on \`imported_payee\`.

## Import Best Practices

1. **Always set imported_id** - Prevents duplicates
2. **Import cleared transactions** - Set \`cleared: true\`
3. **Keep imported_payee** - Helps debug rule matching
4. **Import in date order** - Easier to reconcile
5. **Batch imports** - More efficient than one-by-one
6. **Verify after import** - Use \`actual_transactions_filter\` to check

## Import Validation

**Amount validation:**
\`\`\`javascript
// ✅ Correct
{ amount: -5000 }   // -$50.00 expense
{ amount: 100000 }  // $1000.00 income

// ❌ Wrong
{ amount: -50.00 }  // Decimals not allowed!
{ amount: "-50" }   // Strings not allowed!
\`\`\`

**Date validation:**
\`\`\`javascript
// ✅ Correct
{ date: "2025-12-12" }

// ❌ Wrong
{ date: "12/12/2025" }      // Wrong format
{ date: "2025-12-12T00:00" } // No timestamps
\`\`\`

## Error Handling

**Import failures:**
- Invalid dates: Check YYYY-MM-DD format
- Invalid amounts: Must be integers (cents)
- Missing account: Verify account UUID exists
- Duplicate imported_id: Transaction already imported (this is OK!)

## Example: Bank CSV Import Workflow

\`\`\`javascript
// 1. Parse CSV (your code)
const csvData = parseBankCSV(file);

// 2. Transform to Actual format
const transactions = csvData.map(row => ({
  date: formatDate(row.date),
  amount: parseAmountToCents(row.amount),
  payee: row.description,
  imported_id: row.transaction_id,
  imported_payee: row.description,
  cleared: true
}));

// 3. Import to Actual
const result = await actual_transactions_import({
  account: accountUuid,
  transactions: transactions
});

// 4. Check results
console.log(\`Imported: \${result.imported}, Duplicates: \${result.duplicates}\`);

// 5. Categorize uncategorized
const uncategorized = await actual_transactions_filter({
  account: accountUuid,
  category: null  // or empty string
});
// ... categorize manually or with rules
\`\`\`
`;

const SEARCH_GUIDE = `
# Searching & Filtering Transactions

Multiple tools for finding transactions with different trade-offs.

## Tool Comparison

| Tool | Use Case | Flexibility | Performance |
|------|----------|-------------|-------------|
| \`actual_transactions_get\` | Get by ID | Single transaction | Fastest |
| \`actual_transactions_filter\` | Common filters | Medium | Fast |
| \`actual_transactions_search_by_*\` | Specific searches | Low | Fast |
| \`actual_query_run\` | Custom queries | Highest | Varies |

## actual_transactions_filter

General-purpose filtering with common criteria.

**Syntax:**
\`\`\`javascript
actual_transactions_filter({
  account: "account-uuid",      // Optional
  startDate: "2025-01-01",      // Optional
  endDate: "2025-12-31",        // Optional
  minAmount: -100000,           // Optional (cents)
  maxAmount: 0,                 // Optional (cents)
  category: "category-uuid",    // Optional
  payee: "payee-uuid"           // Optional
})
\`\`\`

**Examples:**
\`\`\`javascript
// All transactions in account for December
await actual_transactions_filter({
  account: "account-uuid",
  startDate: "2025-12-01",
  endDate: "2025-12-31"
});

// Expenses over $100 in specific category
await actual_transactions_filter({
  category: "food-uuid",
  maxAmount: -10000  // More negative = larger expense
});

// All transactions with specific payee
await actual_transactions_filter({
  payee: "amazon-uuid"
});
\`\`\`

## actual_transactions_search_by_amount

Search by amount range (simple).

\`\`\`javascript
// Large expenses (over $500)
await actual_transactions_search_by_amount({
  minAmount: -999999999,
  maxAmount: -50000
});

// Income over $1000
await actual_transactions_search_by_amount({
  minAmount: 100000,
  maxAmount: 999999999
});
\`\`\`

## actual_transactions_search_by_category

Search by category UUID or name.

\`\`\`javascript
// By category UUID (exact)
await actual_transactions_search_by_category({
  category: "category-uuid"
});

// By category name (matches multiple if same name)
await actual_transactions_search_by_category({
  category: "Food"
});
\`\`\`

## actual_transactions_search_by_month

Search by year-month.

\`\`\`javascript
await actual_transactions_search_by_month({
  month: "2025-12"  // All transactions in December 2025
});
\`\`\`

## actual_transactions_search_by_payee

Search by payee UUID or name.

\`\`\`javascript
// By payee UUID (exact)
await actual_transactions_search_by_payee({
  payee: "payee-uuid"
});

// By payee name
await actual_transactions_search_by_payee({
  payee: "Starbucks"
});
\`\`\`

## actual_query_run (Advanced)

Use ActualQL for complex queries. See \`actual_query_help\` for full documentation.

**Examples:**

### Uncategorized transactions:
\`\`\`javascript
await actual_query_run({
  query: "SELECT * FROM transactions WHERE category IS NULL OR category = '' ORDER BY date DESC"
});
\`\`\`

### Transactions with specific note pattern:
\`\`\`javascript
await actual_query_run({
  query: "SELECT * FROM transactions WHERE notes LIKE '%#recurring%' ORDER BY date DESC"
});
\`\`\`

### Multiple payees (OR condition):
\`\`\`javascript
await actual_query_run({
  query: "SELECT * FROM transactions WHERE payee.name IN ('Starbucks', 'Peet\\'s Coffee', 'Blue Bottle') ORDER BY date DESC"
});
\`\`\`

### Complex date and amount filters:
\`\`\`javascript
await actual_query_run({
  query: \`
    SELECT t.date, t.amount, p.name as payee, c.name as category
    FROM transactions t
    JOIN payees p ON t.payee = p.id
    JOIN categories c ON t.category = c.id
    WHERE t.date >= '2025-01-01'
      AND t.date <= '2025-12-31'
      AND t.amount < -50000
      AND c.group.name = 'Essential'
    ORDER BY t.amount ASC
  \`
});
\`\`\`

## Search Performance Tips

1. **Always filter by date range** when possible (indexes exist)
2. **Use UUIDs for exact matches** (faster than name lookups)
3. **Use specific tools** before falling back to \`actual_query_run\`
4. **Limit result sets** for large date ranges
5. **Use indexed fields** (account, date, category, payee)

## Common Search Patterns

### Find duplicate transactions:
\`\`\`javascript
// Get all transactions in date range
const txns = await actual_transactions_filter({
  startDate: "2025-01-01",
  endDate: "2025-12-31"
});

// Find duplicates in JavaScript (ActualQL doesn't support this)
const duplicates = findDuplicates(txns, ['date', 'amount', 'payee']);
\`\`\`

### Find transactions without rules:
\`\`\`javascript
// 1. Get all uncategorized
const uncat = await actual_query_run({
  query: "SELECT * FROM transactions WHERE category IS NULL"
});

// 2. Get payee rules
const rules = await actual_rules_get();

// 3. Find which payees lack rules (in JavaScript)
\`\`\`

### Find outlier transactions:
\`\`\`javascript
// Very large expenses
await actual_transactions_search_by_amount({
  maxAmount: -100000  // Under -$1000
});

// Very large income
await actual_transactions_search_by_amount({
  minAmount: 500000  // Over $5000
});
\`\`\`
`;

const AMOUNTS_GUIDE = `
# Working with Amounts

Amount handling is critical - mistakes cause budget errors.

## Amount Format: Always Cents

**Rule: All amounts are integers in cents**

✅ **Correct:**
\`\`\`javascript
{ amount: -5000 }    // -$50.00 expense
{ amount: 10000 }    // $100.00 income
{ amount: -150 }     // -$1.50 expense
{ amount: 1 }        // $0.01 income
\`\`\`

❌ **Wrong:**
\`\`\`javascript
{ amount: -50.00 }   // Creates -$0.50 transaction!
{ amount: "-50" }    // String not allowed
{ amount: 50 }       // Positive = income, not expense
\`\`\`

## Converting Dollars to Cents

**JavaScript conversion:**
\`\`\`javascript
const dollars = -50.00;
const cents = Math.round(dollars * 100);  // -5000

// For user input strings
const userInput = "-$50.00";
const dollars = parseFloat(userInput.replace(/[^0-9.-]/g, ''));
const cents = Math.round(dollars * 100);
\`\`\`

**Common amounts:**
- $1.00 → \`100\`
- $10.00 → \`1000\`
- $100.00 → \`10000\`
- $1000.00 → \`100000\`
- -$0.99 → \`-99\`

## Expense vs Income

**Amount sign determines type:**
- **Negative amounts**: Money leaving account (expenses)
- **Positive amounts**: Money entering account (income)

\`\`\`javascript
// Expense: paid $50 for groceries
{ amount: -5000, category: "groceries-uuid" }

// Income: received $1000 salary
{ amount: 100000, category: "salary-uuid" }

// Transfer out: moved $200 to savings
{ amount: -20000, payee: "savings-account-uuid" }

// Transfer in: moved $200 from checking
{ amount: 20000, payee: "checking-account-uuid" }
\`\`\`

## Amount Ranges

**Valid range:** -2,147,483,648 to 2,147,483,647 (32-bit integer)
- Max expense: -$21,474,836.48
- Max income: $21,474,836.47

## Amount Validation

**Validate before creating:**
\`\`\`javascript
function validateAmount(amount) {
  if (typeof amount !== 'number') {
    throw new Error('Amount must be a number');
  }
  if (!Number.isInteger(amount)) {
    throw new Error('Amount must be an integer (cents)');
  }
  if (amount === 0) {
    throw new Error('Amount cannot be zero');
  }
  if (amount < -2147483648 || amount > 2147483647) {
    throw new Error('Amount out of valid range');
  }
  return true;
}
\`\`\`

## Display Formatting

**Convert cents to dollars for display:**
\`\`\`javascript
function formatAmount(cents) {
  const dollars = cents / 100;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(dollars);
}

formatAmount(-5000);   // "-$50.00"
formatAmount(100000);  // "$1,000.00"
formatAmount(-99);     // "-$0.99"
\`\`\`

## Amount Calculations

**Summing transactions:**
\`\`\`javascript
const total = transactions.reduce((sum, txn) => sum + txn.amount, 0);
const totalDollars = total / 100;
\`\`\`

**Averaging:**
\`\`\`javascript
const average = total / transactions.length;
const avgDollars = average / 100;
\`\`\`

**Budget remaining:**
\`\`\`javascript
const budgeted = 50000;  // $500.00 budgeted
const spent = -35000;    // -$350.00 spent
const remaining = budgeted + spent;  // 15000 = $150.00 remaining
\`\`\`

## Common Amount Mistakes

### Mistake 1: Using Decimals
\`\`\`javascript
❌ { amount: -50.00 }  // Creates -$0.50!
✅ { amount: -5000 }   // -$50.00
\`\`\`

### Mistake 2: Wrong Sign
\`\`\`javascript
❌ { amount: 5000, category: "groceries" }  // $50 income in groceries?
✅ { amount: -5000, category: "groceries" } // -$50 expense
\`\`\`

### Mistake 3: String Amounts
\`\`\`javascript
❌ { amount: "-5000" }  // String not accepted
✅ { amount: -5000 }    // Number
\`\`\`

### Mistake 4: Forgetting to Convert
\`\`\`javascript
❌ const userAmount = "$50.00";
   { amount: userAmount }  // Invalid

✅ const userAmount = "$50.00";
   const cents = Math.round(parseFloat(userAmount.replace('$', '')) * 100);
   { amount: -cents }  // -5000 (negative for expense)
\`\`\`

## Split Transaction Amounts

**Parent amount must equal sum of subtransactions:**

✅ **Correct:**
\`\`\`javascript
{
  amount: -7500,
  subtransactions: [
    { amount: -5000 },  // -$50.00
    { amount: -2500 }   // -$25.00
  ]
  // Total: -5000 + -2500 = -7500 ✓
}
\`\`\`

❌ **Wrong:**
\`\`\`javascript
{
  amount: -7500,
  subtransactions: [
    { amount: -5000 },
    { amount: -3000 }  // Total = -8000 ≠ -7500 ERROR!
  ]
}
\`\`\`
`;

const RECONCILIATION_GUIDE = `
# Transaction Reconciliation

Reconciling ensures your Actual Budget matches your bank statements.

## Reconciliation Workflow

### 1. Start Reconciliation
- Choose account to reconcile
- Get ending balance from bank statement
- Note statement date

### 2. Mark Cleared Transactions
\`\`\`javascript
// Mark transaction as cleared
await actual_transactions_update({
  id: "transaction-uuid",
  cleared: true
});
\`\`\`

### 3. Verify Balance
\`\`\`javascript
// Get account balance as of statement date
const balance = await actual_accounts_get_balance({
  id: "account-uuid",
  cutoff: "2025-12-31"  // Statement date
});

// Compare with bank statement
if (balance === statementBalance) {
  // Reconciled! Mark transactions as reconciled
} else {
  // Find discrepancies
}
\`\`\`

### 4. Mark Reconciled
\`\`\`javascript
// Mark cleared transactions as reconciled
await actual_transactions_update({
  id: "transaction-uuid",
  reconciled: true
});
\`\`\`

## Transaction States

**Pending** (\`cleared: false\`, \`reconciled: false\`)
- Transaction entered but not cleared bank
- May still be processing

**Cleared** (\`cleared: true\`, \`reconciled: false\`)
- Transaction cleared the bank
- Appears on current balance
- Not yet reconciled against statement

**Reconciled** (\`cleared: true\`, \`reconciled: true\`)
- Verified against bank statement
- Should not be modified
- Locked for historical accuracy

## Finding Discrepancies

### Get uncleared transactions:
\`\`\`javascript
const uncleared = await actual_query_run({
  query: \`
    SELECT * FROM transactions
    WHERE account = 'account-uuid'
      AND cleared = false
    ORDER BY date
  \`
});
\`\`\`

### Get cleared but unreconciled:
\`\`\`javascript
const toReconcile = await actual_query_run({
  query: \`
    SELECT * FROM transactions
    WHERE account = 'account-uuid'
      AND cleared = true
      AND reconciled = false
    ORDER BY date
  \`
});
\`\`\`

### Calculate balance at date:
\`\`\`javascript
const balance = await actual_accounts_get_balance({
  id: "account-uuid",
  cutoff: "2025-12-31"
});
\`\`\`

## Reconciliation Best Practices

1. **Reconcile monthly** - At least once per statement period
2. **Mark cleared regularly** - Don't wait for reconciliation
3. **Don't modify reconciled** - Historical integrity
4. **Track imported_id** - Helps identify bank transactions
5. **Use cleared filter** - \`cleared: false\` shows pending
6. **Verify balance first** - Before marking reconciled
7. **One account at a time** - Don't mix accounts

## Common Reconciliation Issues

### Balance Doesn't Match

**Check for:**
- Pending transactions (not cleared yet)
- Duplicate transactions (check imported_id)
- Missing transactions (compare with bank)
- Wrong amounts (data entry errors)
- Future-dated transactions (excluded from balance)

**Debug query:**
\`\`\`javascript
// Get all transactions affecting balance up to date
const txns = await actual_query_run({
  query: \`
    SELECT date, amount, payee.name, cleared, notes
    FROM transactions
    WHERE account = 'account-uuid'
      AND date <= '2025-12-31'
    ORDER BY date
  \`
});

// Calculate expected balance
const calculatedBalance = txns.reduce((sum, t) => sum + t.amount, 0);
\`\`\`

### Missing Transactions

**Find gaps in transaction dates:**
\`\`\`javascript
const allTxns = await actual_transactions_filter({
  account: "account-uuid",
  startDate: "2025-12-01",
  endDate: "2025-12-31"
});

// Check for date gaps in JavaScript
// Compare with bank statement line by line
\`\`\`

### Duplicate Transactions

**Find potential duplicates:**
\`\`\`javascript
const txns = await actual_transactions_filter({
  account: "account-uuid",
  startDate: "2025-12-01",
  endDate: "2025-12-31"
});

// Group by date+amount in JavaScript
const groups = {};
txns.forEach(t => {
  const key = \`\${t.date}-\${t.amount}\`;
  if (!groups[key]) groups[key] = [];
  groups[key].push(t);
});

// Find groups with multiple transactions
const duplicates = Object.values(groups).filter(g => g.length > 1);
\`\`\`

## Bulk Reconciliation

**Mark multiple transactions as cleared:**
\`\`\`javascript
// Get all transactions from statement
const statementTxns = await actual_transactions_filter({
  account: "account-uuid",
  startDate: "2025-12-01",
  endDate: "2025-12-31"
});

// Mark each as cleared
for (const txn of statementTxns) {
  if (!txn.cleared) {
    await actual_transactions_update({
      id: txn.id,
      cleared: true
    });
  }
}

// Verify balance matches
const balance = await actual_accounts_get_balance({
  id: "account-uuid",
  cutoff: "2025-12-31"
});

if (balance === expectedBalance) {
  // Mark all as reconciled
  for (const txn of statementTxns) {
    await actual_transactions_update({
      id: txn.id,
      reconciled: true
    });
  }
}
\`\`\`

## Reconciliation Report

**Generate reconciliation summary:**
\`\`\`javascript
const summary = await actual_query_run({
  query: \`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN cleared THEN 1 ELSE 0 END) as cleared,
      SUM(CASE WHEN reconciled THEN 1 ELSE 0 END) as reconciled,
      SUM(CASE WHEN NOT cleared THEN 1 ELSE 0 END) as pending
    FROM transactions
    WHERE account = 'account-uuid'
      AND date <= '2025-12-31'
  \`
});
\`\`\`
`;

const EXAMPLES = `
# Transaction Examples

## Example 1: Simple Expense
\`\`\`javascript
await actual_transactions_create({
  account: "checking-account-uuid",
  date: "2025-12-12",
  amount: -5000,  // -$50.00
  payee: "Starbucks",
  category: "coffee-category-uuid",
  notes: "Morning coffee",
  cleared: true
});
\`\`\`

## Example 2: Income Transaction
\`\`\`javascript
await actual_transactions_create({
  account: "checking-account-uuid",
  date: "2025-12-01",
  amount: 300000,  // $3000.00
  payee: "Employer",
  category: "salary-category-uuid",
  notes: "Monthly salary",
  cleared: true
});
\`\`\`

## Example 3: Split Transaction
\`\`\`javascript
await actual_transactions_create({
  account: "checking-account-uuid",
  date: "2025-12-12",
  amount: -12500,  // -$125.00 total
  payee: "Target",
  notes: "Weekly shopping",
  cleared: true,
  subtransactions: [
    {
      amount: -7500,  // -$75.00
      category: "groceries-uuid",
      notes: "Food items"
    },
    {
      amount: -3000,  // -$30.00
      category: "household-uuid",
      notes: "Cleaning supplies"
    },
    {
      amount: -2000,  // -$20.00
      category: "clothing-uuid",
      notes: "Socks"
    }
  ]
});
\`\`\`

## Example 4: Transfer Between Accounts
\`\`\`javascript
// From checking to savings
await actual_transactions_create({
  account: "checking-account-uuid",
  date: "2025-12-12",
  amount: -50000,  // -$500.00 leaving checking
  payee: "savings-account-uuid",  // Target account becomes payee
  notes: "Monthly savings transfer"
});

// Actual automatically creates matching transaction in savings account
// with amount: 50000 (positive, entering savings)
\`\`\`

## Example 5: Bulk Import
\`\`\`javascript
await actual_transactions_import({
  account: "checking-account-uuid",
  transactions: [
    {
      date: "2025-12-01",
      amount: -4500,
      payee: "Netflix",
      imported_id: "BANK-001",
      cleared: true
    },
    {
      date: "2025-12-03",
      amount: -12000,
      payee: "Whole Foods",
      imported_id: "BANK-002",
      cleared: true
    },
    {
      date: "2025-12-05",
      amount: 50000,
      payee: "Freelance Client",
      imported_id: "BANK-003",
      cleared: true
    }
  ]
});
\`\`\`

## Example 6: Update Transaction Category
\`\`\`javascript
// Get uncategorized transactions
const uncat = await actual_transactions_filter({
  category: null,
  startDate: "2025-12-01"
});

// Categorize first one
await actual_transactions_update({
  id: uncat[0].id,
  category: "groceries-uuid"
});
\`\`\`

## Example 7: Mark Cleared & Reconciled
\`\`\`javascript
// Mark as cleared (shows in current balance)
await actual_transactions_update({
  id: "transaction-uuid",
  cleared: true
});

// Later, after reconciling statement
await actual_transactions_update({
  id: "transaction-uuid",
  reconciled: true
});
\`\`\`

## Example 8: Search Recent Large Expenses
\`\`\`javascript
const largeTxns = await actual_query_run({
  query: \`
    SELECT date, amount, payee.name, category.name, notes
    FROM transactions
    WHERE amount < -50000
      AND date >= '2025-01-01'
    ORDER BY amount ASC
  \`
});

largeTxns.forEach(t => {
  console.log(\`\${t.date}: \${t['payee.name']} -$\${Math.abs(t.amount) / 100}\`);
});
\`\`\`

## Example 9: Monthly Spending by Category
\`\`\`javascript
const spending = await actual_transactions_summary_by_category({
  startDate: "2025-12-01",
  endDate: "2025-12-31"
});

spending.forEach(cat => {
  if (cat.total < 0) {  // Expenses only
    console.log(\`\${cat.categoryName}: -$\${Math.abs(cat.total) / 100}\`);
  }
});
\`\`\`

## Example 10: Find Recurring Subscriptions
\`\`\`javascript
// Tag subscriptions with #subscription in notes
const subscriptions = await actual_query_run({
  query: \`
    SELECT payee.name, amount, date, notes
    FROM transactions
    WHERE notes LIKE '%#subscription%'
    ORDER BY payee.name, date DESC
  \`
});

// Group by payee to see frequency
\`\`\`
`;

const tool: ToolDefinition = {
  name: 'actual_transactions_help',
  description:
    'Get comprehensive help and examples for transaction management in Actual Budget. Covers creating, updating, searching, importing, split transactions, amounts, reconciliation, and more. Use this tool BEFORE working with transactions to understand proper usage and avoid common mistakes. Topics: overview, fields, splits, import, search, amounts, reconciliation, examples, all.',
  inputSchema: InputSchema,
  call: async (args: unknown) => {
    const input = InputSchema.parse(args);
    const topic = input.topic || 'all';
    const keyword = input.keyword?.toLowerCase();

    let content = '';

    // Build content based on topic
    if (topic === 'all' || topic === 'overview') {
      content += TRANSACTIONS_OVERVIEW;
    }
    if (topic === 'all' || topic === 'fields') {
      content += '\n\n' + TRANSACTION_FIELDS;
    }
    if (topic === 'all' || topic === 'splits') {
      content += '\n\n' + SPLIT_TRANSACTIONS;
    }
    if (topic === 'all' || topic === 'import') {
      content += '\n\n' + IMPORT_GUIDE;
    }
    if (topic === 'all' || topic === 'search') {
      content += '\n\n' + SEARCH_GUIDE;
    }
    if (topic === 'all' || topic === 'amounts') {
      content += '\n\n' + AMOUNTS_GUIDE;
    }
    if (topic === 'all' || topic === 'reconciliation') {
      content += '\n\n' + RECONCILIATION_GUIDE;
    }
    if (topic === 'all' || topic === 'examples') {
      content += '\n\n' + EXAMPLES;
    }

    // Filter by keyword if provided
    if (keyword) {
      const lines = content.split('\n');
      const filteredLines = lines.filter((line) => line.toLowerCase().includes(keyword));

      if (filteredLines.length === 0) {
        return {
          success: false,
          message: `No content found matching keyword: "${keyword}"`,
          suggestion:
            'Try keywords like: split, import, cleared, reconciled, amount, search, filter',
        };
      }

      content = filteredLines.join('\n');
    }

    return {
      success: true,
      topic,
      keyword: keyword || 'none',
      content: content.trim(),
      related_tools: [
        'actual_transactions_create',
        'actual_transactions_update',
        'actual_transactions_filter',
        'actual_transactions_import',
        'actual_query_run (see actual_query_help)',
      ],
      usage_note:
        'Use this help BEFORE calling transaction tools to understand proper usage, field requirements, and avoid common mistakes.',
    };
  },
};

export default tool;
