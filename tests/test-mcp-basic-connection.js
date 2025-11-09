#!/usr/bin/env node
/**
 * Basic MCP Server Connection Test
 * Tests MCP server startup and HTTP endpoints without requiring budget download
 */

import { spawn } from 'child_process';
import { setTimeout } from 'timers/promises';

const ACTUAL_SERVER_URL = 'http://localhost:5007';
const MCP_PORT = 3600;

async function testBasicMCPConnection() {
    console.log('🧪 Testing Basic MCP Connection');
    console.log('=====================================');
    
    // Set minimal environment for MCP server
    const env = {
        ...process.env,
        ACTUAL_SERVER_URL,
        ACTUAL_PASSWORD: '',
        ACTUAL_BUDGET_SYNC_ID: 'test-budget-id',
        SKIP_BUDGET_DOWNLOAD: 'true',
        LOG_LEVEL: 'info'
    };
    
    console.log('🚀 Starting MCP server in test mode...');
    
    // Start MCP server
    const mcpServer = spawn('npm', ['--silent', 'run', 'start', '--', '--http'], {
        env,
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe']
    });
    
    let mcpOutput = '';
    mcpServer.stdout?.on('data', (data) => {
        mcpOutput += data.toString();
        console.log(`📡 MCP: ${data.toString().trim()}`);
    });
    
    mcpServer.stderr?.on('data', (data) => {
        const message = data.toString().trim();
        if (message) {
            console.log(`⚠️  MCP Error: ${message}`);
        }
    });
    
    // Wait for server to start
    console.log('⏳ Waiting for MCP server to start...');
    await setTimeout(8000);
    
    // Test HTTP endpoints
    console.log('\n🔍 Testing HTTP endpoints...');
    
    try {
        // Test health endpoint
        const healthResponse = await fetch(`http://localhost:${MCP_PORT}/health`);
        console.log(`✅ Health check: ${healthResponse.status}`);
        
        // Test MCP info endpoint
        const infoResponse = await fetch(`http://localhost:${MCP_PORT}/mcp/info`);
        console.log(`✅ MCP info: ${infoResponse.status}`);
        
        if (infoResponse.ok) {
            const info = await infoResponse.json();
            console.log(`📊 MCP Info:`, JSON.stringify(info, null, 2));
        }
        
        console.log('\n✅ Basic MCP infrastructure test completed successfully!');
        
    } catch (error) {
        console.error('❌ HTTP endpoint test failed:', error.message);
    } finally {
        // Cleanup
        console.log('\n🧹 Cleaning up...');
        mcpServer.kill('SIGTERM');
        await setTimeout(2000);
        
        if (!mcpServer.killed) {
            mcpServer.kill('SIGKILL');
        }
    }
}

// Run test
testBasicMCPConnection().catch(console.error);