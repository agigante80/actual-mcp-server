#!/bin/bash

# Helper script to monitor Actual Budget Docker logs for budget creation
# This helps capture the sync ID when a budget is created

echo "🔍 Monitoring Actual Budget Docker logs for budget creation..."
echo "💡 Create a budget in the web interface now: http://localhost:5007"
echo "⏳ Watching for budget sync IDs..."
echo ""

# Monitor docker logs for budget-related activity
docker logs -f actual-test-server 2>&1 | while read line; do
    echo "$(date '+%H:%M:%S') $line"
    
    # Look for budget creation patterns
    if echo "$line" | grep -q -E "(sync|budget|file|id)"; then
        echo "🎯 Possible budget activity detected!"
    fi
    
    # Look for specific patterns that might contain sync IDs
    if echo "$line" | grep -q -E "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}"; then
        UUID=$(echo "$line" | grep -oE "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}")
        echo "📋 Found UUID: $UUID"
    fi
done