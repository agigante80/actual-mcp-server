# Version Management & Automated Releases

## Overview

This document outlines the comprehensive semantic versioning strategy with automated build metadata, release tagging, and GitHub Actions integration for the Actual MCP Server project.

## Current Implementation Status

**Version:** 0.2.4
**Last Updated:** December 17, 2025

### ✅ Already Implemented
- Semantic versioning in package.json
- VERSION file with base version
- Development build versioning with commit hashes (e.g., `0.2.4-dev-abc1234`)
- GitHub Actions for Docker builds
- Docker image tagging (latest, development, main, develop)
- Branch-specific version metadata (main, develop, feature branches)
- Manual version management

### 🚧 To Be Implemented
- Automated version bumping
- Conventional commits enforcement
- Pre-release workflow (beta, rc)
- CHANGELOG generation

## Implementation Plan

Given that Actual MCP Server is currently in **active development (0.2.4)**:

1. **Phase 1** ✅ COMPLETE: VERSION file, development build versioning with commit hashes
2. **Phase 2** (Next): Conventional commits enforcement and PR validation
3. **Phase 3** (Pre-1.0): Automated CHANGELOG generation
4. **Phase 4** (1.0 release): Automated version bumping and release workflow

## Version Format

Follow semantic versioning: `MAJOR.MINOR.PATCH[-PRERELEASE][-METADATA]`

**Note:** We use hyphens instead of `+` for metadata to ensure compatibility with GitHub tags and Docker image names.

### Current Stage: Pre-1.0 (0.x.x)

For pre-1.0 versions:
- **0.MINOR.PATCH** - API is unstable, breaking changes allowed
- **0.MINOR.0** - New features or significant changes
- **0.MINOR.PATCH** - Bug fixes and minor improvements

### Post-1.0 Versioning

Once stable (1.0.0+):
- **MAJOR**: Breaking changes in MCP tools or API
- **MINOR**: New MCP tools or backward-compatible features
- **PATCH**: Bug fixes, tool improvements

## Version Examples by Context

| Stage | Version Example | Description | Use Case |
|-------|----------------|-------------|----------|
| **Current Dev** | `0.2.4` | Pre-1.0 development | Active development |
| **Dev Build** | `0.2.4-dev-abcdef7` | Includes commit hash | Feature branch testing |
| **Docker Latest** | `latest` → `1.0.0` | **Only from main branch** | Production releases |
| **Docker Dev** | `development` / `develop` | Latest from develop branch | Bleeding edge testing |
| **Future Stable** | `1.0.0` | First stable release | Production ready |

## Docker Image Tagging Strategy

### Current Implementation

```yaml
# Docker Hub & GHCR - Branch-based tagging
agigante80/actual-mcp-server:latest          # ✅ ONLY from main branch (stable)
agigante80/actual-mcp-server:main            # Latest main branch build
agigante80/actual-mcp-server:develop         # Latest develop branch build  
agigante80/actual-mcp-server:development     # Alias for develop branch
agigante80/actual-mcp-server:0.2.4           # Specific version tag
agigante80/actual-mcp-server:0.2.4-dev-abc1234  # Version + commit (future)
```

### Tagging Rules

**`main` branch builds:**
- `:latest` ✅ (stable release)
- `:main` ✅ (branch tracking)
- `:X.Y.Z` ✅ (version number from VERSION file)

**`develop` branch builds:**
- `:develop` ✅ (branch tracking)
- `:development` ✅ (alias)
- `:X.Y.Z` ✅ (version number from VERSION file)
- `:latest` ❌ (NEVER - reserved for main only)

**Tagged releases (e.g., `v1.0.0`):**
- `:latest` ✅ (marks as stable)
- `:X.Y.Z` ✅ (version number)
- `:main` ❌ (no branch tag for version tags)

## Conventional Commits for Actual MCP Server

### Commit Prefixes

Use these prefixes for automatic version bumping (post-1.0):

| Prefix | Version Bump | Example | MCP Server Context |
|--------|--------------|---------|-------------------|
| `feat:` | MINOR (0.x: patch) | `feat: add transactions_search_by_month` | New MCP tool |
| `fix:` | PATCH | `fix: resolve .serialize() bug in search tools` | Tool bug fix |
| `feat!:` | MAJOR (0.x: minor) | `feat!: redesign tool input schemas` | Breaking change |
| `perf:` | PATCH | `perf: optimize connection pool` | Performance |
| `docs:` | - | `docs: update README with 49 tools` | Documentation only |

### Example Commits for This Project

```bash
# Adding a new MCP tool (49 → 50 tools)
git commit -m "feat(tools): add actual_transactions_bulk_delete tool"

# Fixing a tool bug
git commit -m "fix(tools): correct amount conversion in transactions_create"

# Breaking change (pre-1.0: minor bump, post-1.0: major bump)
git commit -m "feat(api)!: change tool input schema to require accountId

BREAKING CHANGE: All transaction tools now require accountId parameter"

# Performance improvement
git commit -m "perf(adapter): implement connection pooling for concurrent requests"

# Documentation update (no version bump)
git commit -m "docs(readme): add Docker deployment examples"
```

## Quick Start: Implement Basic Versioning

### Step 1: Create VERSION File

```bash
cd /home/alien/dev/actual-mcp-server
echo "0.1.0" > VERSION
git add VERSION
git commit -m "chore: initialize VERSION file for version management"
```

### Step 2: Add Version Scripts to package.json

```json
{
  "scripts": {
    "version:current": "cat VERSION",
    "version:dev": "node scripts/version-dev.js",
    "version:bump": "node scripts/version-bump.js",
    "version:check": "node scripts/version-check.js"
  }
}
```

### Step 3: Create Version Management Scripts

See the full prompt above for complete script implementations in `/scripts` directory.

## Integration with Existing Workflows

### Current GitHub Actions

**Existing workflows** (`.github/workflows/`):
- `docker-build.yml` - Builds and publishes Docker images
- `npm-publish.yml` - Publishes to npm registry

**Recommended additions**:
- `dev-build.yml` - Development builds with commit hashes
- `release.yml` - Automated stable releases
- `pre-release.yml` - Beta/RC releases

## Roadmap to 1.0

| Milestone | Version | Key Features | Timeline |
|-----------|---------|--------------|----------|
| **Current** | 0.1.0 | 49 tools, connection pooling | Dec 2025 |
| **Next Minor** | 0.2.0 | 6 search/summary tools published to Docker Hub | Q1 2026 |
| **Beta** | 0.9.0 | Feature complete, production testing | Q2 2026 |
| **RC** | 1.0.0-rc.1 | Release candidate, final testing | Q2 2026 |
| **Stable** | 1.0.0 | Production ready, stable API | Q3 2026 |

## Best Practices for This Project

### ✅ DO:
- Use conventional commits for all tool additions/changes
- Include tool count in version tags (e.g., "49 tools")
- Test Docker builds before releasing
- Update README tool count with each release
- Sync VERSION file with package.json
- Tag Docker images with version numbers

### ❌ DON'T:
- Manually edit version in multiple places
- Release without running smoke tests
- Skip Docker Hub image update
- Forget to update docs/PROJECT_OVERVIEW.md with tool count
- Mix development and stable versions in LibreChat

## Tool-Specific Versioning Considerations

### When to Bump Versions

**MINOR (0.x.x → 0.y.0)**:
- Adding new MCP tools (e.g., 49 → 50 tools)
- Adding new ActualQL features
- Significant new capabilities

**PATCH (0.x.y → 0.x.z)**:
- Fixing tool bugs (like the .serialize() fix)
- Performance improvements
- Documentation updates with code changes

**Pre-1.0**: Breaking changes are allowed without major version bump

## References

- [Semantic Versioning Spec](https://semver.org/)
- [Conventional Commits](https://www.conventionalcommits.org/)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Docker Tagging Best Practices](https://docs.docker.com/engine/reference/commandline/tag/)

## Next Steps

1. **Immediate**: Create VERSION file and sync with package.json (0.1.0)
2. **Short-term**: Implement dev build versioning for feature branches
3. **Medium-term**: Add conventional commits and CHANGELOG generation
4. **Long-term**: Full automated release workflow for 1.0

---

**Status**: 📝 Planning Document
**Owner**: agigante80
**Last Review**: December 11, 2025
