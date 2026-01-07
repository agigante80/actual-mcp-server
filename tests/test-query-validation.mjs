#!/usr/bin/env node
/**
 * Test Script: Query Validation
 * 
 * Tests the new schema validation system that prevents server crashes
 * by validating queries before execution.
 */

import { validateQuery, formatValidationErrors } from '../dist/src/lib/query-validator.js';

console.log('🧪 Testing Query Validation\n');
console.log('=' .repeat(60));

const tests = [
  {
    name: 'Valid query with SELECT *',
    query: 'SELECT * FROM transactions LIMIT 10',
    shouldPass: true,
  },
  {
    name: 'Valid query with specific fields',
    query: 'SELECT id, date, amount, account FROM transactions',
    shouldPass: true,
  },
  {
    name: 'Valid query with join path (payee.name)',
    query: 'SELECT id, date, amount, payee.name FROM transactions LIMIT 10',
    shouldPass: true,
  },
  {
    name: 'Valid query with join path (category.name)',
    query: 'SELECT id, amount, category.name FROM transactions WHERE amount < 0',
    shouldPass: true,
  },
  {
    name: 'Invalid field: payee_name (should suggest payee)',
    query: 'SELECT id, payee_name FROM transactions LIMIT 5',
    shouldPass: false,
  },
  {
    name: 'Invalid field: category_name (should suggest category.name)',
    query: 'SELECT id, category_name FROM transactions',
    shouldPass: false,
  },
  {
    name: 'Invalid table: transaction (singular)',
    query: 'SELECT * FROM transaction LIMIT 10',
    shouldPass: false,
  },
  {
    name: 'Invalid field in WHERE clause',
    query: 'SELECT id, amount FROM transactions WHERE payee_name = "Test"',
    shouldPass: false,
  },
  {
    name: 'Valid query with WHERE and ORDER BY',
    query: 'SELECT id, date, amount FROM transactions WHERE amount < 0 ORDER BY date DESC LIMIT 20',
    shouldPass: true,
  },
  {
    name: 'Multiple invalid fields',
    query: 'SELECT id, payee_name, category_name FROM transactions',
    shouldPass: false,
  },
];

let passed = 0;
let failed = 0;

for (const test of tests) {
  console.log(`\n📝 Test: ${test.name}`);
  console.log(`   Query: "${test.query}"`);
  
  const result = validateQuery(test.query);
  
  if (result.valid === test.shouldPass) {
    console.log('   ✅ PASS');
    passed++;
    
    if (!result.valid) {
      // Show the helpful error message for failed validation
      console.log(`   Error message:\n${formatValidationErrors(result).split('\n').map(l => '      ' + l).join('\n')}`);
    }
  } else {
    console.log(`   ❌ FAIL - Expected valid=${test.shouldPass}, got valid=${result.valid}`);
    failed++;
    
    if (!result.valid) {
      console.log(`   Errors: ${JSON.stringify(result.errors, null, 2)}`);
    }
  }
}

console.log('\n' + '='.repeat(60));
console.log(`\n📊 Results: ${passed}/${tests.length} tests passed`);

if (failed > 0) {
  console.log(`❌ ${failed} test(s) failed`);
  process.exit(1);
} else {
  console.log('✅ All tests passed!');
  process.exit(0);
}
