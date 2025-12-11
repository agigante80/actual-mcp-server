# Quick Reference: Automated Updates System

## 🎯 Quick Actions

### Manual Version Bump
```bash
# Via GitHub UI
Actions → Manual Version Bump → Run workflow
  Bump type: [patch|minor|major]
  Branch: [develop|main]
  Create release: [yes|no]

# Via command line
npm run release:patch   # 0.1.0 → 0.1.1
npm run release:minor   # 0.1.0 → 0.2.0
npm run release:major   # 0.1.0 → 1.0.0
git add VERSION package.json && git commit -m "chore: bump version"
git push && git tag -a "vX.Y.Z" -m "Release vX.Y.Z" && git push --tags
```

### Force @actual-app/api Update
```bash
# Via GitHub UI
Actions → Auto-Update @actual-app/api → Run workflow
  force: true
```

### Check Status
```bash
# Workflow runs
Repository → Actions → Select workflow

# Latest version
cat VERSION
npm view @actual-app/api version

# Docker images
docker pull ghcr.io/agigante80/actual-mcp-server:latest
docker images | grep actual-mcp-server
```

## 📅 Daily Schedule

| Time (UTC) | Action | What Happens |
|------------|--------|--------------|
| 09:00 | Dependabot runs | Checks all npm dependencies |
| 10:00 | Auto-update workflow | Checks @actual-app/api specifically |
| 10:05 | If update found | Install → Build → Test → Version → Commit |
| 10:10 | If tests pass | Merge to main → Tag → Release → Docker |

## 🔄 Automated Flow

```
@actual-app/api update detected
  ↓
Install latest version
  ↓
npm run build
  ↓
npm run test:adapter
  ↓ (pass)
Bump PATCH version
  ↓
Commit to develop
  ↓
Merge to main
  ↓
Create git tag
  ↓
Create GitHub release
  ↓
Build Docker images (multi-platform)
  ↓
Push to GHCR + Docker Hub
  ↓
Done! ✅
```

If tests fail → Stop, create GitHub issue

## 📦 Versioning Rules

### Automatic (Daily)
- **@actual-app/api** update → **PATCH** version bump
- Example: 0.1.0 → 0.1.1 (when @actual-app/api updates)

### Manual
- **Patch:** Bug fixes, dependency updates (0.1.0 → 0.1.1)
- **Minor:** New features, backward compatible (0.1.0 → 0.2.0)
- **Major:** Breaking changes (0.1.0 → 1.0.0)

## 🐳 Docker Tags

Every release creates:
```
ghcr.io/agigante80/actual-mcp-server:latest
ghcr.io/agigante80/actual-mcp-server:0.1.1
ghcr.io/agigante80/actual-mcp-server:0.1
ghcr.io/agigante80/actual-mcp-server:0

agigante80/actual-mcp-server:latest
agigante80/actual-mcp-server:0.1.1
agigante80/actual-mcp-server:0.1
agigante80/actual-mcp-server:0
```

## 🔧 Configuration Files

| File | Purpose | Edit To |
|------|---------|---------|
| `.github/dependabot.yml` | Dependency checks | Change frequency, add exclusions |
| `.github/workflows/actual-api-auto-update.yml` | Auto-update workflow | Change schedule, bump type, add steps |
| `.github/workflows/docker-publish-on-release.yml` | Docker publishing | Add registries, change platforms |
| `.github/workflows/manual-version-bump.yml` | Manual version control | Add custom bump logic |

## 🔐 Required Secrets

### GitHub Actions (automatic)
- ✅ `GITHUB_TOKEN` - Provided automatically

### Docker Hub (optional)
- ⚠️ `DOCKERHUB_USERNAME` - Your username
- ⚠️ `DOCKERHUB_TOKEN` - Access token

**Add secrets:**
```
Repository → Settings → Secrets and variables → Actions → New repository secret
```

## 🚨 Troubleshooting

### Workflow Failed
1. Check: Actions tab for error logs
2. Check: GitHub Issues for auto-created issue
3. Fix: Code/tests/deps as needed
4. Re-run: Manually trigger workflow with force option

### Version Conflict
```bash
git checkout develop
git pull origin develop
# Resolve conflicts in VERSION and package.json
git add VERSION package.json
git commit -m "chore: resolve version conflict"
git push
```

### Docker Images Not Publishing
1. Check: Release actually created (Releases page)
2. Check: Docker Hub credentials configured
3. Check: Workflow logs for build errors

### Skip Auto-Merge to Main
```yaml
# Edit: .github/workflows/actual-api-auto-update.yml
# Comment out: "Merge to main" step
```

## 📊 Monitoring

### Daily Check (2 minutes)
```bash
# 1. Check if workflow ran
gh run list --workflow=actual-api-auto-update.yml --limit 1

# 2. Check latest version
cat VERSION

# 3. Check latest @actual-app/api
npm view @actual-app/api version
```

### Weekly Review (5 minutes)
```bash
# 1. Review automated releases
Repository → Releases → Check last 7 days

# 2. Review Docker images
docker pull ghcr.io/agigante80/actual-mcp-server:latest
docker images | grep actual-mcp-server

# 3. Check Dependabot PRs
Repository → Pull requests → Label: dependencies
```

## 🎯 Common Tasks

### Update @actual-app/api Now
```bash
npm install @actual-app/api@latest
npm run build && npm run test:adapter
npm run release:patch
git add . && git commit -m "deps: update @actual-app/api"
git push
```

### Create Manual Release
```bash
# 1. Bump version
npm run release:minor  # or patch, major

# 2. Commit and tag
git add VERSION package.json
git commit -m "chore: release v$(cat VERSION)"
git tag -a "v$(cat VERSION)" -m "Release v$(cat VERSION)"

# 3. Push
git push && git push --tags

# 4. GitHub release auto-created
```

### Disable Automation Temporarily
```yaml
# Edit: .github/workflows/actual-api-auto-update.yml
# Comment out schedule section:
on:
  # schedule:
  #   - cron: '0 10 * * *'
  workflow_dispatch:  # Keep manual trigger
```

## 📚 Documentation

- **Full Guide:** `docs/AUTOMATED_UPDATES.md`
- **Setup Summary:** `AUTOMATION_SETUP_COMPLETE.md`
- **Version Spec:** `docs/DYNAMIC_VERSIONING_SPEC.md`
- **Testing:** `docs/TESTING_AND_RELIABILITY.md`

## ✅ Health Check

```bash
# All should pass:
✓ npm run build                    # TypeScript compiles
✓ npm run test:adapter             # Tests pass
✓ cat VERSION                      # Version exists
✓ npm view @actual-app/api version # Can check npm
✓ git status                       # Working tree clean
✓ gh workflow list                 # Workflows enabled
```

## 🚀 Next Steps

1. **Tomorrow:** Check if auto-update ran (Actions tab at 10 AM UTC)
2. **This Week:** Review first automated release (Releases page)
3. **This Month:** Verify Docker images updated (docker pull)
4. **Ongoing:** Monitor Actions tab for failures

---

**Status:** ✅ READY  
**First Run:** Next day at 10:00 AM UTC  
**Docs:** `docs/AUTOMATED_UPDATES.md`
