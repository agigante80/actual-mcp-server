#!/usr/bin/env node
/**
 * Simple test to check what actual_categories_create returns
 */

import fetch from 'node-fetch';

const MCP_SERVER_URL = 'http://localhost:3600';
const HTTP_PATH = '/http';
const AUTH_TOKEN = 'TEST-TOKEN-FOR-AUTOMATED-TESTING-ONLY';

async function test() {
  // Initialize session
  console.log('1. Initializing session...');
  const initResponse = await fetch(`${MCP_SERVER_URL}${HTTP_PATH}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${AUTH_TOKEN}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'simple-test', version: '1.0.0' },
      },
    }),
  });

  const sessionId = initResponse.headers.get('mcp-session-id');
  console.log(`   Session ID: ${sessionId}\n`);

  // Create category group
  console.log('2. Creating category group...');
  const groupResponse = await fetch(`${MCP_SERVER_URL}${HTTP_PATH}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${AUTH_TOKEN}`,
      'mcp-session-id': sessionId,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'actual_category_groups_create',
        arguments: { name: `Test-Group-${Date.now()}` },
      },
    }),
  });

  const groupJson = await groupResponse.json();
  console.log('   Group response:', JSON.stringify(groupJson, null, 2), '\n');

  const groupId = groupJson.result?.content?.[0]?.text 
    ? JSON.parse(groupJson.result.content[0].text).id 
    : groupJson.result?.id;

  console.log(`   Extracted group ID: ${groupId}\n`);

  // Create category
  console.log('3. Creating category...');
  const categoryResponse = await fetch(`${MCP_SERVER_URL}${HTTP_PATH}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${AUTH_TOKEN}`,
      'mcp-session-id': sessionId,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'actual_categories_create',
        arguments: { name: 'Test-Category', group_id: groupId },
      },
    }),
  });

  const categoryJson = await categoryResponse.json();
  console.log('   Category response:', JSON.stringify(categoryJson, null, 2), '\n');

  // Try to extract ID
  const result = categoryJson.result;
  let categoryId;

  if (result?.content?.[0]?.text) {
    console.log('   Found content[0].text:', result.content[0].text);
    try {
      const parsed = JSON.parse(result.content[0].text);
      console.log('   Parsed:', JSON.stringify(parsed, null, 2));
      categoryId = parsed.id || parsed.categoryId;
    } catch (e) {
      console.log('   Could not parse as JSON:', e.message);
      categoryId = result.content[0].text;
    }
  } else if (result?.id) {
    categoryId = result.id;
  } else if (result?.categoryId) {
    categoryId = result.categoryId;
  }

  console.log(`\n   Extracted category ID: ${categoryId}`);
}

test().catch(console.error);
