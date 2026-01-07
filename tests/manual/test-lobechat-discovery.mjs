#!/usr/bin/env node
/**
 * Simulate LobeChat MCP discovery flow
 */

import fetch from 'node-fetch';

const MCP_SERVER_URL = 'http://localhost:3600/http';
const AUTH_TOKEN = 'TEST-TOKEN-FOR-AUTOMATED-TESTING-ONLY';

console.log('🔍 Simulating LobeChat MCP Discovery...\n');

async function testLobeChat() {
  try {
    // LobeChat might call tools/list WITHOUT initialize first
    console.log('1️⃣  Attempting tools/list WITHOUT session (LobeChat behavior)...');
    const toolsResponse = await fetch(MCP_SERVER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': '*/*', // LobeChat might send */*
        'Authorization': `Bearer ${AUTH_TOKEN}`
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list'
      })
    });
    
    const toolsData = await toolsResponse.json();
    console.log('   Response status:', toolsResponse.status);
    console.log('   Response:', JSON.stringify(toolsData, null, 2).substring(0, 500));
    
    if (toolsData.result && toolsData.result.tools) {
      console.log(`\n   ✅ Got ${toolsData.result.tools.length} tools`);
      if (toolsData.result.tools.length > 0) {
        console.log('   First tool:', toolsData.result.tools[0].name);
      }
    } else if (toolsData.error) {
      console.log('\n   ❌ Error:', toolsData.error.message);
    }
    
    // Test with Accept: application/json
    console.log('\n2️⃣  Attempting tools/list with Accept: application/json...');
    const toolsResponse2 = await fetch(MCP_SERVER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${AUTH_TOKEN}`
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list'
      })
    });
    
    const toolsData2 = await toolsResponse2.json();
    console.log('   Response status:', toolsResponse2.status);
    
    if (toolsData2.result && toolsData2.result.tools) {
      console.log(`   ✅ Got ${toolsData2.result.tools.length} tools`);
    } else if (toolsData2.error) {
      console.log('   ❌ Error:', toolsData2.error.message);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

testLobeChat();
