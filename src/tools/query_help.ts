import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';

const InputSchema = z.object({
  topic: z
    .enum([
      'overview',
      'syntax',
      'operators',
      'joins',
      'sorting',
      'aggregates',
      'splits',
      'functions',
      'examples',
      'all',
    ])
    .optional()
    .describe(
      'Topic to get help on: overview, syntax, operators, joins, sorting, aggregates, splits, functions, examples, all'
    ),
  keyword: z
    .string()
    .optional()
    .describe('Search for specific keyword in help content (e.g., "filter", "groupBy", "sum")'),
});

// Comprehensive ActualQL documentation
const ACTUALQL_OVERVIEW = `
# ActualQL Overview

ActualQL is Actual Budget's query language for flexible data retrieval. It provides:
- Filtering, sorting, grouping, and aggregation
- Table joins via dot notation (e.g., category.name)
- Split transaction handling
- Date/time transformations
- Aggregate functions (sum, count, avg, etc.)

**Basic Query Structure:**
\`\`\`javascript
q('transactions')
  .filter({ 'category.name': 'Food', date: { $gte: '2021-01-01' } })
  .select(['id', 'date', 'amount'])
  .orderBy('date')
\`\`\`

**Available Tables:**
- transactions: Financial transactions (primary table)
- accounts: Bank accounts and wallets
- categories: Expense/income categories
- category_groups: Category group containers
- payees: Transaction payees/vendors
- rules: Automation rules
`;

const QUERY_SYNTAX = `
# Query Syntax

## Basic Structure
\`\`\`javascript
q('table_name')
  .filter({ field: value })      // WHERE clause
  .select(['field1', 'field2'])  // SELECT clause
  .orderBy('field')              // ORDER BY clause
  .groupBy('field')              // GROUP BY clause
  .options({ splits: 'inline' }) // Query options
\`\`\`

## Filter Conditions
**Simple equality:**
\`\`\`javascript
{ 'category.name': 'Food' }  // category name equals "Food"
\`\`\`

**Multiple conditions (AND):**
\`\`\`javascript
{
  'category.name': 'Food',
  date: { $gte: '2021-01-01' }
}
\`\`\`

**Array of conditions (AND):**
\`\`\`javascript
{ date: [{ $gte: '2021-01-01' }, { $lte: '2021-12-31' }] }
\`\`\`

**Explicit AND/OR:**
\`\`\`javascript
{
  $and: [
    { date: { $gte: '2021-01-01' } },
    { date: { $lte: '2021-12-31' } }
  ]
}

{
  $or: [
    { 'category.name': 'Food' },
    { 'category.name': 'Dining' }
  ]
}
\`\`\`

## Select Options
**All fields:**
\`\`\`javascript
.select('*')
\`\`\`

**Specific fields:**
\`\`\`javascript
.select(['id', 'date', 'amount'])
\`\`\`

**With aggregates:**
\`\`\`javascript
.select(['payee.name', { total: { $sum: '$amount' } }])
\`\`\`

**Aggregate shortcut:**
\`\`\`javascript
.calculate({ $sum: '$amount' })  // Returns single value, not array
\`\`\`
`;

const OPERATORS_REFERENCE = `
# Operators

## Comparison Operators
- **\`$eq\`**: Equals (default if no operator specified)
  \`\`\`javascript
  { amount: { $eq: -5000 } }  // amount equals -50.00
  \`\`\`

- **\`$ne\`**: Not equals
  \`\`\`javascript
  { 'category.name': { $ne: 'Food' } }
  \`\`\`

- **\`$lt\`**: Less than
  \`\`\`javascript
  { amount: { $lt: 0 } }  // negative amounts (expenses)
  \`\`\`

- **\`$lte\`**: Less than or equal
  \`\`\`javascript
  { date: { $lte: '2021-12-31' } }
  \`\`\`

- **\`$gt\`**: Greater than
  \`\`\`javascript
  { amount: { $gt: 0 } }  // positive amounts (income)
  \`\`\`

- **\`$gte\`**: Greater than or equal
  \`\`\`javascript
  { date: { $gte: '2021-01-01' } }
  \`\`\`

## Set Operators
- **\`$oneof\`**: Value is in array (like SQL IN)
  \`\`\`javascript
  { 'category.name': { $oneof: ['Food', 'Dining', 'Groceries'] } }
  \`\`\`

## Text Operators
- **\`$like\`**: Pattern matching (SQL LIKE, % wildcard)
  \`\`\`javascript
  { notes: { $like: '%#interest%' } }
  \`\`\`

- **\`$notlike\`**: Negated pattern matching
  \`\`\`javascript
  { 'payee.name': { $notlike: '%Amazon%' } }
  \`\`\`

- **\`$regex\`**: Regular expression matching
  \`\`\`javascript
  { notes: { $regex: '^Recurring:' } }
  \`\`\`

## Logical Operators
- **\`$and\`**: All conditions must match
  \`\`\`javascript
  {
    $and: [
      { amount: { $lt: 0 } },
      { 'category.is_income': false }
    ]
  }
  \`\`\`

- **\`$or\`**: Any condition must match
  \`\`\`javascript
  {
    $or: [
      { 'payee.name': 'Starbucks' },
      { 'payee.name': 'Peet\\'s Coffee' }
    ]
  }
  \`\`\`
`;

const JOINS_REFERENCE = `
# Joining Tables (Dot Notation)

ActualQL uses dot notation to join related tables automatically.

## Transaction Field References
**Direct fields:**
- \`id\`: Transaction UUID
- \`date\`: Transaction date (YYYY-MM-DD)
- \`amount\`: Amount in cents (negative=expense, positive=income)
- \`notes\`: Transaction notes/memo
- \`cleared\`: Boolean, whether transaction is cleared
- \`reconciled\`: Boolean, whether transaction is reconciled

**Joined fields (via dot notation):**
- \`payee\`: ID reference to payees table
  - \`payee.name\`: Payee name
  - \`payee.transfer_acct\`: Transfer account ID (if transfer)

- \`category\`: ID reference to categories table
  - \`category.name\`: Category name
  - \`category.is_income\`: Boolean, income category
  - \`category.sort_order\`: Sort order within group
  - \`category.group.name\`: Category group name (nested join!)
  - \`category.group.sort_order\`: Group sort order

- \`account\`: ID reference to accounts table
  - \`account.name\`: Account name
  - \`account.type\`: Account type (checking, savings, etc.)
  - \`account.closed\`: Boolean, whether account is closed
  - \`account.offbudget\`: Boolean, off-budget account

- \`imported_payee\`: Original imported payee name (before mapping)

## Example: Multi-level Join
\`\`\`javascript
q('transactions')
  .filter({
    'category.group.name': 'Essential',  // Join through category to group
    'account.offbudget': false           // Join to account
  })
  .select(['date', 'payee.name', 'category.name', 'amount'])
  .orderBy(['category.group.sort_order', 'category.sort_order'])
\`\`\`
`;

const SORTING_REFERENCE = `
# Sorting Results

## Basic Sorting
**Single field (ascending by default):**
\`\`\`javascript
.orderBy('date')
\`\`\`

**Descending order:**
\`\`\`javascript
.orderBy({ date: 'desc' })
\`\`\`

**Multiple fields:**
\`\`\`javascript
.orderBy(['date', 'amount'])
\`\`\`

**Mixed order:**
\`\`\`javascript
.orderBy([{ date: 'desc' }, { amount: 'asc' }])
\`\`\`

## Sorting with Joins
**Sort by joined field:**
\`\`\`javascript
.orderBy('category.name')
\`\`\`

**Multi-level sort:**
\`\`\`javascript
.orderBy([
  'category.group.sort_order',
  'category.sort_order',
  { date: 'desc' }
])
\`\`\`

## Important: Ordering Computed Aliases
⚠️ **You CANNOT order by computed aliases directly in ActualQL:**

**❌ WRONG:**
\`\`\`javascript
q('transactions')
  .groupBy('payee.name')
  .select(['payee.name', { total: { $sum: '$amount' } }])
  .orderBy({ total: 'desc' })  // ERROR: Field 'total' does not exist
\`\`\`

**✅ CORRECT - Sort in JavaScript:**
\`\`\`javascript
const result = await runQuery(
  q('transactions')
    .groupBy('payee.name')
    .select(['payee.name', { total: { $sum: '$amount' } }])
);
const sorted = result.data.sort((a, b) => b.total - a.total);
\`\`\`
`;

const AGGREGATES_REFERENCE = `
# Aggregate Functions

## Available Aggregates
- **\`$sum\`**: Sum of values
- **\`$count\`**: Count of rows
- **\`$avg\`**: Average of values
- **\`$min\`**: Minimum value
- **\`$max\`**: Maximum value

## Using Aggregates in Select
**Named aggregate:**
\`\`\`javascript
q('transactions')
  .filter({ date: { $gte: '2021-01-01' } })
  .select({ total: { $sum: '$amount' } })
// Result: { data: [{ total: 123456 }] }
\`\`\`

**Multiple aggregates:**
\`\`\`javascript
.select({
  total: { $sum: '$amount' },
  count: { $count: '*' },
  avg: { $avg: '$amount' }
})
\`\`\`

## Using Calculate (Shortcut)
**Single aggregate value:**
\`\`\`javascript
q('transactions')
  .filter({ 'category.name': 'Food' })
  .calculate({ $sum: '$amount' })
// Result: { data: 123456 }  (direct value, not array!)
\`\`\`

## Grouping with Aggregates
**Group by single field:**
\`\`\`javascript
q('transactions')
  .groupBy('payee.name')
  .select(['payee.name', { total: { $sum: '$amount' } }])
\`\`\`

**Group by multiple fields:**
\`\`\`javascript
q('transactions')
  .groupBy(['category.name', 'account.name'])
  .select([
    'category.name',
    'account.name',
    { total: { $sum: '$amount' } },
    { count: { $count: '*' } }
  ])
\`\`\`

## Field References in Aggregates
**Use \`$\` prefix for field names:**
\`\`\`javascript
{ $sum: '$amount' }      // Sum the amount field
{ $count: '*' }          // Count all rows
{ $avg: '$amount' }      // Average amount
{ $max: '$amount' }      // Maximum amount
\`\`\`
`;

const SPLITS_REFERENCE = `
# Split Transaction Handling

Split transactions complicate queries. ActualQL provides options to control behavior.

## Split Options

### 1. \`inline\` (Default)
Returns only subtransactions, excluding parent transactions.

**Behavior:**
- Parent transaction: NOT included
- Subtransactions: Included individually
- Result: Flat array

**Use case:** Summing amounts correctly (avoids double-counting parent)

\`\`\`javascript
q('transactions')
  .select('*')
  .options({ splits: 'inline' })  // Default
\`\`\`

### 2. \`grouped\`
Returns full split transactions with subtransactions nested.

**Behavior:**
- Parent transaction: Included
- Subtransactions: Nested in \`subtransactions\` array
- Result: Grouped structure

**Use case:** Displaying complete split transaction structure

\`\`\`javascript
q('transactions')
  .select('*')
  .options({ splits: 'grouped' })

// Result structure:
// [
//   {
//     id: 'parent-uuid',
//     amount: -5000,
//     subtransactions: [
//       { id: 'sub-1', amount: -3000, category: 'Food' },
//       { id: 'sub-2', amount: -2000, category: 'Gas' }
//     ]
//   }
// ]
\`\`\`

### 3. \`all\` (Advanced)
Returns both parent and subtransactions in flat array.

**Behavior:**
- Parent transaction: Included
- Subtransactions: Included separately
- Result: Flat array with duplicates

**Use case:** Advanced processing where you need both

\`\`\`javascript
q('transactions')
  .select('*')
  .options({ splits: 'all' })
\`\`\`

## Best Practices
- **For summing amounts:** Use \`inline\` (default) to avoid double-counting
- **For displaying transactions:** Use \`grouped\` to show split structure
- **For analysis:** Use \`inline\` unless you specifically need parent data
`;

const FUNCTIONS_REFERENCE = `
# Transform Functions

ActualQL supports date/time transformations using \`$transform\`.

## Date Transformations

### Extract Month
\`\`\`javascript
q('transactions')
  .filter({
    date: {
      $transform: '$month',
      $eq: '2021-01'
    }
  })
  .select('*')
// Returns all transactions in January 2021
\`\`\`

### Extract Year
\`\`\`javascript
q('transactions')
  .filter({
    date: {
      $transform: '$year',
      $eq: '2021'
    }
  })
  .select('*')
// Returns all transactions in 2021
\`\`\`

## How $transform Works
The \`$transform\` applies a function to a field before comparing:

**Without transform:**
\`\`\`javascript
{ date: '2021-01-15' }  // Exact date match
\`\`\`

**With transform:**
\`\`\`javascript
{ date: { $transform: '$month', $eq: '2021-01' } }
// Applies $month() to date field first
// Then compares: $month('2021-01-15') === '2021-01' ✓
\`\`\`

## Available Transform Functions
- **\`$month\`**: Extract YYYY-MM from date
  - Input: '2021-01-15' → Output: '2021-01'
- **\`$year\`**: Extract YYYY from date
  - Input: '2021-01-15' → Output: '2021'

## Combining with Other Operators
\`\`\`javascript
q('transactions')
  .filter({
    date: {
      $transform: '$year',
      $gte: '2020',
      $lte: '2022'
    }
  })
  .select('*')
// Returns transactions from 2020-2022 (any month/day)
\`\`\`
`;

const EXAMPLES = `
# ActualQL Examples

## Example 1: Search by Month
\`\`\`javascript
q('transactions')
  .filter({
    date: {
      $transform: '$month',
      $eq: '2021-01'
    }
  })
  .select('*')
// All transactions in January 2021
\`\`\`

## Example 2: Total Amount per Payee (Date Range)
\`\`\`javascript
q('transactions')
  .filter({
    $and: [
      { date: { $gte: '2020-04-06' } },
      { date: { $lte: '2021-04-05' } }
    ]
  })
  .groupBy('payee.name')
  .orderBy('payee.name')
  .select(['payee.name', { amount: { $sum: '$amount' } }])

// Result processing:
const result = await runQuery(...);
result.data.map(row => {
  console.log(\`\${row['payee.name']}: \${row.amount / 100}\`);
});
\`\`\`

## Example 3: Total with Note Filter
\`\`\`javascript
// Using calculate() for single value
const total = (await runQuery(
  q('transactions')
    .filter({
      $and: [
        { date: { $gte: '2020-04-06' } },
        { date: { $lte: '2021-04-05' } },
        { notes: { $like: '%#interest (P)%' } }
      ]
    })
    .calculate({ $sum: '$amount' })
)).data / 100;

// Using select() alternative
const result = await runQuery(
  q('transactions')
    .filter({ /* same filters */ })
    .select({ total: { $sum: '$amount' } })
);
const total = result.data[0].total / 100;
\`\`\`

## Example 4: Total per Category (Sorted by Group)
\`\`\`javascript
q('transactions')
  .filter({
    $and: [
      { date: { $gte: '2020-04-06' } },
      { date: { $lte: '2021-04-05' } }
    ]
  })
  .groupBy('category.name')
  .orderBy([
    'category.group.sort_order',
    'category.sort_order'
  ])
  .select([
    'category.group.name',
    'category.name',
    { amount: { $sum: '$amount' } }
  ])

// Result processing:
result.data.map(row => {
  console.log(
    \`\${row['category.group.name']}/\${row['category.name']}: \${row.amount / 100}\`
  );
});
\`\`\`

## Example 5: Income Transactions with Specific Payees
\`\`\`javascript
q('transactions')
  .filter({
    $and: [
      { amount: { $gt: 0 } },  // Positive = income
      {
        $or: [
          { 'payee.name': 'Salary Deposit' },
          { 'payee.name': 'Freelance Income' }
        ]
      }
    ]
  })
  .select(['date', 'payee.name', 'amount', 'notes'])
  .orderBy({ date: 'desc' })
\`\`\`

## Example 6: Large Transactions (Expense or Income)
\`\`\`javascript
q('transactions')
  .filter({
    $or: [
      { amount: { $lt: -50000 } },  // Expenses over $500
      { amount: { $gt: 50000 } }    // Income over $500
    ]
  })
  .select(['date', 'payee.name', 'category.name', 'amount', 'notes'])
  .orderBy({ date: 'desc' })
\`\`\`

## Example 7: Uncategorized Transactions
\`\`\`javascript
q('transactions')
  .filter({
    $or: [
      { category: null },
      { category: '' }
    ]
  })
  .select(['date', 'payee.name', 'amount', 'account.name'])
  .orderBy({ date: 'desc' })
\`\`\`

## Example 8: Account Activity Summary
\`\`\`javascript
q('transactions')
  .filter({ date: { $gte: '2021-01-01' } })
  .groupBy('account.name')
  .select([
    'account.name',
    { count: { $count: '*' } },
    { total_in: { $sum: { $gte: 0, field: '$amount' } } },
    { total_out: { $sum: { $lt: 0, field: '$amount' } } },
    { avg_amount: { $avg: '$amount' } }
  ])
  .orderBy({ count: 'desc' })
\`\`\`
`;

const SCENARIOS = `
# Common Query Scenarios

## Scenario 1: Find All Transactions for Multiple Categories
**Goal:** Get transactions from Food, Dining, and Groceries categories

**Solution:**
\`\`\`javascript
q('transactions')
  .filter({
    'category.name': {
      $oneof: ['Food', 'Dining', 'Groceries']
    }
  })
  .select('*')
\`\`\`

## Scenario 2: Monthly Spending Report
**Goal:** Get total spending per category for a specific month

**Solution:**
\`\`\`javascript
q('transactions')
  .filter({
    $and: [
      { date: { $transform: '$month', $eq: '2021-01' } },
      { amount: { $lt: 0 } }  // Only expenses
    ]
  })
  .groupBy('category.name')
  .select([
    'category.name',
    { total: { $sum: '$amount' } },
    { count: { $count: '*' } }
  ])

// Post-process: Sort by total in JavaScript
const result = await runQuery(...);
const sorted = result.data.sort((a, b) => a.total - b.total);
\`\`\`

## Scenario 3: Find Duplicate Transactions
**Goal:** Find potential duplicate transactions (same date, amount, account)

**Solution (requires two queries):**
\`\`\`javascript
// 1. Get all transactions
const all = await runQuery(
  q('transactions')
    .filter({ date: { $gte: '2021-01-01' } })
    .select(['date', 'amount', 'account', 'payee.name', 'notes'])
);

// 2. Find duplicates in JavaScript
const seen = new Map();
const duplicates = [];
all.data.forEach(txn => {
  const key = \`\${txn.date}-\${txn.amount}-\${txn.account}\`;
  if (seen.has(key)) {
    duplicates.push({ original: seen.get(key), duplicate: txn });
  } else {
    seen.set(key, txn);
  }
});
\`\`\`

## Scenario 4: Year-over-Year Comparison
**Goal:** Compare spending by category for two years

**Solution:**
\`\`\`javascript
// Year 1
const year1 = await runQuery(
  q('transactions')
    .filter({
      $and: [
        { date: { $transform: '$year', $eq: '2020' } },
        { amount: { $lt: 0 } }
      ]
    })
    .groupBy('category.name')
    .select(['category.name', { total: { $sum: '$amount' } }])
);

// Year 2
const year2 = await runQuery(
  q('transactions')
    .filter({
      $and: [
        { date: { $transform: '$year', $eq: '2021' } },
        { amount: { $lt: 0 } }
      ]
    })
    .groupBy('category.name')
    .select(['category.name', { total: { $sum: '$amount' } }])
);

// Merge and compare in JavaScript
\`\`\`

## Scenario 5: Running Balance (Not Supported)
**Goal:** Calculate running balance for account

**Limitation:** ActualQL doesn't support window functions or running totals.

**Workaround:** Calculate in JavaScript after fetching transactions:
\`\`\`javascript
const result = await runQuery(
  q('transactions')
    .filter({ account: accountId })
    .select(['date', 'amount'])
    .orderBy('date')
);

let balance = startingBalance;
const withBalances = result.data.map(txn => {
  balance += txn.amount;
  return { ...txn, balance };
});
\`\`\`

## Scenario 6: Complex Date Ranges
**Goal:** Get transactions from specific months (Jan, Mar, May)

**Solution:**
\`\`\`javascript
q('transactions')
  .filter({
    date: {
      $transform: '$month',
      $oneof: ['2021-01', '2021-03', '2021-05']
    }
  })
  .select('*')
\`\`\`

## Scenario 7: Exclude Specific Payees
**Goal:** Get all transactions except transfers and specific payees

**Solution:**
\`\`\`javascript
q('transactions')
  .filter({
    $and: [
      { 'payee.transfer_acct': null },  // Exclude transfers
      {
        'payee.name': {
          $notlike: '%Amazon%'
        }
      },
      {
        'payee.name': {
          $ne: 'Starting Balance'
        }
      }
    ]
  })
  .select('*')
\`\`\`
`;

const TIPS = `
# ActualQL Tips & Best Practices

## 1. Always Filter by Date Range
Query performance improves significantly with date filters:
\`\`\`javascript
// ✅ Good
.filter({
  date: { $gte: '2021-01-01', $lte: '2021-12-31' }
})

// ❌ Avoid (scans entire database)
.filter({ 'category.name': 'Food' })
\`\`\`

## 2. Use Specific Fields in Select
Don't always use \`select('*')\`:
\`\`\`javascript
// ✅ Good - only needed fields
.select(['id', 'date', 'amount', 'payee.name'])

// ❌ Slower - fetches all fields
.select('*')
\`\`\`

## 3. Amounts are in Cents
Always divide by 100 for display:
\`\`\`javascript
const total = result.data[0].total / 100;  // Cents to dollars
\`\`\`

## 4. Handle Null Categories
Transactions can have null/empty categories:
\`\`\`javascript
.filter({
  $or: [
    { category: null },
    { category: '' }
  ]
})
\`\`\`

## 5. Sort Aggregates in JavaScript
Can't sort by computed aliases in ActualQL:
\`\`\`javascript
// ❌ Won't work
.select([{ total: { $sum: '$amount' } }])
.orderBy('total')

// ✅ Sort after query
const result = await runQuery(...);
const sorted = result.data.sort((a, b) => b.total - a.total);
\`\`\`

## 6. Use \`calculate()\` for Single Aggregates
More convenient than \`select()\`:
\`\`\`javascript
// ✅ Direct value
const total = (await runQuery(
  q('transactions').calculate({ $sum: '$amount' })
)).data;

// ❌ Extra indexing
const total = (await runQuery(
  q('transactions').select({ total: { $sum: '$amount' } })
)).data[0].total;
\`\`\`

## 7. Test Queries Incrementally
Build queries step by step:
\`\`\`javascript
// 1. Test basic filter
q('transactions').filter({ date: { $gte: '2021-01-01' } }).select('*')

// 2. Add grouping
q('transactions')...filter(...)...groupBy('category.name')...select(['category.name'])

// 3. Add aggregates
q('transactions')...groupBy(...)...select(['category.name', { total: { $sum: '$amount' } }])
\`\`\`

## 8. Use Dot Notation for Joins
More readable than complex joins:
\`\`\`javascript
// ✅ Clear and simple
'category.group.name'

// ❌ Not supported (SQL-style joins)
// (ActualQL handles joins automatically)
\`\`\`

## 9. Remember Split Transaction Defaults
Default \`splits: 'inline'\` is usually correct:
\`\`\`javascript
// ✅ Default (inline) - correct for sums
q('transactions').calculate({ $sum: '$amount' })

// ⚠️ Only use if you need parent transactions
q('transactions').options({ splits: 'grouped' })
\`\`\`

## 10. Use \`$transform\` for Date Filtering
More efficient than string operations:
\`\`\`javascript
// ✅ Good - uses $transform
{ date: { $transform: '$month', $eq: '2021-01' } }

// ❌ Slower - string matching
{ date: { $like: '2021-01-%' } }
\`\`\`

## 11. Field References in Aggregates Need \`$\` Prefix
\`\`\`javascript
// ✅ Correct
{ $sum: '$amount' }

// ❌ Wrong
{ $sum: 'amount' }
\`\`\`

## 12. Complex Conditions? Use \`$and\`/\`$or\` Explicitly
Makes intent clearer:
\`\`\`javascript
// ✅ Explicit and clear
{
  $and: [
    { amount: { $lt: 0 } },
    { 'category.is_income': false }
  ]
}
\`\`\`
`;

const tool: ToolDefinition = {
  name: 'actual_query_help',
  description:
    'Get comprehensive help and examples for ActualQL query language. ActualQL is used with actual_query_run tool to perform custom database queries. Use this tool BEFORE creating complex queries to understand syntax, operators, joins, aggregates, and see real-world examples. Topics: overview, syntax, operators, joins, sorting, aggregates, splits, functions, examples, all.',
  inputSchema: InputSchema,
  call: async (args: unknown) => {
    const input = InputSchema.parse(args);
    const topic = input.topic || 'all';
    const keyword = input.keyword?.toLowerCase();

    let content = '';

    // Build content based on topic
    if (topic === 'all' || topic === 'overview') {
      content += ACTUALQL_OVERVIEW;
    }
    if (topic === 'all' || topic === 'syntax') {
      content += '\n\n' + QUERY_SYNTAX;
    }
    if (topic === 'all' || topic === 'operators') {
      content += '\n\n' + OPERATORS_REFERENCE;
    }
    if (topic === 'all' || topic === 'joins') {
      content += '\n\n' + JOINS_REFERENCE;
    }
    if (topic === 'all' || topic === 'sorting') {
      content += '\n\n' + SORTING_REFERENCE;
    }
    if (topic === 'all' || topic === 'aggregates') {
      content += '\n\n' + AGGREGATES_REFERENCE;
    }
    if (topic === 'all' || topic === 'splits') {
      content += '\n\n' + SPLITS_REFERENCE;
    }
    if (topic === 'all' || topic === 'functions') {
      content += '\n\n' + FUNCTIONS_REFERENCE;
    }
    if (topic === 'all' || topic === 'examples') {
      content += '\n\n' + EXAMPLES;
    }

    // Always include scenarios and tips for comprehensive help
    if (topic === 'all') {
      content += '\n\n' + SCENARIOS;
      content += '\n\n' + TIPS;
    }

    // Filter by keyword if provided
    if (keyword) {
      const lines = content.split('\n');
      const filteredLines = lines.filter((line) => line.toLowerCase().includes(keyword));

      if (filteredLines.length === 0) {
        return {
          success: false,
          message: `No content found matching keyword: "${keyword}"`,
          suggestion: 'Try keywords like: filter, select, groupBy, sum, join, operator, example',
        };
      }

      content = filteredLines.join('\n');
    }

    return {
      success: true,
      topic,
      keyword: keyword || 'none',
      content: content.trim(),
      links: {
        overview: 'https://actualbudget.org/docs/api/actual-ql/',
        functions: 'https://actualbudget.org/docs/api/actual-ql/functions',
        examples: 'https://actualbudget.org/docs/api/actual-ql/examples',
      },
      usage_note:
        'Use this help BEFORE calling actual_query_run to understand ActualQL syntax and see examples.',
    };
  },
};

export default tool;
