#!/usr/bin/env node
/**
 * Budget Detection and Setup Script
 * Detects available budgets on Actual Budget server and configures the environment
 */

import { setTimeout } from 'timers/promises';

const ACTUAL_SERVER_URL = process.env.ACTUAL_SERVER_URL || 'http://localhost:5007';

async function detectAvailableBudgets() {
    console.log('🔍 Detecting available budgets on Actual Budget server...');
    console.log(`📍 Server: ${ACTUAL_SERVER_URL}`);
    
    try {
        // Check server health
        const healthResponse = await fetch(`${ACTUAL_SERVER_URL}/health`);
        if (!healthResponse.ok) {
            throw new Error(`Server not healthy: ${healthResponse.status}`);
        }
        console.log('✅ Server is healthy');
        
        // Try to get budget list (this is a common endpoint pattern)
        const endpoints = [
            '/api/budgets',
            '/sync/list',
            '/budgets',
            '/account/list-budgets',
        ];
        
        for (const endpoint of endpoints) {
            try {
                console.log(`🔎 Trying ${endpoint}...`);
                const response = await fetch(`${ACTUAL_SERVER_URL}${endpoint}`);
                if (response.ok) {
                    const data = await response.json();
                    console.log(`✅ Found data at ${endpoint}:`, JSON.stringify(data, null, 2));
                }
            } catch (error) {
                console.log(`⚠️  ${endpoint}: ${error.message}`);
            }
        }
        
        console.log('');
        console.log('📋 Next Steps:');
        console.log('1. Open http://localhost:5007 in your browser');
        console.log('2. Import your budget file or create a new budget');
        console.log('3. Get the sync ID from the budget URL or settings');
        console.log('4. Update the e2e test with the correct sync ID');
        
    } catch (error) {
        console.error('❌ Error detecting budgets:', error.message);
    }
}

detectAvailableBudgets().catch(console.error);