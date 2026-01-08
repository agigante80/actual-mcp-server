# Automated Updates System

This document describes the automated dependency update system for the Actual MCP Server, with special focus on keeping `@actual-app/api` always up to date.

## Overview

The project uses a multi-layered automation approach:

1. **Dependabot** - Daily dependency checks
2. **GitHub Actions** - Automated updates, versioning, and releases
3. **Docker Automation** - Automatic image builds on releases

## Components

### 1. Dependabot Configuration

**File:** `.github/dependabot.yml`

**Features:**
- **Daily checks** for all npm dependencies (runs at 9:00 AM EST)
- **Special group for `@actual-app/api`** - isolated from other dependencies
- Separate groups for production and development dependencies
- Security updates handled separately for immediate review

**Why Daily?**
`@actual-app/api` is critical to our functionality. Daily checks ensure we stay synchronized with Actual Budget's latest features and fixes.

### 2. Auto-Update Workflow

**File:** `.github/workflows/actual-api-auto-update.yml`

**Trigger:**
- Scheduled: Daily at 10:00 AM UTC (1 hour after Dependabot)
- Manual: Via workflow dispatch with force option

**What It Does:**

1. **Version Check**
   - Compares current `@actual-app/api` version with npm registry
   - Proceeds only if update needed (or forced)

2. **Update Process**
   ```bash
   npm install @actual-app/api@latest
   npm run build
   npm run test:adapter
   ```

3. **Versioning**
   - Reads current version from `VERSION` file
   - Automatically bumps **PATCH** version (e.g., 0.1.0 → 0.1.1)
   - Updates both `VERSION` and `package.json`

4. **Git Operations**
   - Commits to `develop` branch first
   - Merges to `main` branch
   - Creates git tag (e.g., `v0.1.1`)

5. **GitHub Release**
   - Creates release automatically
   - Includes changelog with version changes
   - Links to Docker images

**Commit Message Format:**
```
deps: update @actual-app/api to X.Y.Z

- Updated @actual-app/api from A.B.C to X.Y.Z
- Auto-bumped version to W.X.Y (patch)
- Build and tests passed

[skip ci]
```

### 3. Docker Publishing Workflow

**File:** `.github/workflows/docker-publish-on-release.yml`

**Trigger:**
- Automatically when GitHub release is published
- Manual dispatch with version input

**What It Does:**

1. **Build multi-platform images**
   - Platforms: `linux/amd64`, `linux/arm64`
   - Uses Docker Buildx with caching

2. **Push to registries**
   - GitHub Container Registry (GHCR): `ghcr.io/agigante80/actual-mcp-server`
   - Docker Hub: `docker.io/agigante80/actual-mcp-server`

3. **Tagging strategy**
   - Specific version: `0.1.1`
   - Major.minor: `0.1`
   - Major: `0`
   - Latest: `latest` (for default branch)

4. **Update Docker Hub description**
   - Syncs README.md to Docker Hub automatically

### 4. Manual Version Bump Workflow

**File:** `.github/workflows/manual-version-bump.yml`

**Purpose:** For manual version control when needed

**Options:**
- Bump type: patch, minor, major
- Target branch: develop, main
- Create release: yes/no

**Use Cases:**
- Major feature releases (manual minor/major bump)
- Hotfixes requiring immediate version bump
- Pre-release preparations

## Workflow Sequence

### Automatic Daily Flow

```mermaid
graph TD
    A[9:00 AM - Dependabot checks dependencies] --> B{@actual-app/api update?}
    B -->|No| C[End]
    B -->|Yes| D[10:00 AM - Auto-update workflow triggers]
    D --> E[Install @actual-app/api@latest]
    E --> F[Build project]
    F --> G[Run tests]
    G -->|Pass| H[Bump PATCH version]
    H --> I[Commit to develop]
    I --> J[Merge to main]
    J --> K[Create git tag]
    K --> L[Create GitHub release]
    L --> M[Trigger Docker build]
    M --> N[Push to GHCR + Docker Hub]
    N --> O[Update complete!]
    G -->|Fail| P[Create GitHub issue]
```

### Version Evolution Example

```
Day 1: v0.1.0 (Initial)
Day 2: @actual-app/api updates → v0.1.1
Day 5: @actual-app/api updates → v0.1.2
Day 7: Manual minor bump → v0.2.0
Day 9: @actual-app/api updates → v0.2.1
```

## Configuration

### Required Secrets

**GitHub Secrets needed:**
- `GITHUB_TOKEN` - Automatically provided by GitHub Actions
- `DOCKERHUB_USERNAME` - Your Docker Hub username (optional)
- `DOCKERHUB_TOKEN` - Your Docker Hub access token (optional)

**To add Docker Hub secrets:**
```bash
# In your repository settings
Settings → Secrets and variables → Actions → New repository secret
```

### Environment Variables

None required - all configuration in workflow files.

## Monitoring

### Check Workflow Status

1. **GitHub Actions Tab**
   - Go to repository → Actions
   - Check "Auto-Update @actual-app/api" workflow
   - View run history and logs

2. **Dependabot Tab**
   - Go to repository → Insights → Dependency graph → Dependabot
   - View open PRs and update history

3. **Releases Page**
   - Go to repository → Releases
   - See all automated releases

### Failure Handling

**If auto-update fails:**
1. GitHub issue automatically created with label `bug`, `automated`, `dependencies`
2. Review workflow logs
3. Manual intervention may be needed

**Common failure reasons:**
- Build errors with new `@actual-app/api` version
- Test failures
- Merge conflicts
- Network issues

**To recover:**
```bash
# Option 1: Fix and re-run workflow
git checkout develop
# Make fixes
git commit && git push
# Manually trigger workflow

# Option 2: Manual update
npm install @actual-app/api@latest
npm run build && npm run test:adapter
npm run release:patch
git add . && git commit -m "deps: manual update @actual-app/api"
git push
```

## Customization

### Change Update Frequency

**Edit `.github/dependabot.yml`:**
```yaml
schedule:
  interval: "daily"  # Options: daily, weekly, monthly
  time: "09:00"      # 24-hour format
  timezone: "America/New_York"
```

**Edit `.github/workflows/actual-api-auto-update.yml`:**
```yaml
on:
  schedule:
    - cron: '0 10 * * *'  # Daily at 10 AM UTC
```

### Change Version Bump Type

Currently auto-bumps **PATCH** version. To change:

**Edit `.github/workflows/actual-api-auto-update.yml`:**
```yaml
# Line ~80
- name: Bump patch version
  run: |
    npm run release:patch  # Change to minor or major
```

### Disable Auto-Merge to Main

**Edit `.github/workflows/actual-api-auto-update.yml`:**
```yaml
# Comment out or remove this step
- name: Merge to main
  if: steps.check-version.outputs.needs_update == 'true'
  run: |
    # ... merge logic
```

This will only update `develop` branch, requiring manual PR for `main`.

### Skip Tests

**Not recommended**, but to skip tests:

```yaml
- name: Build and test
  run: |
    npm run build
    # npm run test:adapter  # Commented out
```

## Best Practices

1. **Monitor Regularly**
   - Check GitHub Actions tab weekly
   - Review auto-created releases
   - Verify Docker images published

2. **Test Locally First**
   ```bash
   # Before enabling auto-updates
   npm install @actual-app/api@latest
   npm run build
   npm run test:adapter
   ```

3. **Keep Tests Updated**
   - Ensure `test:adapter` covers critical functionality
   - Add tests for new `@actual-app/api` features

4. **Document Breaking Changes**
   - If auto-update fails, investigate `@actual-app/api` changelog
   - Update code to handle breaking changes
   - Document in project CHANGELOG.md

5. **Pin Major Versions** (optional)
   ```json
   // package.json - to prevent automatic major version updates
   {
     "dependencies": {
       "@actual-app/api": "^25.0.0"  // Only allows 25.x.x
     }
   }
   ```

## Manual Operations

### Force Update

```bash
# Via GitHub UI
Actions → Auto-Update @actual-app/api → Run workflow → force: true
```

### Manual Version Bump

```bash
# Via GitHub UI
Actions → Manual Version Bump → Run workflow
# Select: bump_type, branch, create_release
```

### Local Version Bump

```bash
# In repository
npm run release:patch   # 0.1.0 → 0.1.1
npm run release:minor   # 0.1.1 → 0.2.0
npm run release:major   # 0.2.0 → 1.0.0

# Manual commit
git add VERSION package.json
git commit -m "chore(release): bump version to $(cat VERSION)"
git push
```

## Troubleshooting

### Workflow Not Running

**Check:**
1. Workflow file syntax (YAML validation)
2. GitHub Actions enabled for repository
3. Branch protection rules not blocking bot commits

### Docker Images Not Publishing

**Check:**
1. Docker Hub credentials configured
2. GHCR permissions granted
3. Release actually created (check Releases page)

### Version Conflicts

**If multiple updates happen simultaneously:**
```bash
git checkout develop
git pull origin develop
# Resolve conflicts in VERSION and package.json
git add . && git commit
git push
```

## Future Enhancements

Potential improvements to consider:

1. **Slack/Discord Notifications**
   - Alert on successful updates
   - Alert on failures

2. **Changelog Auto-Generation**
   - Parse `@actual-app/api` changelog
   - Include in release notes

3. **Rollback Capability**
   - Auto-rollback on test failures
   - Keep previous version tags

4. **Canary Deployments**
   - Deploy to test environment first
   - Promote to production after validation

5. **Breaking Change Detection**
   - Parse semver for major version changes
   - Require manual approval for major updates

## Related Documentation

- [VERSION File Specification](./DYNAMIC_VERSIONING_SPEC.md)
- [Testing Strategy](./TESTING_AND_RELIABILITY.md)
- [CI/CD Pipeline](./ci-cd.yml)
- [Dependency Audit](./DEPENDENCY_AUDIT_REPORT.md)

## Support

For issues or questions:
1. Check workflow logs in GitHub Actions
2. Review [GitHub Issues](https://github.com/agigante80/actual-mcp-server/issues)
3. Create new issue with `automated` label
