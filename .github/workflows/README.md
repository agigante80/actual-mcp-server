# GitHub Actions Workflows Documentation

## Overview

This directory contains 3 automated workflows that manage continuous integration, deployment, dependency updates, and releases for the Actual MCP Server project.

**Last Updated:** December 12, 2025  
**Total Workflows:** 3 (optimized from 5, now fully consolidated)  
**Total Lines:** ~1,082 lines (down from 1,359)  
**Key Improvements:** Multi-registry publishing, security scanning, deployment testing

## Recent Optimizations (Dec 12, 2025 - Phase 2)

### Major Improvements ✅
- ✅ **Tag-based triggers** - Workflow now triggers on `v*` tags for automated releases
- ✅ **Multi-registry publishing** - Publishes to Docker Hub AND GitHub Container Registry (GHCR)
- ✅ **Trivy security scanning** - Vulnerability scanning with SARIF upload to GitHub Security tab
- ✅ **Consolidated Docker jobs** - Single unified job handles all Docker publishing (was 3 separate jobs)
- ✅ **Deployment testing** - Tests published images from both registries
- ✅ **Docker Hub description updates** - Keeps metadata in sync automatically
- ✅ **Improved tagging strategy** - Semantic versions on both registries (`:0.2.0`, `:main`, `:latest`)

### Impact
- **Code reduction:** 1,359 → 1,082 lines (20% reduction)
- **Complexity reduction:** 3 Docker jobs → 1 consolidated job
- **New capabilities:** 5 major features added (security, GHCR, deployment testing, etc.)
- **Maintainability:** Single source of truth for Docker publishing
- **Security:** Automated vulnerability scanning with GitHub Security integration

---

## Active Workflows

### 1. CI/CD Pipeline (`ci-cd.yml`)

**Triggers:**  
- Push to main/develop/development branches
- Version tags (`v*`)  
- Pull Requests
- Manual (workflow_dispatch)

**Size:** 656 lines (25KB) - Down from 702 lines  
**Jobs:** 11 jobs total (optimized from 9 split jobs)

**Purpose:** Comprehensive build, test, security, and deployment pipeline

#### Job Flow:

```
┌─────────────────────────────────────────────────────────────┐
│  1. VERSION GENERATION                                       │
│  - Extract from VERSION file                                 │
│  - Generate Docker-safe version                              │
│  - Determine if stable release                               │
└─────────────────────────┬───────────────────────────────────┘
                          │
              ┌───────────┴───────────┐
              ↓                       ↓
┌─────────────────────────┐ ┌─────────────────────────┐
│  2. LINT & TYPE CHECK   │ │  3. RUN TESTS           │
│  - TypeScript           │ │  - Unit tests           │
│  - Tool coverage        │ │  - Adapter tests        │
└─────────────┬───────────┘ └───────────┬─────────────┘
              │                         │
              └───────────┬─────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│  4. BUILD APPLICATION                                        │
│  - Production build                                          │
│  - Dependencies installed                                    │
└─────────────────────────┬───────────────────────────────────┘
                          │
              ┌───────────┴───────────┐
              ↓                       ↓
┌─────────────────────────┐ ┌─────────────────────────┐
│  5. VALIDATE DOCKER     │ │  6. DOCKER TEST BUILD   │
│     DESCRIPTION         │ │  - Build test image     │
│  - Check length ≤100    │ │  - Startup validation   │
└─────────────────────────┘ └───────────┬─────────────┘
                                        │
                  ┌─────────────────────┴─────────────────────┐
                  ↓                                           ↓
┌─────────────────────────────────────┐ ┌─────────────────────────────────────┐
│  7. DOCKER PUBLISH (CONSOLIDATED)   │ │  8. SECURITY SCAN                   │
│  - Build multi-platform             │ │  - Trivy vulnerability scan         │
│  - Push to Docker Hub + GHCR        │ │  - SARIF upload to Security tab     │
│  - Semantic version tags            │ │  - Critical/High/Medium severity    │
└───────────┬─────────────────────────┘ └───────────┬─────────────────────────┘
            │                                       │
            └───────────┬───────────────────────────┘
                        ↓
      ┌─────────────────┴─────────────────┐
      ↓                                   ↓
┌─────────────────────────┐ ┌─────────────────────────┐
│  9. DOCKER HUB          │ │  10. DEPLOYMENT TEST    │
│     DESCRIPTION         │ │  - Pull from Docker Hub │
│  - Update metadata      │ │  - Pull from GHCR       │
│  - Sync README          │ │  - Test both images     │
└─────────────────────────┘ └───────────┬─────────────┘
                                        │
                                        ↓
                      ┌─────────────────────────────────────┐
                      │  11. CREATE GITHUB RELEASE          │
                      │  - Generate changelog               │
                      │  - Create release with notes        │
                      │  - Tag version                      │
                      └───────────┬─────────────────────────┘
                                  ↓
                      ┌─────────────────────────────────────┐
                      │  12. PIPELINE SUMMARY               │
                      │  - Status table                     │
                      │  - All job results                  │
                      └─────────────────────────────────────┘
```

#### Key Features:

**🏷️ Docker Tag Strategy** (NEW):
```bash
# Version tags (from VERSION file)
agigante80/actual-mcp-server:0.2.0
ghcr.io/agigante80/actual-mcp-server:0.2.0

# Branch tags
agigante80/actual-mcp-server:main          # main branch
agigante80/actual-mcp-server:develop       # develop branch
agigante80/actual-mcp-server:development   # development branch

# Latest tags (main branch + stable releases only)
agigante80/actual-mcp-server:latest
ghcr.io/agigante80/actual-mcp-server:latest
```

**🔒 Security Scanning** (NEW):
- Trivy vulnerability scanner
- SARIF format upload to GitHub Security tab
- Critical, High, and Medium severity tracking
- Automated on every build

**🧪 Deployment Testing** (NEW):
- Pulls published images from both registries
- Validates images actually work
- Tests node version execution
- Catches registry-specific issues

**📝 Docker Hub Updates** (NEW):
- Automatically updates short description (≤100 chars)
- Syncs long description from `docker/description/long.md`
- Runs on main branch and version tags only

**🏗️ Multi-Platform Builds** (IMPROVED):
- `linux/amd64` - Intel/AMD 64-bit
- `linux/arm64` - ARM 64-bit (Raspberry Pi, Apple Silicon, etc.)
- Single consolidated build job

**🎯 Tag-Based Triggers** (NEW):
- Workflow triggers on `v*` tags (e.g., `v0.2.0`)
- Enables automated release creation on tag push
- `is_release` flag for conditional logic

**Manual Workflow Options:**
- `skip_tests` - Skip test suite for emergency deployments
- `skip_docker_publish` - Skip Docker publishing
- `docker_tag_suffix` - Add custom suffix to tags

---

### 2. Auto-Update @actual-app/api (`actual-api-auto-update.yml`)

**Triggers:** Daily at 10:00 AM UTC, Manual  
**Size:** 214 lines (8.8KB)  
**Purpose:** Automatically update `@actual-app/api` dependency

**Process:**
1. ✅ Check for new @actual-app/api version
2. ✅ Install latest version if available
3. ✅ Build and test project
4. ✅ Auto-bump PATCH version (e.g., 0.2.0 → 0.2.1)
5. ✅ Commit to `develop` branch
6. ✅ Merge to `main` branch
7. ✅ Create git tag and GitHub release
8. ✅ Trigger Docker builds via ci-cd.yml
9. ✅ Create issue on failure

**Schedule:** Runs daily after Dependabot (9 AM)  
**Target Branch:** Always updates `develop` first, then merges to `main`  
**Release Creation:** Automatic with changelog and Docker image links

---

### 3. Dependency Management (`dependency-management.yml`)

**Triggers:** Weekly (Monday 9 AM UTC), Manual, package.json PRs  
**Size:** 212 lines (7KB)  
**Purpose:** Monitor and report on dependency health

**Jobs:**
1. **check-outdated** - List outdated packages with comparison table
2. **test-with-updates** - Test with latest compatible updates (manual only)
3. **dependency-review** - Security review on PRs (blocks GPL licenses)
4. **update-dependency-dashboard** - Generate comprehensive dependency report

**Dashboard Features:**
- 🔴 Security vulnerability counts (Critical, High, Moderate, Low)
- 📊 Outdated package table with update types
- 🎯 Recommendations for addressing issues

---

## Comparison with Actual-sync

### Features Adopted from Actual-sync ✅

1. **Tag-based triggers** - `on.push.tags: ['v*']`
2. **Multi-registry publishing** - Docker Hub + GHCR
3. **Trivy security scanning** - With SARIF upload
4. **Deployment testing** - Test published images
5. **Docker Hub description updates** - Automated metadata sync
6. **Consolidated Docker job** - Single unified publish job
7. **Semantic version tags** - Version-specific tags on both registries

### Features Kept from Original ✅

1. **Fully automated @actual-app/api updates** - Zero manual intervention
2. **Weekly dependency dashboards** - Comprehensive health monitoring
3. **TypeScript type checking** - Full compilation validation
4. **Tool coverage validation** - Verifies all 53 MCP tools registered
5. **VERSION file** - Single source of truth for versioning

---

## Workflow Statistics

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| **Total Workflows** | 5 | 3 | -40% |
| **Total Lines** | 1,359 | 1,082 | -20% |
| **CI/CD Lines** | 702 | 656 | -7% |
| **Docker Jobs** | 3 separate | 1 consolidated | -67% |
| **Registries** | 1 (Docker Hub) | 2 (Hub + GHCR) | +100% |
| **Security Scanning** | npm audit only | Trivy + npm audit | +100% |
| **Deployment Testing** | None | Both registries | NEW |
| **Tag Triggers** | No | Yes (`v*`) | NEW |

---

## Required Secrets

### GitHub Secrets Configuration

Add these secrets in **Settings → Secrets and variables → Actions**:

1. **DOCKERHUB_USER** - Your Docker Hub username
2. **DOCKERHUB_TOKEN** - Docker Hub Personal Access Token
   - Generate at: https://hub.docker.com/settings/security
   - Permissions: Read, Write, Delete
3. **GITHUB_TOKEN** - Automatically provided by GitHub Actions (no setup needed)

---

## Monitoring & Troubleshooting

### Check Workflow Status

```bash
# View all workflow runs
gh run list --workflow=ci-cd.yml

# View specific run details
gh run view <run-id>

# Watch live workflow
gh run watch <run-id>
```

### Common Issues

**Issue: Trivy scan fails**  
**Solution:** This is non-blocking. Check Security tab for details. Common in development branches.

**Issue: Docker Hub description update fails**  
**Solution:** Verify `DOCKERHUB_TOKEN` has write permissions. This is non-blocking.

**Issue: GHCR push fails**  
**Solution:** Ensure `packages: write` permission is set in workflow. Check GitHub token permissions.

**Issue: Deployment test fails**  
**Solution:** Images may still be propagating. Retry workflow after 5 minutes.

---

## Next Steps

### Recommended Enhancements (Future)

1. **Automated changelog generation** - Use conventional commits
2. **Release notes enhancement** - Include feature highlights
3. **Performance benchmarking** - Track build times over releases
4. **Artifact caching** - Speed up dependency installation
5. **Parallel E2E tests** - Enable Playwright tests in CI

---

## Documentation

- **Workflow Comparison**: See `docs/WORKFLOW_COMPARISON_ACTUAL_SYNC.md`
- **Docker Descriptions**: `docker/description/short.md` and `long.md`
- **Validation Script**: `docker/validate-docker-desc.sh`
- **Project Overview**: `docs/PROJECT_OVERVIEW.md`

---

**Last Major Update:** December 12, 2025  
**Optimization Phase:** Phase 2 - Consolidation & Enhancement Complete ✅

## Pipeline Architecture

```
┌─────────────────────────────────────────────────────────────┐
│              TRIGGER (Push/PR/Manual)                        │
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

## Manual Workflow Triggers

You can manually trigger the workflow from the GitHub Actions tab with customizable options:

### How to Run Manually

1. Go to **Actions** tab in GitHub
2. Select **CI/CD Pipeline** workflow
3. Click **Run workflow** button
4. Choose options:
   - **Skip test jobs**: Skip unit and E2E tests for faster builds
   - **Skip Docker**: Skip Docker build and push
   - **Force release**: Create release even on non-main branches

### Use Cases

**Quick Build Test** (skip tests and Docker):
- ✅ Lint and type check
- ✅ Build artifacts
- ⏭️ Skip tests
- ⏭️ Skip Docker

**Docker Only** (skip tests):
- ✅ Lint
- ⏭️ Skip tests
- ✅ Build
- ✅ Docker build and push

**Full Pipeline** (all options off):
- ✅ Complete pipeline execution
- Same as automatic push triggers

**Force Release on Develop**:
- ✅ Run full pipeline on develop branch
- ✅ Create GitHub release (normally only on main)

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

### Manual Triggers (`workflow_dispatch`)
- **Purpose**: On-demand pipeline execution with custom options
- **Available Options**:
  - `skip_tests` - Skip unit and E2E tests (faster builds)
  - `skip_docker` - Skip Docker build and push
  - `force_release` - Create release on any branch (not just main)
- **Actions**: Customizable based on selected options

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
