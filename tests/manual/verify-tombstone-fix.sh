#!/bin/bash
# Verification script to check accounts with tombstone=0

echo "═══════════════════════════════════════════════════════════"
echo "Checking accounts with tombstone=0 (should be visible in UI)"
echo "═══════════════════════════════════════════════════════════"
echo ""

sqlite3 /home/alien/dev/actual-mcp-server/test-actual-data/_test-budget/db.sqlite <<EOF
.mode column
.headers on
SELECT id, name, tombstone, offbudget, closed 
FROM accounts 
WHERE tombstone=0 
ORDER BY name;
EOF

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "Summary:"
echo "═══════════════════════════════════════════════════════════"

TOTAL=$(sqlite3 /home/alien/dev/actual-mcp-server/test-actual-data/_test-budget/db.sqlite "SELECT COUNT(*) FROM accounts WHERE tombstone=0;")
TEST_ACCOUNTS=$(sqlite3 /home/alien/dev/actual-mcp-server/test-actual-data/_test-budget/db.sqlite "SELECT COUNT(*) FROM accounts WHERE tombstone=0 AND (name LIKE 'MCP-Test%' OR name LIKE 'Session-Test%');")

echo "Total accounts with tombstone=0: $TOTAL"
echo "Test accounts with tombstone=0: $TEST_ACCOUNTS"
echo ""
echo "✅ These accounts should be VISIBLE in Actual Budget UI"
echo "   Open: http://localhost:5006"
echo ""
echo "Recent test accounts:"
sqlite3 /home/alien/dev/actual-mcp-server/test-actual-data/_test-budget/db.sqlite "SELECT name FROM accounts WHERE tombstone=0 AND (name LIKE 'MCP-Test%' OR name LIKE 'Session-Test%') ORDER BY name DESC LIMIT 5;"
