const http = require('http');

// Configuration
const MCP_URL = process.argv[2] || 'http://localhost:3600/http';
const AUTH_TOKEN = process.argv[3] || 'TEST-TOKEN-FOR-AUTOMATED-TESTING-ONLY';
const SESSION_ID = `test-account-validation-${Date.now()}`;

// Parse URL
const mcpUrl = new URL(MCP_URL);
const options = {
  hostname: mcpUrl.hostname,
  port: mcpUrl.port,
  path: mcpUrl.pathname,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'mcp-session-id': SESSION_ID,
    'Authorization': `Bearer ${AUTH_TOKEN}`,
  },
};

console.log(`\n🧪 Testing Account Validation in Search Tools`);
console.log(`📍 MCP URL: ${MCP_URL}`);
console.log(`🔑 Session ID: ${SESSION_ID}\n`);

let requestId = 1;

function makeRequest(method, params = {}) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      jsonrpc: '2.0',
      id: requestId++,
      method,
      params,
    });

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          resolve(response);
        } catch (error) {
          reject(new Error(`Failed to parse response: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function runTests() {
  try {
    // Initialize MCP session
    console.log('1️⃣  Initializing MCP session...');
    await makeRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-account-validation', version: '1.0.0' },
    });
    console.log('✅ Session initialized\n');

    // Test 1: Invalid account UUID
    console.log('2️⃣  Test 1: Search with invalid account UUID');
    console.log('   Input: accountId="invalid-uuid-12345"');
    const test1 = await makeRequest('tools/call', {
      name: 'actual_transactions_search_by_amount',
      arguments: {
        accountId: 'invalid-uuid-12345',
        minAmount: -10000,
        maxAmount: 10000,
      },
    });
    
    if (test1.result?.content?.[0]?.text) {
      const result = JSON.parse(test1.result.content[0].text);
      if (result.error && result.error.includes('not found')) {
        console.log(`   ✅ Got expected error: "${result.error}"`);
      } else {
        console.log(`   ❌ Expected error message, got: ${JSON.stringify(result, null, 2)}`);
      }
    } else {
      console.log(`   ❌ Unexpected response format: ${JSON.stringify(test1, null, 2)}`);
    }
    console.log('');

    // Test 2: Account name instead of UUID
    console.log('3️⃣  Test 2: Search with account name instead of UUID');
    console.log('   Input: accountId="Test-Search-1766052016859"');
    const test2 = await makeRequest('tools/call', {
      name: 'actual_transactions_search_by_amount',
      arguments: {
        accountId: 'Test-Search-1766052016859',
        minAmount: -10000,
        maxAmount: 10000,
      },
    });
    
    if (test2.result?.content?.[0]?.text) {
      const result = JSON.parse(test2.result.content[0].text);
      if (result.error) {
        console.log(`   ✅ Got error: "${result.error}"`);
        if (result.error.includes('appears to be a name')) {
          console.log(`   ✅ Error correctly identifies name vs UUID issue`);
        } else if (result.error.includes('not found')) {
          console.log(`   ⚠️  Error says "not found" (account doesn't exist by that name)`);
        }
      } else {
        console.log(`   ❌ Expected error message, got: ${JSON.stringify(result, null, 2)}`);
      }
    } else {
      console.log(`   ❌ Unexpected response format: ${JSON.stringify(test2, null, 2)}`);
    }
    console.log('');

    // Test 3: Verify it works with valid UUID (get real account first)
    console.log('4️⃣  Test 3: Search with valid account UUID');
    const accountsResponse = await makeRequest('tools/call', {
      name: 'actual_accounts_list',
      arguments: {},
    });
    
    if (accountsResponse.result?.content?.[0]?.text) {
      const accountsResult = JSON.parse(accountsResponse.result.content[0].text);
      const firstAccount = accountsResult.accounts?.[0];
      
      if (firstAccount && firstAccount.id) {
        console.log(`   Using account: "${firstAccount.name}" (${firstAccount.id})`);
        
        const test3 = await makeRequest('tools/call', {
          name: 'actual_transactions_search_by_amount',
          arguments: {
            accountId: firstAccount.id,
            minAmount: -100000,
            maxAmount: 100000,
          },
        });
        
        if (test3.result?.content?.[0]?.text) {
          const result = JSON.parse(test3.result.content[0].text);
          if (result.error) {
            console.log(`   ❌ Got unexpected error: "${result.error}"`);
          } else {
            console.log(`   ✅ Search succeeded: found ${result.count} transactions`);
          }
        }
      } else {
        console.log(`   ⚠️  No accounts found in budget`);
      }
    }
    console.log('');

    // Test 4: Verify other search tools also have validation
    console.log('5️⃣  Test 4: Verify validation in other search tools');
    
    const toolsToTest = [
      'actual_transactions_search_by_category',
      'actual_transactions_search_by_payee',
      'actual_transactions_search_by_month',
    ];
    
    for (const toolName of toolsToTest) {
      const testArgs = { accountId: 'invalid-uuid-test' };
      
      // Add required parameters for each tool
      if (toolName.includes('category')) {
        testArgs.categoryName = 'Test';
      } else if (toolName.includes('payee')) {
        testArgs.payeeName = 'Test';
      }
      
      const response = await makeRequest('tools/call', {
        name: toolName,
        arguments: testArgs,
      });
      
      if (response.result?.content?.[0]?.text) {
        const result = JSON.parse(response.result.content[0].text);
        if (result.error && result.error.includes('not found')) {
          console.log(`   ✅ ${toolName}: validation working`);
        } else {
          console.log(`   ❌ ${toolName}: missing validation`);
        }
      }
    }
    
    console.log('\n✅ All tests completed!');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    process.exit(1);
  }
}

runTests();
