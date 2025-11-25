import fetch from 'node-fetch';

const MCP_URL = "http://localhost:3600/http";
const token = "Bearer 9381d5ca23f3746fdbcd2a9438ebe4cf";
let sessionId;

async function call(method, params) {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      "Authorization": token,
      ...(sessionId ? { "mcp-session-id": sessionId } : {})
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params })
  });
  
  if (!sessionId) sessionId = res.headers.get('mcp-session-id');
  return await res.json();
}

// Initialize
await call("initialize", {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "test", version: "1.0" }
});

// List tools
const result = await call("tools/list", {});
const tools = result.result.tools;

console.log(`Total tools: ${tools.length}\n`);
console.log("All available tools:");
tools.forEach((tool, i) => {
  console.log(`${(i+1).toString().padStart(2, '0')}. ${tool.name}`);
});

// Group by category
const categories = {
  accounts: [],
  budgets: [],
  categories: [],
  category_groups: [],
  payees: [],
  payee_rules: [],
  transactions: [],
  rules: [],
  bank_sync: [],
  query: []
};

tools.forEach(tool => {
  const name = tool.name.replace('actual_', '');
  if (name.startsWith('accounts_')) categories.accounts.push(tool.name);
  else if (name.startsWith('budgets_')) categories.budgets.push(tool.name);
  else if (name.startsWith('categories_')) categories.categories.push(tool.name);
  else if (name.startsWith('category_groups_')) categories.category_groups.push(tool.name);
  else if (name.startsWith('payees_')) categories.payees.push(tool.name);
  else if (name.startsWith('payee_rules_')) categories.payee_rules.push(tool.name);
  else if (name.startsWith('transactions_')) categories.transactions.push(tool.name);
  else if (name.startsWith('rules_')) categories.rules.push(tool.name);
  else if (name.startsWith('bank_sync')) categories.bank_sync.push(tool.name);
  else if (name.startsWith('query_')) categories.query.push(tool.name);
  else if (name.startsWith('budget_')) categories.budgets.push(tool.name);
});

console.log("\n\nGrouped by category:");
for (const [cat, tools] of Object.entries(categories)) {
  if (tools.length > 0) {
    console.log(`\n${cat.toUpperCase()} (${tools.length}):`);
    tools.forEach(t => console.log(`  - ${t}`));
  }
}
