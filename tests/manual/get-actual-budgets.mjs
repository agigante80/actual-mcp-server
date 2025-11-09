#!/usr/bin/env node

/**
 * Helper script to list available budgets on the Actual Budget server
 * Usage: node test/get-actual-budgets.mjs
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const serverUrl = process.env.ACTUAL_SERVER_URL || 'http://localhost:5007';

console.log('🔍 Checking for available budgets on Actual Budget server...');
console.log(`📍 Server: ${serverUrl}`);

try {
  // Try to get the budgets list from the server
  const response = await fetch(`${serverUrl}/list-user-files`);
  
  if (response.ok) {
    const budgets = await response.json();
    console.log('\n📊 Available budgets:');
    console.log('===================');
    
    if (budgets && budgets.length > 0) {
      budgets.forEach((budget, index) => {
        console.log(`${index + 1}. ${budget.name || budget.id}`);
        console.log(`   ID: ${budget.id || budget.fileId || 'N/A'}`);
        console.log(`   Created: ${budget.createdAt || 'N/A'}`);
        console.log('');
      });
      
      // Export the first budget ID as environment variable format
      if (budgets[0]) {
        const budgetId = budgets[0].id || budgets[0].fileId;
        if (budgetId) {
          console.log('📋 To use the first budget, set:');
          console.log(`export ACTUAL_BUDGET_SYNC_ID="${budgetId}"`);
          console.log('');
          
          // Write to a file for easy sourcing
          const fs = await import('fs');
          fs.writeFileSync('.env.detected-budget', [
            `ACTUAL_BUDGET_SYNC_ID="${budgetId}"`,
            `ACTUAL_BUDGET_NAME="${budgets[0].name || 'Detected Budget'}"`,
            `ACTUAL_SERVER_URL="${serverUrl}"`,
            `ACTUAL_PASSWORD=""`,
            `DETECTED_AT="${new Date().toISOString()}"`
          ].join('\n'));
          console.log('✅ Budget configuration saved to .env.detected-budget');
        }
      }
    } else {
      console.log('⚠️  No budgets found. Create a budget in the Actual Budget web interface first.');
      console.log(`   Visit: ${serverUrl}`);
    }
  } else {
    console.log(`❌ Could not connect to server: ${response.status} ${response.statusText}`);
  }
  
} catch (error) {
  // Try alternative endpoints
  try {
    console.log('⚠️  Standard endpoint failed, trying alternative methods...');
    
    // Check if server is running
    const healthCheck = await fetch(`${serverUrl}/health`);
    if (healthCheck.ok) {
      console.log('✅ Server is running but no budgets API found');
      console.log('📝 You need to create a budget manually in the web interface');
      console.log(`   Visit: ${serverUrl}`);
      console.log('');
      console.log('💡 After creating a budget:');
      console.log('   1. Note the budget name from the UI');
      console.log('   2. Run this script again to detect it');
      console.log('   3. Or check browser network requests for the sync ID');
    } else {
      console.log('❌ Server health check failed');
    }
  } catch (secondError) {
    console.error('❌ Error connecting to Actual Budget server:', error.message);
    console.log('');
    console.log('🛠️ Troubleshooting:');
    console.log(`   - Is Actual Budget running at ${serverUrl}?`);
    console.log('   - Start it with: cd test/docker-actual-test && docker-compose up -d');
  }
}