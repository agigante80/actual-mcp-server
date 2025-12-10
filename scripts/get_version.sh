#!/bin/bash
set -e

# Dynamic versioning script for actual-mcp-server
# Inspired by VPNSentinel's versioning approach
# 
# Version format:
# - main branch with tag: "1.0.0"
# - main branch no tag: "0.1.0-main-{commit}"
# - develop branch: "0.1.0-dev-{commit}"
# - feature branches: "0.1.0-{branch}-{commit}"

# Get the base version from package.json
BASE_VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "0.1.0")

# Get current branch name
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")

# Get short commit hash
COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")

# Check if we're on a tagged commit
TAG=$(git describe --exact-match --tags 2>/dev/null || echo "")

# Determine version based on context
if [ "$BRANCH" = "main" ] && [ -n "$TAG" ]; then
    # Main branch with a tag - use clean tag version
    VERSION="$TAG"
elif [ "$BRANCH" = "main" ]; then
    # Main branch without tag
    VERSION="${BASE_VERSION}-main-${COMMIT}"
elif [ "$BRANCH" = "develop" ]; then
    # Develop branch - append -dev-{commit}
    VERSION="${BASE_VERSION}-dev-${COMMIT}"
else
    # Feature or other branches - sanitize branch name
    SANITIZED_BRANCH=$(echo "$BRANCH" | sed 's/[^a-zA-Z0-9._-]/-/g')
    VERSION="${BASE_VERSION}-${SANITIZED_BRANCH}-${COMMIT}"
fi

# Output the version
echo "$VERSION"
