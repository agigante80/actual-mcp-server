# CI/CD Pipeline Documentation

## Overview

This repository uses a comprehensive GitHub Actions workflow (`.github/workflows/ci-cd.yml`) that implements a modern, production-grade CI/CD pipeline tailored for the Node.js/TypeScript MCP server project.

## Pipeline Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      TRIGGER (Push/PR)                       │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  JOB 1: LINT & TYPE CHECK                                   │
│  - TypeScript compilation                                    │
│  - Coverage check                                            │
│  - npm audit                                                 │
└─────────────────────────┬───────────────────────────────────┘
                          │
              ┌───────────┴───────────┐
              ▼                       ▼
┌─────────────────────────┐ ┌─────────────────────────┐
│  JOB 2: TEST SUITE      │ │  JOB 3: E2E TESTS       │
│  - Unit tests           │ │  - Playwright tests     │
│  - Adapter tests        │ │  - Browser automation   │
│  - Smoke tests          │ │                         │
└─────────────┬───────────┘ └───────────┬─────────────┘
              │                         │
              └───────────┬─────────────┘
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  JOB 4: BUILD ARTIFACTS                                      │
│  - Production build                                          │
│  - Version generation                                        │
│  - Artifact upload                                           │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  JOB 5: DOCKER BUILD & PUSH (Push only)                     │
│  - Multi-platform build (amd64, arm64)                      │
│  - Vulnerability scanning (Trivy)                            │
│  - Push to Docker Hub                                        │
│  - Tag: latest-<sha>, development-<sha>                     │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  JOB 6: RELEASE & DOCKER HUB UPDATE (Main only)             │
│  - Auto-bump version (semantic)                             │
│  - Generate changelog                                        │
│  - Create GitHub release                                     │
│  - Update Docker Hub descriptions                            │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  JOB 7: PIPELINE SUMMARY                                     │
│  - Generate markdown summary                                 │
│  - Show all artifacts and links                              │
└─────────────────────────────────────────────────────────────┘
```

## Features

### 🔧 Technology Auto-Detection

The workflow is specifically tailored for this Node.js 20 + TypeScript project:
- Uses `npm ci` for consistent dependency installation
- Runs TypeScript compilation via `npm run build`
- Executes project-specific test commands (`test:adapter`, `test:unit-js`, `test:e2e`)
- Leverages existing `package.json` scripts

### 🏗️ Pipeline Stages

#### 1. **Lint & Type Check**
- TypeScript compilation check
- Coverage analysis (37 tools, 76% API coverage)
- Dependency vulnerability scanning (npm audit)
- Non-blocking - allows pipeline to continue

#### 2. **Test Suite**
- Adapter unit tests with live Actual API
- Unit smoke tests
- Generated tools smoke tests
- Test results uploaded as artifacts (30-day retention)

#### 3. **E2E Tests** (Parallel with Test Suite)
- Playwright end-to-end tests
- Browser automation testing
- HTML report generation
- Report uploaded as artifact

#### 4. **Build Artifacts**
- Production TypeScript compilation
- Version extraction from `package.json`
- Git commit SHA extraction
- Build artifacts uploaded for downstream jobs

#### 5. **Docker Build & Push** (Push events only)
- Multi-platform builds (linux/amd64, linux/arm64)
- Pre-build filesystem vulnerability scan
- Post-build Docker image scan
- Smart tagging based on branch:
  - `main` → `latest` and `latest-<short_sha>`
  - `develop` → `development` and `development-<short_sha>`
- Layer caching for faster builds

#### 6. **Release & Docker Hub Update** (Main branch only)
- Automatic semantic version bumping (patch level)
- Changelog generation from git commits
- GitHub release creation with:
  - Docker image tags
  - Changelog
  - Links to Docker Hub and documentation
- Docker Hub description update:
  - Short description from `docker/description/short.md`
  - Long description from `docker/description/long.md`
  - Auto-adds GitHub repository link if missing

#### 7. **Pipeline Summary**
- Comprehensive markdown summary in GitHub Actions UI
- Build information (version, commit, branch)
- Docker image tags
- Links to Docker Hub, releases, repository
- Coverage statistics

### 🔒 Security Features

1. **Vulnerability Scanning**
   - Trivy filesystem scan (pre-build)
   - Trivy Docker image scan (post-build)
   - npm audit for dependencies
   - SARIF upload for GitHub Security tab

2. **Secrets Management**
   - Docker Hub credentials via GitHub Secrets
   - No secrets exposed in logs
   - Automatic GitHub token handling

3. **Container Security**
   - Non-root user in Dockerfile
   - Multi-stage builds for minimal attack surface
   - Regular base image updates (node:20-alpine)

### ⚡ Performance Optimizations

1. **Caching**
   - npm dependencies cached via `actions/setup-node`
   - Docker layers cached via GitHub Actions cache
   - Cache invalidation on dependency changes

2. **Parallelization**
   - Test suite and E2E tests run in parallel
   - Multi-platform Docker builds use buildx

3. **Artifact Reuse**
   - Build artifacts shared between jobs
   - Test results preserved for debugging

### 📊 Monitoring & Observability

- Test results uploaded and viewable in Actions UI
- Playwright HTML reports for E2E failures
- Vulnerability scan results in Security tab
- Comprehensive step-by-step logging
- Pipeline summary with all key information

## Required GitHub Secrets

Configure these in **Settings → Secrets and variables → Actions**:

| Secret | Description | Required For |
|--------|-------------|--------------|
| `DOCKERHUB_USER` | Docker Hub username | All Docker Hub operations |
| `DOCKERHUB_TOKEN` | Docker Hub access token | Docker login, push, and API calls |
| `GITHUB_TOKEN` | Auto-provided by GitHub | Release creation (automatic) |

**Note:** `DOCKERHUB_TOKEN` is used for all Docker Hub operations including Docker login, image push, and API calls to update repository descriptions. The token must have read/write permissions.

## Tagging Strategy

### Main Branch (`main`)
- **Purpose**: Production releases
- **Docker Tags**:
  - `latest` - Always points to latest main build
  - `latest-<short_sha>` - Specific commit reference
- **Actions**: Creates GitHub release, updates Docker Hub descriptions

### Develop Branch (`develop`)
- **Purpose**: Pre-release testing
- **Docker Tags**:
  - `development` - Latest develop build
  - `development-<short_sha>` - Specific commit reference
- **Actions**: Docker build and push only (no release)

### Pull Requests
- **Purpose**: Validation before merge
- **Actions**: Lint, test, E2E, build (no Docker push or release)

## Version Management

### Automatic Version Bumping

The workflow automatically bumps the patch version on `main` branch pushes:

```
v0.1.0 → v0.1.1 → v0.1.2 → ...
```

**Manual Version Bumping** (for major/minor):

```bash
# Update package.json version
npm version minor  # or major
git push origin main --tags
```

### Changelog Generation

Automatically generated from git commits since last tag:

```
- feat: add new tool (abc123)
- fix: correct adapter error handling (def456)
- docs: update README (ghi789)
```

## Docker Hub Description Management

### Short Description
Location: `docker/description/short.md`
- Max 100 characters
- Shown in Docker Hub search results
- Auto-updated on `main` branch pushes

### Long Description
Location: `docker/description/long.md`
- Full markdown README for Docker Hub
- Includes features, quick start, configuration
- GitHub repo link auto-added if missing
- Auto-updated on `main` branch pushes

## Testing Locally

### Using Act (GitHub Actions Local Runner)

```bash
# Install act
brew install act  # macOS
# or
curl https://raw.githubusercontent.com/nektos/act/master/install.sh | sudo bash

# Run specific job
act -j lint
act -j test
act -j build

# Run full workflow
act push
```

### Manual Testing

```bash
# Lint and type check
npm ci
npm run build
npm run check:coverage
npm audit

# Run tests
npm run test:adapter
npm run test:unit-js
npm run test:e2e

# Build Docker image
docker build -t actual-mcp-server:test .
```

## Troubleshooting

### Build Failures

**Symptom**: TypeScript compilation errors
```bash
# Solution: Check types locally
npm run build
npx tsc --noEmit
```

**Symptom**: Test failures
```bash
# Solution: Run tests locally
npm run test:adapter
npm run test:e2e
```

### Docker Push Failures

**Symptom**: Docker push authentication error
- Verify `DOCKERHUB_USER` and `DOCKERHUB_TOKEN` secrets are set correctly
- Check Docker Hub token has push permissions
- Ensure repository exists on Docker Hub

**Symptom**: Docker Hub description update fails
- Verify token has read/write permissions (not just push)
- Description updates use Docker Hub API v2 with JWT authentication
- Non-blocking: Pipeline continues if description update fails
- Alternative: Update descriptions manually on Docker Hub

**Symptom**: Image too large
- Review Dockerfile for unnecessary files
- Use `.dockerignore` to exclude build artifacts
- Consider multi-stage build optimizations

### Release Failures

**Symptom**: Tag already exists
```bash
# Solution: Delete remote tag if needed
git push --delete origin v0.1.1
```

**Symptom**: Changelog empty
- Ensure commits exist since last tag
- Check git fetch depth in workflow

## Workflow Customization

### Change Version Bump Strategy

Edit `.github/workflows/ci-cd.yml`, line ~357:

```yaml
# Current: Bump patch
PATCH=$((PATCH + 1))
NEW_VERSION="v${MAJOR}.${MINOR}.${PATCH}"

# For minor bumps:
MINOR=$((MINOR + 1))
PATCH=0
NEW_VERSION="v${MAJOR}.${MINOR}.${PATCH}"
```

### Add Additional Platforms

Edit Docker build step:

```yaml
platforms: linux/amd64,linux/arm64,linux/arm/v7
```

### Change Test Timeout

Add to test steps:

```yaml
- name: 🧪 Run tests
  run: npm run test:adapter
  timeout-minutes: 10  # Default: 360
```

### Add Slack Notifications

Add to end of release job:

```yaml
- name: 📢 Notify Slack
  uses: slackapi/slack-github-action@v1
  with:
    webhook-url: ${{ secrets.SLACK_WEBHOOK }}
    payload: |
      {
        "text": "✅ Release ${{ steps.bump_version.outputs.new_version }} deployed!"
      }
```

## Performance Metrics

Typical pipeline execution times:

| Job | Duration | Can Fail |
|-----|----------|----------|
| Lint | ~2-3 min | Yes |
| Test | ~4-5 min | Yes |
| E2E | ~3-4 min | Yes |
| Build | ~2-3 min | Yes |
| Docker | ~8-12 min | Yes |
| Release | ~1-2 min | No (main only) |
| **Total** | ~15-20 min | - |

## Best Practices

1. **Always run tests locally before pushing**
   ```bash
   npm run build && npm run test:adapter && npm run test:e2e
   ```

2. **Use conventional commit messages**
   ```
   feat: add new tool
   fix: correct bug in adapter
   docs: update README
   chore: update dependencies
   ```

3. **Review Docker Hub descriptions before release**
   - Check `docker/description/short.md` (max 100 chars)
   - Preview `docker/description/long.md` rendering

4. **Monitor pipeline execution**
   - Check Actions tab after each push
   - Review test reports for flaky tests
   - Monitor vulnerability scan results

5. **Keep dependencies updated**
   ```bash
   npm update
   npm audit fix
   ```

## Migration from Existing CI

If you have an existing `.github/workflows/ci.yml`:

1. **Backup existing workflow**
   ```bash
   cp .github/workflows/ci.yml .github/workflows/ci.yml.backup
   ```

2. **Rename or remove old workflow**
   ```bash
   git rm .github/workflows/ci.yml
   ```

3. **The new workflow replaces it completely** - includes all functionality plus:
   - Docker build and push
   - Automatic releases
   - Docker Hub description updates
   - Enhanced security scanning
   - Better caching and performance

## Support & Maintenance

- **Workflow Issues**: Check GitHub Actions documentation
- **Docker Issues**: Review Docker Hub status page
- **Test Failures**: See test reports in Actions artifacts
- **Security Alerts**: Check Security tab for vulnerability reports

---

**Created**: 2025-11-09  
**Last Updated**: 2025-11-09  
**Workflow Version**: 1.0.0
