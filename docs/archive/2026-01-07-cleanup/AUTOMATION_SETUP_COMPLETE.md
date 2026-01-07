# Automated @actual-app/api Update System - Setup Complete ✅

## What Was Implemented

A comprehensive automated system to keep `@actual-app/api` always up to date with automatic versioning and releases.

## Components Created

### 1. **Daily Auto-Update Workflow** ⏰
**File:** `.github/workflows/actual-api-auto-update.yml`

**What it does:**
- ✅ Runs daily at 10:00 AM UTC
- ✅ Checks for new `@actual-app/api` versions
- ✅ Automatically installs latest version
- ✅ Builds and tests the project
- ✅ Auto-bumps PATCH version (e.g., 0.1.0 → 0.1.1)
- ✅ Commits to `develop` branch
- ✅ Merges to `main` branch
- ✅ Creates git tag (e.g., `v0.1.1`)
- ✅ Creates GitHub release with changelog
- ✅ Triggers Docker image builds
- ✅ Creates GitHub issue if something fails

**Manual trigger:** Can be run manually via GitHub Actions UI with `force` option

### 2. **Docker Publishing Workflow** 🐳
**File:** `.github/workflows/docker-publish-on-release.yml`

**What it does:**
- ✅ Triggers automatically when GitHub release is published
- ✅ Builds multi-platform images (linux/amd64, linux/arm64)
- ✅ Pushes to GitHub Container Registry (GHCR)
- ✅ Pushes to Docker Hub
- ✅ Tags: `latest`, `0.1.1`, `0.1`, `0`
- ✅ Updates Docker Hub description from README

**Manual trigger:** Can be run manually with version input

### 3. **Manual Version Bump Workflow** 🔢
**File:** `.github/workflows/manual-version-bump.yml`

**What it does:**
- ✅ Allows manual version bumps (patch/minor/major)
- ✅ Can target `develop` or `main` branch
- ✅ Optional GitHub release creation
- ✅ Useful for major feature releases

**Options:**
- Bump type: `patch` (0.1.0 → 0.1.1), `minor` (0.1.0 → 0.2.0), `major` (0.1.0 → 1.0.0)
- Branch: `develop` or `main`
- Create release: yes/no

### 4. **Enhanced Dependabot** 📦
**File:** `.github/dependabot.yml`

**Changes:**
- ✅ Changed from **weekly** to **DAILY** checks
- ✅ Created dedicated group for `@actual-app/api` (isolated from other deps)
- ✅ Runs at 9:00 AM EST daily
- ✅ `@actual-app/api` gets its own PRs for immediate visibility
- ✅ Added commit message prefixes (`deps:`, `deps-dev:`)

### 5. **Comprehensive Documentation** 📚
**File:** `docs/AUTOMATED_UPDATES.md`

**Includes:**
- ✅ System overview and workflow diagrams
- ✅ Configuration instructions
- ✅ Monitoring and troubleshooting guides
- ✅ Best practices and customization options
- ✅ Manual operation procedures
- ✅ Required secrets setup

## How It Works

### Daily Automatic Flow

```
9:00 AM EST  → Dependabot checks dependencies
              ↓
              @actual-app/api update detected?
              ↓ (Yes)
10:00 AM UTC → Auto-update workflow triggers
              ↓
              Install @actual-app/api@latest
              ↓
              Build project (npm run build)
              ↓
              Run tests (npm run test:adapter)
              ↓
              Bump PATCH version (0.1.0 → 0.1.1)
              ↓
              Commit to develop
              ↓
              Merge to main
              ↓
              Create git tag (v0.1.1)
              ↓
              Create GitHub release
              ↓
              Trigger Docker builds
              ↓
              Push to GHCR + Docker Hub
              ↓
              Done! ✅
```

### Version Evolution Example

```
Day 1: v0.1.0  (initial version)
Day 2: v0.1.1  (@actual-app/api updated to 25.12.0)
Day 5: v0.1.2  (@actual-app/api updated to 25.12.1)
Day 7: v0.2.0  (manual minor bump for new feature)
Day 9: v0.2.1  (@actual-app/api updated to 25.13.0)
```

## Required Configuration

### GitHub Repository Settings

**Secrets to add:**
1. Go to: Repository → Settings → Secrets and variables → Actions
2. Add these secrets (optional, for Docker Hub):
   - `DOCKERHUB_USERNAME` - Your Docker Hub username
   - `DOCKERHUB_TOKEN` - Docker Hub access token

**Note:** `GITHUB_TOKEN` is automatically provided by GitHub Actions

### Branch Protection (Recommended)

For `main` branch:
- ✅ Allow `github-actions[bot]` to push
- ✅ Or disable branch protection for bot commits

### Workflow Permissions

Already configured in workflow files:
```yaml
permissions:
  contents: write        # For commits and tags
  pull-requests: write   # For Dependabot PRs
  packages: write        # For GHCR pushes
```

## Testing the System

### 1. Test Manual Version Bump (Safe)

1. Go to: **Actions** → **Manual Version Bump**
2. Click: **Run workflow**
3. Select:
   - Bump type: `patch`
   - Branch: `develop`
   - Create release: `false` (for testing)
4. Click: **Run workflow**
5. Verify: VERSION file updated, committed to develop

### 2. Test Auto-Update (Manual Trigger)

1. Go to: **Actions** → **Auto-Update @actual-app/api**
2. Click: **Run workflow**
3. Select:
   - force: `true` (will run even if already on latest)
4. Click: **Run workflow**
5. Verify: Full flow completes (develop → main → release → Docker)

### 3. Wait for Daily Automation

- First automatic run: Tomorrow at 10:00 AM UTC
- Check: **Actions** tab for workflow runs
- Monitor: Releases page for new versions

## Monitoring

### GitHub Actions

**View workflow runs:**
- Repository → Actions → Select workflow
- See: run history, logs, success/failure status

### Dependabot

**View dependency updates:**
- Repository → Insights → Dependency graph → Dependabot
- See: open PRs, update history, security alerts

### Releases

**View automated releases:**
- Repository → Releases
- See: all versions, changelogs, Docker pull commands

### Docker Images

**Verify published images:**
```bash
# GitHub Container Registry
docker pull ghcr.io/agigante80/actual-mcp-server:latest

# Docker Hub
docker pull agigante80/actual-mcp-server:latest
```

## What Happens When @actual-app/api Updates

### Automatic Process

1. **Detection:** Dependabot or daily workflow detects new version
2. **Update:** Workflow installs `@actual-app/api@latest`
3. **Build:** Project built with TypeScript compiler
4. **Test:** Adapter tests run to verify compatibility
5. **Version:** PATCH version auto-bumped (0.1.0 → 0.1.1)
6. **Commit:** Changes committed to develop with descriptive message
7. **Merge:** Develop merged to main automatically
8. **Tag:** Git tag created (v0.1.1)
9. **Release:** GitHub release created with changelog
10. **Docker:** Multi-platform images built and published
11. **Notification:** GitHub Actions summary shows all changes

### If Tests Fail

1. **Stop:** Workflow stops, no changes committed
2. **Issue:** GitHub issue created automatically
3. **Alert:** You receive notification
4. **Action:** Manual investigation needed

### Commit Message Format

```
deps: update @actual-app/api to 25.12.0

- Updated @actual-app/api from 25.11.0 to 25.12.0
- Auto-bumped version to 0.1.1 (patch)
- Build and tests passed

[skip ci]
```

## Customization Options

### Change Update Frequency

**Edit `.github/dependabot.yml`:**
```yaml
schedule:
  interval: "daily"    # Options: daily, weekly, monthly
  time: "09:00"
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
    npm run release:patch  # Change to: minor or major
```

### Disable Auto-Merge to Main

**Edit `.github/workflows/actual-api-auto-update.yml`:**
```yaml
# Comment out or remove "Merge to main" step
# This will only update develop, requiring manual PR to main
```

### Skip Tests (Not Recommended)

**Edit `.github/workflows/actual-api-auto-update.yml`:**
```yaml
- name: Build and test
  run: |
    npm run build
    # npm run test:adapter  # Commented out
```

## Benefits

1. **Always Up to Date:** Never miss `@actual-app/api` updates
2. **Zero Manual Work:** Fully automated from detection to release
3. **Both Branches:** Updates both `develop` and `main` automatically
4. **Docker Included:** Automatic multi-platform image builds
5. **Proper Versioning:** Semantic versioning with auto-bumps
6. **Full Traceability:** Every update has commit, tag, and release
7. **Failure Safety:** Stops if tests fail, creates issue
8. **Manual Override:** Can force updates or manual version bumps

## File Summary

### Created Files (5)

1. `.github/workflows/actual-api-auto-update.yml` (214 lines)
   - Daily auto-update workflow
   
2. `.github/workflows/docker-publish-on-release.yml` (107 lines)
   - Docker image publishing on release
   
3. `.github/workflows/manual-version-bump.yml` (110 lines)
   - Manual version control
   
4. `.github/dependabot.yml` (modified)
   - Daily checks, @actual-app/api isolated group
   
5. `docs/AUTOMATED_UPDATES.md` (423 lines)
   - Complete documentation

### Total Lines Added
- Workflows: ~431 lines
- Documentation: ~423 lines
- **Total: ~854 lines of automation**

## Next Steps

### Immediate (Before Workflows Run)

1. **Add Docker Hub secrets** (optional):
   ```
   Settings → Secrets → Actions → New repository secret
   - DOCKERHUB_USERNAME
   - DOCKERHUB_TOKEN
   ```

2. **Test manual version bump**:
   ```
   Actions → Manual Version Bump → Run workflow
   Bump type: patch
   Branch: develop
   Create release: false
   ```

3. **Test auto-update manually**:
   ```
   Actions → Auto-Update @actual-app/api → Run workflow
   force: true
   ```

### Tomorrow (First Automatic Run)

1. **Check Actions tab** at 10:00 AM UTC
2. **Verify workflow completes** successfully
3. **Check Releases page** for new version
4. **Verify Docker images** published to GHCR/Docker Hub

### Ongoing

1. **Monitor Actions** tab weekly
2. **Review automated releases** on Releases page
3. **Check Docker Hub** for image availability
4. **Read `docs/AUTOMATED_UPDATES.md`** for full details

## Support

**Workflow fails?**
1. Check Actions tab for error logs
2. Review automatically created GitHub issue
3. See `docs/AUTOMATED_UPDATES.md` troubleshooting section

**Questions?**
- Full documentation: `docs/AUTOMATED_UPDATES.md`
- GitHub Workflow syntax: https://docs.github.com/actions
- Dependabot docs: https://docs.github.com/code-security/dependabot

---

## ✅ System Status

- ✅ **Workflows created and committed**
- ✅ **Dependabot configured for daily checks**
- ✅ **Documentation complete**
- ✅ **Ready to run automatically**
- ⏳ **First automatic run: Tomorrow at 10:00 AM UTC**

**Commit:** `777ab16` on `develop` branch
**Files:** 5 files added/modified, 875 lines added
**Status:** **READY FOR PRODUCTION** 🚀
