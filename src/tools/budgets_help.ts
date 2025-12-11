import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';

const InputSchema = z.object({
  topic: z
    .enum([
      'overview',
      'concepts',
      'carryover',
      'holds',
      'transfers',
      'batch',
      'strategies',
      'examples',
      'all',
    ])
    .optional()
    .describe(
      'Topic to get help on: overview, concepts, carryover, holds, transfers, batch, strategies, examples, all'
    ),
  keyword: z
    .string()
    .optional()
    .describe('Search for specific keyword in help content (e.g., "carryover", "envelope", "zero")'),
});

const BUDGETS_OVERVIEW = `
# Budget Management Overview

Actual Budget uses a flexible budgeting system that supports multiple budgeting styles.

## Core Concepts

**Budget**: Amount allocated to a category for a month
**Spent**: Actual transaction amounts in the category
**Balance**: Budget - Spent (what's left)
**Carryover**: Automatically move unused budget to next month
**Hold**: Reserve funds from budget for future months

## Budgeting Philosophy

Actual Budget follows **envelope budgeting** principles:
- Every dollar has a job (assigned to a category)
- Budget with money you have now (not future income)
- Adjust as you go (flexible, not rigid)
- Roll with the punches (overspending in one category? Move from another)

## Budget Tools Available

**View Budgets:**
- \`actual_budgets_get_all\` - All budgets across all months
- \`actual_budgets_getMonth\` - Single month budget
- \`actual_budgets_getMonths\` - Multiple consecutive months

**Modify Budgets:**
- \`actual_budgets_setAmount\` - Set budget amount for category/month
- \`actual_budgets_setCarryover\` - Enable/disable carryover
- \`actual_budgets_holdForNextMonth\` - Hold funds for future
- \`actual_budgets_resetHold\` - Cancel hold
- \`actual_budgets_transfer\` - Move budget between categories

**Bulk Operations:**
- \`actual_budgets_updates_batch\` - Update multiple budgets at once

## Budget Structure

Each budget entry contains:
- **month**: YYYY-MM (e.g., "2025-12")
- **category**: Category UUID
- **budgeted**: Amount budgeted (cents)
- **spent**: Amount spent (cents, usually negative)
- **balance**: Remaining budget (cents)
- **carryover**: Boolean, whether unused carries over
- **goal**: Optional goal configuration

## Budget Workflow

1. **Create categories** (if not exists)
2. **Set monthly budgets** for each category
3. **Track spending** (transactions automatically reduce balance)
4. **Adjust as needed** (transfer between categories, change amounts)
5. **Review monthly** (check balances, adjust next month)
6. **Enable carryover** for categories that accumulate (savings goals)
`;

const BUDGET_CONCEPTS = `
# Budget Concepts Explained

## 1. Budgeted Amount

**Definition:** Money you allocate to a category for the month

**Setting budget:**
\`\`\`javascript
await actual_budgets_setAmount({
  month: "2025-12",
  category: "groceries-uuid",
  amount: 50000  // $500.00
});
\`\`\`

**Key points:**
- Amount in cents (50000 = $500.00)
- Positive amount (budget allocation)
- Per category, per month
- Can change anytime during month

## 2. Spent Amount

**Definition:** Actual transaction totals in the category

**Automatic calculation:**
- Sum of all transaction amounts in category for the month
- Usually negative (expenses)
- Updates automatically when transactions created/modified
- Read-only (modify by creating/updating transactions)

**Example:**
\`\`\`
Budgeted: $500.00 (50000 cents)
Spent: -$350.00 (-35000 cents)
Balance: $150.00 (15000 cents)
\`\`\`

## 3. Balance

**Definition:** Budgeted + Spent (what remains)

**Formula:**
\`\`\`
Balance = Budgeted Amount + Spent Amount
\`\`\`

**Examples:**
\`\`\`
Budgeted: 50000, Spent: -35000 → Balance: 15000 ($150 left)
Budgeted: 50000, Spent: -60000 → Balance: -10000 (overspent by $100)
Budgeted: 0, Spent: -35000 → Balance: -35000 (no budget, spent $350)
\`\`\`

**Balance states:**
- **Positive**: Under budget, money remaining
- **Zero**: Exactly on budget
- **Negative**: Over budget (need to cover from other categories)

## 4. Category Groups

**Definition:** Container for related categories

**Structure:**
\`\`\`
Monthly Bills (group)
  ├─ Rent
  ├─ Electric
  ├─ Internet
  └─ Phone

Daily Expenses (group)
  ├─ Groceries
  ├─ Gas
  └─ Dining Out
\`\`\`

**Budgeting per group:**
- Budget set at category level (not group level)
- Groups organize display only
- Group totals automatically calculated

## 5. Income Categories

**Special category type:**
- Used for income transactions
- Usually marked with \`is_income: true\`
- Positive amounts in transactions
- Not "budgeted" in traditional sense

**Income budgeting:**
\`\`\`javascript
// Income categories typically don't have budget amounts
// They show total income received in the month
\`\`\`

## 6. Off-Budget vs On-Budget

**On-Budget Accounts:**
- Included in budget calculations
- Money here "needs a job" (assigned to categories)
- Checking, savings, cash accounts

**Off-Budget Accounts:**
- Excluded from budget
- Tracking only (investments, loans, mortgages)
- Doesn't affect category balances
`;

const CARRYOVER_GUIDE = `
# Budget Carryover

Carryover automatically moves unused budget to the next month.

## When to Use Carryover

**Use carryover for:**
- Savings goals (vacation, emergency fund, large purchases)
- Irregular expenses (annual insurance, quarterly taxes)
- Buffer categories (building up reserves)
- Anything that accumulates over time

**Don't use carryover for:**
- Regular monthly expenses (rent, utilities)
- Spending that resets each month (groceries, dining out)
- Income categories

## How Carryover Works

### Without Carryover (Default)
\`\`\`
January:
  Budgeted: $500
  Spent: -$350
  Balance: $150

February (without carryover):
  Budgeted: $0  ← starts fresh
  Previous balance: Lost!
\`\`\`

### With Carryover Enabled
\`\`\`
January:
  Budgeted: $500
  Spent: -$350
  Balance: $150

February (with carryover):
  Previous balance: $150  ← carried over!
  Budgeted: $500
  Total available: $650
\`\`\`

## Enabling Carryover

\`\`\`javascript
await actual_budgets_setCarryover({
  month: "2025-12",
  category: "vacation-savings-uuid",
  flag: true  // Enable carryover
});
\`\`\`

**Important:**
- Set once, applies to all future months
- Can disable anytime: \`flag: false\`
- Previous balances preserved when toggled

## Carryover with Overspending

### Negative Carryover (Overspent)
\`\`\`
January:
  Budgeted: $500
  Spent: -$600
  Balance: -$100 (overspent)

February (with carryover):
  Previous balance: -$100  ← debt carried forward
  Budgeted: $500
  Total available: $400  ← need to cover overspending
\`\`\`

**Handling overspending:**
1. Budget extra to cover deficit
2. Transfer from another category
3. Accept reduced available amount

## Carryover vs Budget Transfer

**Carryover:**
- Automatic, month-to-month
- Within same category
- Accumulates over time
- Set once, applies continuously

**Transfer:**
- Manual, one-time
- Between different categories
- Same month only
- Explicit action each time

## Carryover Best Practices

1. **Enable for savings goals**
   \`\`\`javascript
   await actual_budgets_setCarryover({
     category: "vacation-fund-uuid",
     flag: true
   });
   \`\`\`

2. **Track accumulation**
   \`\`\`javascript
   const vacationBudget = await actual_budgets_getMonth({
     month: "2025-12"
   });
   const vacationCat = vacationBudget.find(b => 
     b.category === "vacation-fund-uuid"
   );
   console.log(\`Saved so far: $\${vacationCat.balance / 100}\`);
   \`\`\`

3. **Combine with holds**
   - Enable carryover for accumulation
   - Use holds to reserve specific amounts
   - See Holds section for details

## Checking Carryover Status

\`\`\`javascript
const budget = await actual_budgets_getMonth({
  month: "2025-12"
});

budget.forEach(b => {
  if (b.carryover) {
    console.log(\`\${b.categoryName}: Carryover enabled\`);
  }
});
\`\`\`

## Common Carryover Scenarios

### Scenario 1: Building Emergency Fund
\`\`\`javascript
// Month 1: Budget $500, spend $0
// Balance: $500

// Month 2: Budget $500, spend $0
// Total: $1000 (with carryover)

// Month 3: Budget $500, spend $0
// Total: $1500 (with carryover)

// Continue until goal reached ($10,000)
\`\`\`

### Scenario 2: Annual Insurance
\`\`\`javascript
// Insurance due in December: $1200
// Budget $100/month with carryover

// January: Budget $100, Balance: $100
// February: Budget $100, Balance: $200
// ...
// December: Balance: $1200, pay bill
\`\`\`

### Scenario 3: Irregular Spending
\`\`\`javascript
// Car maintenance (unpredictable)
// Budget $100/month with carryover

// Months 1-5: No spending, balance grows to $500
// Month 6: Spend $400 on repairs, balance: $100
// Continue accumulating for next repair
\`\`\`
`;

const HOLDS_GUIDE = `
# Budget Holds

Holds reserve budget for future months without removing it from current month.

## What is a Hold?

**Hold:** Reserve current budget for use in a future month

**Use cases:**
- Annual expenses (plan ahead without moving money)
- Quarterly bills (mark as "reserved")
- Future large purchases (visual reminder)
- Budget planning (see what's truly available)

## Hold vs Carryover

| Feature | Hold | Carryover |
|---------|------|-----------|
| Purpose | Reserve for future | Accumulate unused |
| Time | One-time action | Continuous |
| Display | Shows as held | Shows in balance |
| Removal | Reset hold | Spend or budget less |

## Setting a Hold

\`\`\`javascript
await actual_budgets_holdForNextMonth({
  month: "2025-12",
  category: "insurance-uuid",
  amount: 100000  // Hold $1000.00 for next month
});
\`\`\`

**What happens:**
- Amount marked as "held" in current month
- Visible in budget display (grayed out or marked)
- Reduces available-to-budget total
- Automatically released next month

## Budget Display with Hold

\`\`\`
December Budget - Insurance Category:
  Budgeted: $1200.00
  Held: $1000.00
  Available: $200.00  ← Only $200 to spend this month
  Spent: $0.00
  Balance: $200.00
\`\`\`

## Resetting a Hold

\`\`\`javascript
await actual_budgets_resetHold({
  month: "2025-12",
  category: "insurance-uuid"
});
// Hold removed, full amount available again
\`\`\`

## Hold Workflow

### Planning Ahead
\`\`\`javascript
// December: Set aside for January bill
await actual_budgets_holdForNextMonth({
  month: "2025-12",
  category: "property-tax-uuid",
  amount: 200000  // $2000 for January
});

// January arrives: Hold automatically released
// Now budget $2000 for property tax payment
\`\`\`

## Common Hold Patterns

### Pattern 1: Annual Expense Planning
\`\`\`javascript
// Spread annual cost across year
// Example: $1200 annual insurance

// Each month, hold $100
for (let month = 1; month <= 11; month++) {
  await actual_budgets_holdForNextMonth({
    month: \`2025-\${String(month).padStart(2, '0')}\`,
    category: "insurance-uuid",
    amount: 10000  // $100 each month
  });
}

// December: Have $1200 accumulated from holds
\`\`\`

### Pattern 2: Large Purchase Prep
\`\`\`javascript
// Saving for new laptop in 3 months
// Hold portion each month

// Month 1: Hold $300
await actual_budgets_holdForNextMonth({
  month: "2025-10",
  category: "technology-uuid",
  amount: 30000
});

// Month 2: Hold another $300
// Month 3: Hold another $300
// Month 4: Have $900 reserved for purchase
\`\`\`

## Holds vs Transfers

**Hold:** Reserve within category for future
\`\`\`javascript
// December: Hold $100 in Groceries for January
await actual_budgets_holdForNextMonth({
  category: "groceries-uuid",
  amount: 10000
});
\`\`\`

**Transfer:** Move between categories now
\`\`\`javascript
// December: Move $100 from Groceries to Dining
await actual_budgets_transfer({
  month: "2025-12",
  fromCategory: "groceries-uuid",
  toCategory: "dining-uuid",
  amount: 10000
});
\`\`\`

## Visual Indicators

Most Actual Budget UIs show holds:
- Held amount in separate column or grayed out
- Available amount excludes held
- Hover/click for hold details

## Hold Best Practices

1. **Use for known future expenses**
   - Annual subscriptions
   - Quarterly taxes
   - Insurance renewals

2. **Don't overuse**
   - Too many holds complicate budget
   - Consider carryover categories instead

3. **Document purpose**
   - Add notes to budget or category
   - Remember why you're holding

4. **Reset if plans change**
   - Don't leave holds indefinitely
   - Release if expense cancelled

## Checking Hold Status

\`\`\`javascript
const budget = await actual_budgets_getMonth({
  month: "2025-12"
});

budget.forEach(b => {
  if (b.held && b.held > 0) {
    console.log(\`\${b.categoryName}: Holding $\${b.held / 100}\`);
  }
});
\`\`\`
`;

const TRANSFERS_GUIDE = `
# Budget Transfers

Transfer budget between categories within the same month.

## When to Transfer

**Transfer budget when:**
- Overspent in one category, have extra in another
- Priorities change mid-month
- Emergency expense requires reallocation
- Underspent in one category, need more in another

**Example scenario:**
\`\`\`
Groceries: Budgeted $500, Spent $450, Balance $50
Dining Out: Budgeted $200, Spent $250, Balance -$50 (overspent)

Solution: Transfer $50 from Groceries to Dining Out
\`\`\`

## Performing a Transfer

\`\`\`javascript
await actual_budgets_transfer({
  month: "2025-12",
  fromCategory: "groceries-uuid",
  toCategory: "dining-uuid",
  amount: 5000  // Transfer $50.00
});
\`\`\`

**Effect:**
\`\`\`
Before:
  Groceries: Budgeted $500, Balance $50
  Dining: Budgeted $200, Balance -$50

After:
  Groceries: Budgeted $450, Balance $0  ← Reduced
  Dining: Budgeted $250, Balance $0     ← Increased
\`\`\`

## Transfer Rules

**Same month only:**
- Cannot transfer between months (use carryover/holds instead)
- Transfer adjusts budgeted amounts for current month

**Amount constraints:**
- Cannot transfer more than available in source category
- Amount in cents (5000 = $50.00)
- Positive value (direction determined by from/to)

**Category requirements:**
- Both categories must exist
- Both must be in same month
- Cannot transfer to/from income categories (usually)

## Transfer vs Other Operations

### Transfer (within month)
\`\`\`javascript
// Move budget between categories in December
await actual_budgets_transfer({
  month: "2025-12",
  fromCategory: "cat-a",
  toCategory: "cat-b",
  amount: 10000
});
\`\`\`

### Carryover (across months)
\`\`\`javascript
// Automatically move unused to next month
await actual_budgets_setCarryover({
  category: "cat-a",
  flag: true
});
\`\`\`

### Budget Adjustment (change allocation)
\`\`\`javascript
// Simply change budgeted amount
await actual_budgets_setAmount({
  month: "2025-12",
  category: "cat-a",
  amount: 60000  // Was 50000, now 60000
});
// This adds $100 from "to budget" pool
\`\`\`

## Common Transfer Scenarios

### Scenario 1: Cover Overspending
\`\`\`javascript
// Overspent Dining by $30, have extra in Entertainment
await actual_budgets_transfer({
  month: "2025-12",
  fromCategory: "entertainment-uuid",
  toCategory: "dining-uuid",
  amount: 3000
});
\`\`\`

### Scenario 2: Mid-Month Priority Shift
\`\`\`javascript
// Vacation cancelled, move to home improvement
await actual_budgets_transfer({
  month: "2025-12",
  fromCategory: "vacation-uuid",
  toCategory: "home-improvement-uuid",
  amount: 50000  // $500
});
\`\`\`

### Scenario 3: Balance Budget
\`\`\`javascript
// Multiple categories need rebalancing
await actual_budgets_transfer({
  fromCategory: "clothing-uuid",
  toCategory: "medical-uuid",
  amount: 10000
});

await actual_budgets_transfer({
  fromCategory: "hobbies-uuid",
  toCategory: "medical-uuid",
  amount: 5000
});
// Medical now has $150 more from two sources
\`\`\`

## Bulk Transfers

For multiple transfers, use batch updates:

\`\`\`javascript
await actual_budgets_updates_batch({
  month: "2025-12",
  updates: [
    {
      category: "groceries-uuid",
      budgeted: 45000  // Reduce from 50000
    },
    {
      category: "dining-uuid",
      budgeted: 25000  // Increase from 20000
    }
  ]
});
// Net effect: Transferred $50 from Groceries to Dining
\`\`\`

## Transfer Best Practices

1. **Document why**
   - Add notes explaining transfer reason
   - Helps with future budget planning

2. **Review at month end**
   - Frequent transfers indicate budget mismatch
   - Adjust next month's budget accordingly

3. **Don't transfer unnecessarily**
   - Small overspending OK if within tolerance
   - Only transfer for significant imbalances

4. **Consider budget adjustments instead**
   - If "to budget" amount available, adjust directly
   - Transfers only needed when reallocating

5. **Use batch for multiple**
   - More efficient than individual transfers
   - Atomic operation (all or nothing)
`;

const BATCH_GUIDE = `
# Batch Budget Updates

Update multiple category budgets in a single operation.

## Why Use Batch Updates?

**Benefits:**
- Faster than individual calls
- Atomic operation (all succeed or all fail)
- Reduces API round-trips
- Easier error handling

**Use cases:**
- Monthly budget setup (all categories at once)
- Budget template application
- Multiple related adjustments
- Rebalancing across categories

## Batch Update Syntax

\`\`\`javascript
await actual_budgets_updates_batch({
  month: "2025-12",
  updates: [
    {
      category: "groceries-uuid",
      budgeted: 50000  // $500.00
    },
    {
      category: "dining-uuid",
      budgeted: 20000  // $200.00
    },
    {
      category: "gas-uuid",
      budgeted: 15000  // $150.00
    }
  ]
});
\`\`\`

## Update Fields

Each update entry can include:
- \`category\` (required): Category UUID
- \`budgeted\` (optional): Budget amount in cents
- \`carryover\` (optional): Enable/disable carryover
- \`held\` (optional): Hold amount for next month

\`\`\`javascript
await actual_budgets_updates_batch({
  month: "2025-12",
  updates: [
    {
      category: "vacation-uuid",
      budgeted: 50000,
      carryover: true  // Enable carryover
    },
    {
      category: "insurance-uuid",
      budgeted: 100000,
      held: 100000  // Hold entire amount for next month
    }
  ]
});
\`\`\`

## Batch Update Patterns

### Pattern 1: Apply Budget Template
\`\`\`javascript
const monthlyTemplate = {
  "groceries-uuid": 50000,
  "dining-uuid": 20000,
  "gas-uuid": 15000,
  "utilities-uuid": 25000,
  "rent-uuid": 150000,
  "savings-uuid": 100000
};

const updates = Object.entries(monthlyTemplate).map(([cat, amount]) => ({
  category: cat,
  budgeted: amount
}));

await actual_budgets_updates_batch({
  month: "2025-12",
  updates
});
\`\`\`

### Pattern 2: Zero-Based Reset
\`\`\`javascript
// Get all categories
const categories = await actual_categories_get();

// Zero out all budgets
const updates = categories.map(cat => ({
  category: cat.id,
  budgeted: 0
}));

await actual_budgets_updates_batch({
  month: "2025-12",
  updates
});
\`\`\`

### Pattern 3: Percentage Increase
\`\`\`javascript
// Get current month budgets
const currentBudgets = await actual_budgets_getMonth({
  month: "2025-12"
});

// Increase all by 5%
const updates = currentBudgets.map(b => ({
  category: b.category,
  budgeted: Math.round(b.budgeted * 1.05)
}));

await actual_budgets_updates_batch({
  month: "2026-01",  // Apply to next month
  updates
});
\`\`\`

### Pattern 4: Conditional Updates
\`\`\`javascript
// Only update categories in specific group
const categories = await actual_categories_get();
const foodCats = categories.filter(c => 
  c.group_id === "food-group-uuid"
);

const updates = foodCats.map(cat => ({
  category: cat.id,
  budgeted: 30000  // Set all food categories to $300
}));

await actual_budgets_updates_batch({
  month: "2025-12",
  updates
});
\`\`\`

## Error Handling

**Batch operations are atomic:**
- All updates succeed together
- If any fails, all fail (rollback)
- Check errors in response

\`\`\`javascript
try {
  const result = await actual_budgets_updates_batch({
    month: "2025-12",
    updates: [/* ... */]
  });
  console.log(\`Updated \${result.updated} budgets\`);
} catch (error) {
  console.error("Batch update failed:", error);
  // No budgets were updated
}
\`\`\`

## Batch Best Practices

1. **Validate before batch**
   \`\`\`javascript
   const updates = [/* ... */];
   
   // Validate all amounts are valid
   const valid = updates.every(u => 
     Number.isInteger(u.budgeted) && u.budgeted >= 0
   );
   
   if (valid) {
     await actual_budgets_updates_batch({ month, updates });
   }
   \`\`\`

2. **Use for related changes**
   - Changes that should succeed/fail together
   - Not for unrelated single-category updates

3. **Limit batch size**
   - Reasonable: 10-50 updates
   - Very large batches may timeout
   - Split if needed

4. **Prefer batch over loops**
   \`\`\`javascript
   // ❌ Slow, multiple API calls
   for (const cat of categories) {
     await actual_budgets_setAmount({
       month: "2025-12",
       category: cat.id,
       amount: 50000
     });
   }
   
   // ✅ Fast, single API call
   await actual_budgets_updates_batch({
     month: "2025-12",
     updates: categories.map(cat => ({
       category: cat.id,
       budgeted: 50000
     }))
   });
   \`\`\`

## Batch Response

\`\`\`javascript
const result = await actual_budgets_updates_batch({
  month: "2025-12",
  updates: [/* ... */]
});

// Response typically includes:
// {
//   success: true,
//   updated: 10,  // Number of budgets updated
//   month: "2025-12"
// }
\`\`\`
`;

const STRATEGIES_GUIDE = `
# Budgeting Strategies

Different approaches to budgeting with Actual Budget.

## Strategy 1: Zero-Based Budgeting

**Concept:** Every dollar has a job. Budget = Income.

**Implementation:**
\`\`\`javascript
// 1. Get income for month
const income = await actual_transactions_summary_by_category({
  startDate: "2025-12-01",
  endDate: "2025-12-31"
});
const totalIncome = income
  .filter(i => i.categoryName.includes("Income"))
  .reduce((sum, i) => sum + i.total, 0);

// 2. Allocate all income to categories
const allocations = {
  "rent-uuid": 150000,
  "groceries-uuid": 50000,
  "utilities-uuid": 25000,
  "savings-uuid": 75000
  // ... total = totalIncome
};

// 3. Apply budgets
const updates = Object.entries(allocations).map(([cat, amt]) => ({
  category: cat,
  budgeted: amt
}));

await actual_budgets_updates_batch({
  month: "2025-12",
  updates
});
\`\`\`

## Strategy 2: 50/30/20 Rule

**Concept:** 50% needs, 30% wants, 20% savings

**Implementation:**
\`\`\`javascript
const monthlyIncome = 500000;  // $5000

// Needs (50%): $2500
const needs = {
  "rent-uuid": 150000,
  "utilities-uuid": 25000,
  "groceries-uuid": 50000,
  "insurance-uuid": 25000
  // Total: $2500
};

// Wants (30%): $1500
const wants = {
  "dining-uuid": 50000,
  "entertainment-uuid": 40000,
  "hobbies-uuid": 60000
  // Total: $1500
};

// Savings (20%): $1000
const savings = {
  "emergency-fund-uuid": 50000,
  "retirement-uuid": 50000
  // Total: $1000
};

// Combine and apply
const all = { ...needs, ...wants, ...savings };
// ... batch update
\`\`\`

## Strategy 3: Envelope Budgeting

**Concept:** Physical cash envelopes, digital version

**Implementation:**
\`\`\`javascript
// Each category = envelope
// Budget = money in envelope
// Spending = taking from envelope
// Carryover = keep leftover in envelope

// Setup envelopes with carryover
const envelopes = [
  { category: "groceries-uuid", amount: 50000, carryover: true },
  { category: "gas-uuid", amount: 20000, carryover: true },
  { category: "dining-uuid", amount: 15000, carryover: true }
];

for (const env of envelopes) {
  await actual_budgets_setAmount({
    month: "2025-12",
    category: env.category,
    amount: env.amount
  });
  
  await actual_budgets_setCarryover({
    month: "2025-12",
    category: env.category,
    flag: env.carryover
  });
}
\`\`\`

## Strategy 4: Paycheck Budgeting

**Concept:** Budget by paycheck, not by month

**Implementation:**
\`\`\`javascript
// Paycheck 1 (1st of month): $2500
const paycheck1 = {
  "rent-uuid": 150000,
  "utilities-uuid": 25000,
  "groceries-uuid": 25000,
  "savings-uuid": 50000
};

// Paycheck 2 (15th of month): $2500
const paycheck2 = {
  "groceries-uuid": 25000,   // Additional
  "gas-uuid": 20000,
  "dining-uuid": 30000,
  "savings-uuid": 50000
};

// Apply both to same month
// First paycheck
await actual_budgets_updates_batch({
  month: "2025-12",
  updates: Object.entries(paycheck1).map(([cat, amt]) => ({
    category: cat,
    budgeted: amt
  }))
});

// Second paycheck (adds to existing budgets)
await actual_budgets_updates_batch({
  month: "2025-12",
  updates: Object.entries(paycheck2).map(([cat, amt]) => ({
    category: cat,
    budgeted: amt
  }))
});
\`\`\`

## Strategy 5: Sinking Funds

**Concept:** Save gradually for irregular expenses

**Implementation:**
\`\`\`javascript
// Example: $1200 car insurance due in 12 months
// Save $100/month with carryover

await actual_budgets_setAmount({
  month: "2025-01",
  category: "car-insurance-uuid",
  amount: 10000  // $100
});

await actual_budgets_setCarryover({
  category: "car-insurance-uuid",
  flag: true  // Accumulate over 12 months
});

// Repeat monthly or set up automation
// After 12 months: $1200 accumulated
\`\`\`

## Strategy 6: Priority-Based Budgeting

**Concept:** Budget essentials first, then priorities

**Implementation:**
\`\`\`javascript
const income = 500000;  // $5000
let remaining = income;

// Priority 1: Essentials (must pay)
const essentials = {
  "rent-uuid": 150000,
  "utilities-uuid": 25000,
  "groceries-uuid": 40000
};
remaining -= 215000;

// Priority 2: Important (should pay)
const important = {
  "insurance-uuid": 20000,
  "gas-uuid": 15000,
  "phone-uuid": 10000
};
remaining -= 45000;

// Priority 3: Savings (future)
const savings = {
  "emergency-fund-uuid": Math.min(remaining, 100000)
};
remaining -= savings["emergency-fund-uuid"];

// Priority 4: Discretionary (if remaining)
const discretionary = {
  "dining-uuid": remaining
};

// Apply in order
\`\`\`

## Strategy Comparison

| Strategy | Best For | Complexity | Flexibility |
|----------|----------|------------|-------------|
| Zero-Based | Variable income | Medium | High |
| 50/30/20 | Beginners | Low | Medium |
| Envelope | Visual thinkers | Low | High |
| Paycheck | Bi-weekly pay | Medium | Medium |
| Sinking Funds | Irregular expenses | Low | High |
| Priority-Based | Limited income | Medium | Low |

## Mixing Strategies

**Common combinations:**
- Envelope + Sinking Funds: Daily envelopes + annual goals
- 50/30/20 + Zero-Based: Percentage targets + full allocation
- Paycheck + Priority: Allocate each paycheck by priority

**Implementation:**
\`\`\`javascript
// Example: 50/30/20 with sinking funds

// 50% Needs (with envelopes)
const needs = {
  "rent-uuid": { amount: 150000, carryover: false },
  "groceries-uuid": { amount: 50000, carryover: true }  // Envelope
};

// 20% Savings (with sinking funds)
const savings = {
  "emergency-uuid": { amount: 50000, carryover: true },  // Sinking
  "vacation-uuid": { amount: 50000, carryover: true }    // Sinking
};

// Apply with appropriate carryover settings
\`\`\`
`;

const EXAMPLES = `
# Budget Examples

## Example 1: Set Monthly Budget
\`\`\`javascript
await actual_budgets_setAmount({
  month: "2025-12",
  category: "groceries-uuid",
  amount: 50000  // $500.00
});
\`\`\`

## Example 2: Enable Carryover for Savings
\`\`\`javascript
await actual_budgets_setCarryover({
  month: "2025-12",
  category: "vacation-fund-uuid",
  flag: true  // Unused budget carries to next month
});
\`\`\`

## Example 3: Hold Budget for Future Month
\`\`\`javascript
await actual_budgets_holdForNextMonth({
  month: "2025-12",
  category: "insurance-uuid",
  amount: 100000  // Hold $1000 for January
});
\`\`\`

## Example 4: Transfer Between Categories
\`\`\`javascript
// Overspent Dining, transfer from Entertainment
await actual_budgets_transfer({
  month: "2025-12",
  fromCategory: "entertainment-uuid",
  toCategory: "dining-uuid",
  amount: 3000  // Transfer $30
});
\`\`\`

## Example 5: Batch Setup Monthly Budget
\`\`\`javascript
await actual_budgets_updates_batch({
  month: "2025-12",
  updates: [
    { category: "rent-uuid", budgeted: 150000 },
    { category: "groceries-uuid", budgeted: 50000 },
    { category: "utilities-uuid", budgeted: 25000 },
    { category: "gas-uuid", budgeted: 15000 },
    { category: "dining-uuid", budgeted: 20000 },
    { category: "savings-uuid", budgeted: 100000 }
  ]
});
\`\`\`

## Example 6: Get Current Month Budget Status
\`\`\`javascript
const budget = await actual_budgets_getMonth({
  month: "2025-12"
});

budget.forEach(b => {
  const budgeted = b.budgeted / 100;
  const spent = b.spent / 100;
  const balance = b.balance / 100;
  
  console.log(\`\${b.categoryName}:\`);
  console.log(\`  Budgeted: $\${budgeted}\`);
  console.log(\`  Spent: $\${spent}\`);
  console.log(\`  Balance: $\${balance}\`);
});
\`\`\`

## Example 7: Check Budget Balance
\`\`\`javascript
const budget = await actual_budgets_getMonth({
  month: "2025-12"
});

const overspent = budget.filter(b => b.balance < 0);

if (overspent.length > 0) {
  console.log("Overspent categories:");
  overspent.forEach(b => {
    console.log(\`  \${b.categoryName}: $\${b.balance / 100}\`);
  });
}
\`\`\`

## Example 8: Apply Budget Template
\`\`\`javascript
const template = {
  "rent": 150000,
  "groceries": 50000,
  "utilities": 25000,
  "gas": 15000,
  "dining": 20000,
  "entertainment": 10000,
  "savings": 100000
};

// Get category UUIDs by name
const categories = await actual_categories_get();
const updates = [];

for (const [name, amount] of Object.entries(template)) {
  const cat = categories.find(c => c.name === name);
  if (cat) {
    updates.push({ category: cat.id, budgeted: amount });
  }
}

await actual_budgets_updates_batch({
  month: "2025-12",
  updates
});
\`\`\`

## Example 9: Budget Rollover (Copy Previous Month)
\`\`\`javascript
// Get previous month's budget
const prevBudget = await actual_budgets_getMonth({
  month: "2025-11"
});

// Apply to current month
const updates = prevBudget.map(b => ({
  category: b.category,
  budgeted: b.budgeted
}));

await actual_budgets_updates_batch({
  month: "2025-12",
  updates
});
\`\`\`

## Example 10: Track Savings Goal Progress
\`\`\`javascript
// Get all months for vacation category
const months = await actual_budgets_getMonths({
  startMonth: "2025-01",
  endMonth: "2025-12"
});

const vacationProgress = months
  .map(monthBudget => {
    const vacation = monthBudget.find(b => 
      b.categoryName === "Vacation Fund"
    );
    return {
      month: monthBudget.month,
      balance: vacation ? vacation.balance / 100 : 0
    };
  });

vacationProgress.forEach(m => {
  console.log(\`\${m.month}: $\${m.balance}\`);
});

const total = vacationProgress[vacationProgress.length - 1].balance;
console.log(\`Total saved: $\${total}\`);
\`\`\`
`;

const tool: ToolDefinition = {
  name: 'actual_budgets_help',
  description:
    'Get comprehensive help and examples for budget management in Actual Budget. Covers budget concepts, carryover, holds, transfers, batch updates, and various budgeting strategies (zero-based, 50/30/20, envelope, etc.). Use this tool BEFORE working with budgets to understand concepts and avoid mistakes. Topics: overview, concepts, carryover, holds, transfers, batch, strategies, examples, all.',
  inputSchema: InputSchema,
  call: async (args: unknown) => {
    const input = InputSchema.parse(args);
    const topic = input.topic || 'all';
    const keyword = input.keyword?.toLowerCase();

    let content = '';

    // Build content based on topic
    if (topic === 'all' || topic === 'overview') {
      content += BUDGETS_OVERVIEW;
    }
    if (topic === 'all' || topic === 'concepts') {
      content += '\n\n' + BUDGET_CONCEPTS;
    }
    if (topic === 'all' || topic === 'carryover') {
      content += '\n\n' + CARRYOVER_GUIDE;
    }
    if (topic === 'all' || topic === 'holds') {
      content += '\n\n' + HOLDS_GUIDE;
    }
    if (topic === 'all' || topic === 'transfers') {
      content += '\n\n' + TRANSFERS_GUIDE;
    }
    if (topic === 'all' || topic === 'batch') {
      content += '\n\n' + BATCH_GUIDE;
    }
    if (topic === 'all' || topic === 'strategies') {
      content += '\n\n' + STRATEGIES_GUIDE;
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
            'Try keywords like: carryover, hold, transfer, envelope, zero-based, batch',
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
        'actual_budgets_setAmount',
        'actual_budgets_setCarryover',
        'actual_budgets_holdForNextMonth',
        'actual_budgets_transfer',
        'actual_budgets_updates_batch',
      ],
      usage_note:
        'Use this help BEFORE calling budget tools to understand concepts like carryover, holds, and transfers.',
    };
  },
};

export default tool;
