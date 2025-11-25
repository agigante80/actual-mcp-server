#!/usr/bin/env node
/**
 * Check what accounts are in the local database
 */

import Database from 'better-sqlite3';

const dbPath = './tests/manual/test-stack/mcp/actual-data/_test-budget/db.sqlite';

try {
  const db = new Database(dbPath, { readonly: true });
  
  console.log('=== Accounts in Local Database ===\n');
  
  const accounts = db.prepare('SELECT id, name, closed, tombstone FROM accounts ORDER BY name').all();
  
  console.log(`Total accounts: ${accounts.length}\n`);
  
  accounts.forEach((acc, i) => {
    const flags = [];
    if (acc.closed) flags.push('CLOSED');
    if (acc.tombstone) flags.push('DELETED');
    
    console.log(`${i + 1}. ${acc.name}`);
    console.log(`   ID: ${acc.id}`);
    if (flags.length > 0) {
      console.log(`   Flags: ${flags.join(', ')}`);
    }
    console.log('');
  });
  
  // Check for test accounts specifically
  const testAccounts = db.prepare("SELECT id, name, closed, tombstone FROM accounts WHERE name LIKE '%MCP-Test%' OR name LIKE '%DEBUG%' OR name LIKE '%12-12%'").all();
  
  if (testAccounts.length > 0) {
    console.log('=== Test Accounts Found ===');
    testAccounts.forEach(acc => {
      console.log(`- ${acc.name} (${acc.id}) - closed: ${acc.closed}, tombstone: ${acc.tombstone}`);
    });
  } else {
    console.log('No test accounts found in database');
  }
  
  db.close();
} catch (err) {
  console.error('Error:', err.message);
  process.exit(1);
}
