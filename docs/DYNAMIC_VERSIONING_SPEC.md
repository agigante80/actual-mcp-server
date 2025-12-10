# Dynamic Versioning System - Requirements & Specification

## Overview

A Git-based dynamic versioning system that generates context-aware version strings based on branch, tags, and commits. This eliminates hardcoded versions and provides rich debugging information in production.

---

## Requirements

### Functional Requirements

1. **Version Generation**
   - Must generate version string from Git context at build time
   - Must include commit hash for non-tagged builds
   - Must differentiate between branches (main, develop, feature)
   - Must support semantic versioning tags (e.g., v1.0.0)

2. **Build Integration**
   - Must inject version during Docker/container build process
   - Must work in CI/CD pipelines (GitHub Actions, GitLab CI, etc.)
   - Must be available as environment variable at runtime

3. **Local Development**
   - Must work in local development without Docker
   - Must fall back to package.json version when Git unavailable
   - Must not require Git in production containers

4. **Display**
   - Must be visible in application logs at startup
   - Should be accessible via API/health endpoint
   - Should appear in Docker image labels

### Non-Functional Requirements

1. **Performance**: Version generation should complete in <1 second
2. **Reliability**: Must handle missing Git context gracefully
3. **Portability**: Must work on Linux, macOS, Windows (WSL/Git Bash)
4. **Maintainability**: Should be a single, simple script
5. **Security**: Must not expose sensitive information in version string

---

## Specification

### Version Format

```
<base_version>-<context>-<commit>
```

**Examples:**
- Main branch with tag: `1.0.0`
- Main branch, no tag: `0.1.0-main-71f02b6`
- Develop branch: `0.1.0-dev-71f02b6`
- Feature branch: `0.1.0-feature-auth-71f02b6`
- No Git context: `0.1.0` (fallback)

### Version Components

| Component | Description | Required | Example |
|-----------|-------------|----------|---------|
| `base_version` | Semantic version from package.json/base file | Yes | `0.1.0` |
| `context` | Branch identifier (main, dev, branch-name) | Optional | `dev` |
| `commit` | Short Git commit hash (7 chars) | Optional | `71f02b6` |

### Branch-Specific Behavior

| Branch Type | Condition | Version Format | Example |
|-------------|-----------|----------------|---------|
| **Main/Master** | Tagged commit | `{tag}` | `1.0.0` |
| **Main/Master** | Untagged | `{version}-main-{commit}` | `0.1.0-main-abc1234` |
| **Develop** | Any commit | `{version}-dev-{commit}` | `0.1.0-dev-71f02b6` |
| **Feature Branch** | Any commit | `{version}-{sanitized-branch}-{commit}` | `0.1.0-feature-auth-71f02b6` |
| **No Git** | Fallback | `{version}` | `0.1.0` |

---

## Implementation Guide

### File Structure

```
project-root/
├── get_version.sh          # Version generation script
├── Dockerfile              # Docker build with VERSION arg
├── package.json            # Base version source (Node.js)
├── .github/workflows/
│   └── ci-cd.yml          # CI/CD using get_version.sh
└── src/
    └── index.ts           # Application using VERSION env var
```

### 1. Version Generation Script

### Script Implementation

**File:** `scripts/get_version.sh`

**Requirements:**
- Bash script (portable across Linux/macOS/WSL)
- Reads base version from `package.json` (or similar)
- Uses Git commands to determine context
- Outputs single version string to stdout
- Exits cleanly with error code on failure

**Key Git Commands:**
```bash
# Get current branch
git rev-parse --abbrev-ref HEAD

# Get short commit hash
git rev-parse --short HEAD

# Get exact tag (if on tagged commit)
git describe --exact-match --tags

# Sanitize branch name for version string
echo "$BRANCH" | sed 's/[^a-zA-Z0-9._-]/-/g'
```

**Script Template:**
```bash
#!/bin/bash
set -e

# Get base version from package.json (Node.js example)
BASE_VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "0.1.0")

# Get Git context
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
TAG=$(git describe --exact-match --tags 2>/dev/null || echo "")

# Determine version based on context
if [ "$BRANCH" = "main" ] && [ -n "$TAG" ]; then
    VERSION="$TAG"
elif [ "$BRANCH" = "main" ]; then
    VERSION="${BASE_VERSION}-main-${COMMIT}"
elif [ "$BRANCH" = "develop" ]; then
    VERSION="${BASE_VERSION}-dev-${COMMIT}"
else
    SANITIZED_BRANCH=$(echo "$BRANCH" | sed 's/[^a-zA-Z0-9._-]/-/g')
    VERSION="${BASE_VERSION}-${SANITIZED_BRANCH}-${COMMIT}"
fi

echo "$VERSION"
```

**Permissions:**
```bash
chmod +x get_version.sh
```

### 2. Dockerfile Integration

**Requirements:**
- Accept `VERSION` as build argument
- Set `VERSION` as environment variable
- Default to "unknown" if not provided

**Implementation:**
```dockerfile
FROM node:20-alpine AS runtime
WORKDIR /app

# Accept VERSION as build argument and set as environment variable
ARG VERSION=unknown
ENV VERSION=${VERSION}

# ... rest of Dockerfile
```

**Build Command:**
```bash
# Local build
docker build --build-arg VERSION=$(bash get_version.sh) -t myapp:latest .

# CI/CD build
VERSION=$(bash get_version.sh)
docker build --build-arg VERSION=${VERSION} -t myapp:${VERSION} .
```

### 3. CI/CD Integration

**Requirements:**
- Run `get_version.sh` during build job
- Pass version to Docker build
- Tag Docker images with version
- Store version as job output for downstream jobs

**GitHub Actions Example:**
```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    outputs:
      version: ${{ steps.version.outputs.version }}
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 0  # Required for Git history

      - name: Generate version info
        id: version
        run: |
          chmod +x get_version.sh
          VERSION=$(bash get_version.sh)
          echo "version=$VERSION" >> $GITHUB_OUTPUT
          echo "📦 Version: $VERSION"

  docker:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - name: Build and push Docker image
        uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags: myapp:${{ needs.build.outputs.version }}
          build-args: |
            VERSION=${{ needs.build.outputs.version }}
```

**GitLab CI Example:**
```yaml
variables:
  VERSION: ""

before_script:
  - chmod +x get_version.sh
  - export VERSION=$(bash get_version.sh)
  - echo "Building version $VERSION"

build:
  script:
    - docker build --build-arg VERSION=$VERSION -t myapp:$VERSION .
```

### 4. Application Integration

**Requirements:**
- Read version from environment variable at runtime
- Fall back to package.json if env var not set
- Display version in logs at startup
- Expose version via health/info endpoint

**Node.js/TypeScript Example:**
```typescript
// Load version from environment (Docker) or package.json (local)
let VERSION = process.env.VERSION;
if (!VERSION || VERSION === 'unknown') {
  const packageJson = await import('../package.json', { with: { type: 'json' } });
  VERSION = packageJson.default.version;
}

// Display at startup
console.log(`🚀 Starting Application v${VERSION}`);

// Expose in health endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: VERSION,
    timestamp: new Date().toISOString()
  });
});
```

**Python Example:**
```python
import os
import json

# Load version
VERSION = os.environ.get('VERSION')
if not VERSION or VERSION == 'unknown':
    with open('package.json') as f:
        VERSION = json.load(f)['version']

print(f"🚀 Starting Application v{VERSION}")
```

**Go Example:**
```go
var VERSION = os.Getenv("VERSION")

func init() {
    if VERSION == "" || VERSION == "unknown" {
        VERSION = "0.1.0" // Default/fallback
    }
}

func main() {
    log.Printf("🚀 Starting Application v%s", VERSION)
}
```

### 5. Docker Image Labels

**Requirements:**
- Include version in OCI image labels
- Follow OpenContainer specification
- Enable version inspection without running container

**Implementation:**
```yaml
# In CI/CD (GitHub Actions example)
- name: Generate Docker metadata
  id: meta
  uses: docker/metadata-action@v5
  with:
    images: myapp
    labels: |
      org.opencontainers.image.version=${{ needs.build.outputs.version }}
      org.opencontainers.image.revision=${{ github.sha }}
      org.opencontainers.image.created=${{ steps.date.outputs.date }}

- name: Build Docker image
  uses: docker/build-push-action@v5
  with:
    labels: ${{ steps.meta.outputs.labels }}
```

**Inspection:**
```bash
docker inspect myapp:latest | jq '.[0].Config.Labels'
```

---

## Verification & Testing

### Local Testing

```bash
# Test version script
./get_version.sh
# Expected: 0.1.0-dev-71f02b6

# Test Docker build
docker build --build-arg VERSION=$(./get_version.sh) -t myapp:test .

# Test runtime version
docker run --rm myapp:test
# Expected log: "🚀 Starting Application v0.1.0-dev-71f02b6"

# Verify environment variable
docker run --rm myapp:test env | grep VERSION
# Expected: VERSION=0.1.0-dev-71f02b6
```

### CI/CD Testing

```bash
# Check version generation in CI logs
# Should see: "📦 Version: 0.1.0-dev-71f02b6"

# Check Docker image tags
docker images | grep myapp
# Should see: myapp:0.1.0-dev-71f02b6

# Check image labels
docker inspect myapp:latest | jq '.[0].Config.Labels."org.opencontainers.image.version"'
# Should return: "0.1.0-dev-71f02b6"
```

### Production Verification

```bash
# Check running container logs
docker logs myapp
# Should see: "🚀 Starting Application v0.1.0-dev-71f02b6"

# Check health endpoint
curl http://localhost/health
# Should return: {"status":"ok","version":"0.1.0-dev-71f02b6"}

# Check environment
docker exec myapp env | grep VERSION
# Should show: VERSION=0.1.0-dev-71f02b6
```

---

## Edge Cases & Handling

### No Git Repository

**Scenario:** Building outside Git context (exported archive)

**Handling:**
```bash
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
if [ "$BRANCH" = "unknown" ]; then
    VERSION="$BASE_VERSION"
    echo "$VERSION"
    exit 0
fi
```

**Result:** Falls back to base version from package.json

### Detached HEAD State

**Scenario:** CI/CD checkout creates detached HEAD

**Handling:**
```bash
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
if [ "$BRANCH" = "HEAD" ]; then
    # Try to get branch from CI environment variable
    BRANCH=${GITHUB_REF_NAME:-${CI_COMMIT_BRANCH:-"unknown"}}
fi
```

**Result:** Uses CI environment variables as fallback

### Shallow Clone

**Scenario:** CI uses `fetch-depth: 1` (shallow clone)

**Handling:**
```yaml
# In CI/CD workflow
- name: Checkout repository
  uses: actions/checkout@v4
  with:
    fetch-depth: 0  # Full history required for tags
```

**Result:** Ensures tags are available for version detection

### Dirty Working Tree

**Scenario:** Uncommitted changes in development

**Handling:**
```bash
# Optional: Add -dirty suffix for uncommitted changes
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    VERSION="${VERSION}-dirty"
fi
```

**Result:** Distinguishes between clean and dirty builds

### Special Characters in Branch Names

**Scenario:** Branch name with slashes (e.g., `feature/user-auth`)

**Handling:**
```bash
SANITIZED_BRANCH=$(echo "$BRANCH" | sed 's/[^a-zA-Z0-9._-]/-/g')
VERSION="${BASE_VERSION}-${SANITIZED_BRANCH}-${COMMIT}"
```

**Result:** `0.1.0-feature-user-auth-71f02b6`

---

## Migration Guide

### From Static Version

**Before:**
```dockerfile
ENV VERSION=0.1.0
```

**After:**
```dockerfile
ARG VERSION=unknown
ENV VERSION=${VERSION}
```

**Build Change:**
```bash
# Old
docker build -t myapp:latest .

# New
docker build --build-arg VERSION=$(bash get_version.sh) -t myapp:latest .
```

### From Manual Versioning

**Before:**
```yaml
# CI/CD manually setting version
env:
  VERSION: 0.1.0
```

**After:**
```yaml
# CI/CD using get_version.sh
- name: Generate version
  run: |
    VERSION=$(bash get_version.sh)
    echo "VERSION=$VERSION" >> $GITHUB_ENV
```

---

## Best Practices

### ✅ DO

1. **Always fetch full Git history in CI/CD**
   ```yaml
   - uses: actions/checkout@v4
     with:
       fetch-depth: 0
   ```

2. **Make script executable in repository**
   ```bash
   chmod +x get_version.sh
   git add get_version.sh
   ```

3. **Handle missing Git gracefully**
   ```bash
   BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
   ```

4. **Use semantic versioning for tags**
   ```bash
   git tag v1.0.0
   git tag v1.0.1
   ```

5. **Display version prominently at startup**
   ```typescript
   console.log(`🚀 Starting Application v${VERSION}`);
   ```

6. **Include version in Docker labels**
   ```dockerfile
   LABEL org.opencontainers.image.version="${VERSION}"
   ```

### ❌ DON'T

1. **Don't hardcode versions in Dockerfile**
   ```dockerfile
   # ❌ Bad
   ENV VERSION=0.1.0
   ```

2. **Don't rely on Git in production containers**
   ```dockerfile
   # ❌ Bad - Git not needed in runtime
   RUN apk add git
   ```

3. **Don't expose sensitive information in version**
   ```bash
   # ❌ Bad - includes private branch names
   VERSION="company-secret-project-auth"
   ```

4. **Don't use long commit hashes**
   ```bash
   # ❌ Bad
   git rev-parse HEAD  # Full 40-char hash
   
   # ✅ Good
   git rev-parse --short HEAD  # 7-char hash
   ```

5. **Don't fail builds on version generation errors**
   ```bash
   # ❌ Bad
   set -e
   VERSION=$(git rev-parse --short HEAD)  # Fails if no Git
   
   # ✅ Good
   VERSION=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
   ```

---

## Language-Specific Adaptations

### Python Projects

**Base version from setup.py or pyproject.toml:**
```bash
BASE_VERSION=$(python -c "import tomli; print(tomli.load(open('pyproject.toml', 'rb'))['project']['version'])")
```

### Go Projects

**Base version from version.go:**
```bash
BASE_VERSION=$(grep 'const Version' version.go | cut -d'"' -f2)
```

### Java/Maven Projects

**Base version from pom.xml:**
```bash
BASE_VERSION=$(mvn help:evaluate -Dexpression=project.version -q -DforceStdout)
```

### Rust Projects

**Base version from Cargo.toml:**
```bash
BASE_VERSION=$(cargo metadata --no-deps --format-version 1 | jq -r '.packages[0].version')
```

---

## Troubleshooting

### Issue: Version shows "unknown-unknown"

**Cause:** Git not available or not a Git repository

**Solution:**
```bash
# Check if Git is installed
git --version

# Check if directory is a Git repo
git status

# Initialize Git if needed
git init
```

### Issue: CI shows "v0.1.0" instead of "v0.1.0-dev-abc1234"

**Cause:** Shallow clone missing commit hash

**Solution:**
```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0  # Must be 0 for full history
```

### Issue: Docker build fails with "get_version.sh: not found"

**Cause:** Script not copied to Docker context

**Solution:**
```dockerfile
# Ensure script is in build context
COPY get_version.sh ./
RUN chmod +x get_version.sh
```

Or build outside Docker:
```bash
docker build --build-arg VERSION=$(bash get_version.sh) .
```

### Issue: Version not updating in running container

**Cause:** Environment variable set at build time, not updated

**Solution:** Rebuild container with new VERSION:
```bash
docker build --build-arg VERSION=$(bash get_version.sh) -t myapp:latest .
docker stop myapp
docker rm myapp
docker run -d myapp:latest
```

---

## Security Considerations

1. **Branch Name Sanitization**: Always sanitize branch names to prevent injection
   ```bash
   SANITIZED_BRANCH=$(echo "$BRANCH" | sed 's/[^a-zA-Z0-9._-]/-/g')
   ```

2. **No Secrets in Version**: Never include tokens, passwords, or API keys
   ```bash
   # ❌ Bad
   VERSION="api-key-abc123-${COMMIT}"
   ```

3. **Read-Only Script**: Mark as read-only in repository
   ```bash
   chmod 555 get_version.sh
   ```

4. **CI/CD Environment**: Use dedicated CI environment variables
   ```yaml
   env:
     GITHUB_REF_NAME: ${{ github.ref_name }}  # Safe branch name
   ```

---

## Complete Checklist

Use this checklist when implementing in a new project:

- [ ] Create `get_version.sh` script
- [ ] Make script executable (`chmod +x get_version.sh`)
- [ ] Test script locally (`./get_version.sh`)
- [ ] Update Dockerfile with `ARG VERSION` and `ENV VERSION`
- [ ] Update application code to read `VERSION` env var
- [ ] Add fallback to package.json/base version file
- [ ] Update CI/CD workflow to run `get_version.sh`
- [ ] Pass VERSION to Docker build as `--build-arg`
- [ ] Add VERSION to Docker image labels
- [ ] Display version in application logs at startup
- [ ] Expose version in health/info endpoint
- [ ] Test local Docker build with VERSION arg
- [ ] Test CI/CD build and verify version in logs
- [ ] Test production deployment and check version
- [ ] Update documentation with version format
- [ ] Add version to README badges/shields

---

## Summary

**Minimum Required Files:**
1. `get_version.sh` - Generates version from Git context
2. `Dockerfile` - Accepts and uses VERSION build arg
3. Application code - Reads VERSION from environment

**Key Benefits:**
- ✅ Automatic version generation based on Git state
- ✅ Rich debugging information with commit hashes
- ✅ No manual version updates required
- ✅ Works seamlessly in CI/CD pipelines
- ✅ Falls back gracefully when Git unavailable

**Expected Output:**
- Main tagged: `1.0.0`
- Main untagged: `0.1.0-main-71f02b6`
- Develop: `0.1.0-dev-71f02b6`
- Feature: `0.1.0-feature-auth-71f02b6`

This system provides production-grade version tracking with minimal overhead and maximum visibility.
