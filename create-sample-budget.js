const fs = require('fs');
const path = require('path');

// Create a minimal Actual budget structure
const budgetData = {
  accounts: [
    { id: 'acct1', name: 'Checking Account', type: 'checking' },
    { id: 'acct2', name: 'Savings Account', type: 'savings' }
  ],
  categories: [
    { id: 'cat1', name: 'Groceries' },
    { id: 'cat2', name: 'Utilities' }
  ],
  payees: [
    { id: 'payee1', name: 'Grocery Store' },
    { id: 'payee2', name: 'Electric Company' }
  ]
};

// Save as JSON for inspection
fs.writeFileSync('test-actual-data/sample-budget.json', JSON.stringify(budgetData, null, 2));
console.log('✅ Sample budget data created');
console.log('📊 Contains:', Object.keys(budgetData).map(k => `${budgetData[k].length} ${k}`).join(', '));
