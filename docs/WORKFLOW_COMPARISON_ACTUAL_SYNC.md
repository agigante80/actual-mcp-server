# Workflow Comparison: Actual-sync vs Actual-MCP-Server

**Date:** December 12, 2025  
**Actual-sync Repository:** https://github.com/agigante80/Actual-sync  
**Actual-MCP-Server Repository:** https://github.com/agigante80/actual-mcp-server

---

## Executive Summary

Both projects have **similar workflow philosophies** but with **key structural differences**:

### Actual-sync (2 workflows, 804 lines)
- ✅ **Simpler, more streamlined** approach
- ✅ **PR-based dependency updates** (manual merge required)
- ✅ **Better version tag handling** (supports `v*` tag triggers)
- ✅ **More comprehensive Docker testing** (startup validation)
- ✅ **Multi-registry publishing** (Docker Hub + GHCR)
- ✅ **Better Docker tag strategy** (semantic versions + branch tags)
- ⚠️ **Manual intervention required** for @actual-app/api updates

### Actual-MCP-Server (3 workflows, 1,080 lines)
- ✅ **Fully automated @actual-app/api updates** (no manual intervention)
- ✅ **Auto-merge and release** on dependency updates
- ✅ **Comprehensive dependency management** (weekly reports, security audits)
- ⚠️ **More complex workflow orchestration**
- ⚠️ **Single Docker registry** (Docker Hub only)
- ⚠️ **No tag-based triggers** in ci-cd.yml

---

## Detailed Comparison

## 1. CI/CD Workflow Structure

### Actual-sync: ci-cd.yml (676 lines)

**Triggers:**
```yaml
on:
  push:
    branches: [main, develop, development]
    tags: ['v*']  # ✅ Supports version tag triggers
  pull_request:
    branches: [main, develop, development]
  workflow_dispatch:
```

**Jobs:** 11 jobs total
1. **version** - Extract version from package.json
2. **lint** - Code formatting checks (JavaScript syntax validation)
3. **test** - Unit tests + npm audit + codecov upload
4. **build** - Application build (npm ci --omit=dev)
5. **validate-short-description** - Docker Hub description length check
6. **docker-test** - Docker build test with container startup validation
7. **docker-publish** - Multi-platform build (amd64, arm64) → Docker Hub + GHCR
8. **security-scan** - Trivy vulnerability scanning with SARIF upload
9. **docker-hub-description** - Update Docker Hub metadata
10. **release** - GitHub release creation with changelog
11. **deployment-test** - Test published images from Docker Hub + GHCR
12. **summary** - Pipeline summary report

**Key Features:**
- ✅ **Comprehensive Docker testing** - Container startup validation
- ✅ **Multi-registry publishing** - Docker Hub AND GitHub Container Registry
- ✅ **Security scanning** - Trivy with SARIF upload to GitHub Security tab
- ✅ **Semantic versioning** - Extracts from package.json, creates version-specific tags
- ✅ **Tag-based triggers** - Workflow runs on `v*` tag pushes
- ✅ **Docker tag strategy:**
  ```bash
  # Version tags (from package.json)
  agigante80/actual-sync:1.0.0
  ghcr.io/agigante80/actual-sync:1.0.0
  
  # Branch tags
  agigante80/actual-sync:main
  agigante80/actual-sync:latest  # Only on main + version tags
  agigante80/actual-sync:develop
  agigante80/actual-sync:development
  ```

### Actual-MCP-Server: ci-cd.yml (654 lines)

**Triggers:**
```yaml
on:
  push:
    branches: [main, develop]  # ⚠️ No tag triggers
  pull_request:
    branches: [main, develop]
  workflow_dispatch:
```

**Jobs:** 9 jobs total
1. **lint** - TypeScript type check, tool coverage check, npm audit
2. **test** - Unit tests + adapter tests + smoke tests
3. **e2e** - Playwright E2E tests (currently disabled in CI)
4. **build** - Production build + version generation from VERSION file
5. **docker-test** - Docker build test with basic startup check
6. **docker** - Docker build and push (only Docker Hub)
7. **docker-push-develop** - Push :development tag on develop branch
8. **docker-push-main** - Push :latest + version tags on main branch
9. **release** - GitHub release creation (only on main)
10. **summary** - Pipeline summary

**Key Features:**
- ✅ **TypeScript-focused** - Full type checking and compilation
- ✅ **Tool coverage checking** - Verifies all 53 MCP tools are registered
- ✅ **Playwright E2E tests** - More sophisticated testing (currently disabled)
- ✅ **VERSION file** - Single source of truth for version (not package.json)
- ⚠️ **Single registry** - Only Docker Hub (no GHCR)
- ⚠️ **No tag triggers** - Cannot trigger on `v*` tags
- ⚠️ **Split Docker jobs** - Separate jobs for develop vs main (more complex)
- ✅ **Docker tag strategy:**
  ```bash
  # Develop branch
  agigante80/actual-mcp-server:development
  
  # Main branch
  agigante80/actual-mcp-server:latest
  agigante80/actual-mcp-server:0.2.0
  agigante80/actual-mcp-server:0.2
  agigante80/actual-mcp-server:0
  ```

### Winner: **Actual-sync** 🏆
- Simpler, unified Docker publish job
- Multi-registry support (Docker Hub + GHCR)
- Tag-based triggers for automated releases
- Better Docker tag organization
- More comprehensive startup validation

---

## 2. Dependency Update Workflows

### Actual-sync: dependency-update.yml (128 lines)

**Approach:** PR-based dependency updates

**Schedule:** Daily at 1:00 AM UTC
```yaml
on:
  schedule:
    - cron: '0 1 * * *'
  workflow_dispatch:
```

**Process:**
1. ✅ **Check** for new @actual-app/api version
2. ✅ **Install** new version
3. ✅ **Create Pull Request** with:
   - Detailed changelog from npm
   - Release information
   - Testing checklist
   - Manual merge instructions
4. ⚠️ **Manual merge required** by developer
5. ⚠️ **Manual release creation** after merge

**PR Content:**
```markdown
## 🔄 Dependency Update

### Changes
- Current version: 1.0.0
- New version: 1.0.1

### Release Info
[Changelog from npm registry]

### Testing Required
- [ ] Verify migration compatibility
- [ ] Test with existing budget files
- [ ] Run `npm test`
- [ ] Test bank sync functionality

### Auto-Release
Once merged, create a new release tag:
git tag -a v1.0.x -m "Release v1.0.x"
git push origin v1.0.x
```

**Pros:**
- ✅ Human oversight on critical dependency
- ✅ Testing checklist ensures quality
- ✅ Changelog visibility before merge
- ✅ Control over when to release

**Cons:**
- ⚠️ Requires manual intervention
- ⚠️ Slower update cycle
- ⚠️ Can be forgotten if notifications missed

### Actual-MCP-Server: actual-api-auto-update.yml (214 lines)

**Approach:** Fully automated updates with auto-merge and release

**Schedule:** Daily at 10:00 AM UTC (after Dependabot at 9 AM)
```yaml
on:
  schedule:
    - cron: '0 10 * * *'
  workflow_dispatch:
```

**Process:**
1. ✅ **Check** for new @actual-app/api version
2. ✅ **Install** and build
3. ✅ **Run tests** (adapter + smoke tests)
4. ✅ **Auto-bump PATCH version** (0.2.0 → 0.2.1)
5. ✅ **Commit to develop** with [skip ci]
6. ✅ **Auto-merge to main** (no PR)
7. ✅ **Create git tag** (v0.2.1)
8. ✅ **Create GitHub Release** with auto-generated notes
9. ✅ **Trigger Docker builds** via ci-cd.yml
10. ✅ **Create issue on failure**

**Pros:**
- ✅ Zero manual intervention
- ✅ Immediate updates (within 24 hours)
- ✅ Automated versioning
- ✅ Auto-tagged releases
- ✅ Failure notifications via issues

**Cons:**
- ⚠️ No human review before merge
- ⚠️ Potential for breaking changes
- ⚠️ Can flood main branch with automated commits

### Actual-MCP-Server: dependency-management.yml (212 lines)

**Additional Weekly Workflow**

**Schedule:** Weekly on Mondays at 9 AM UTC
```yaml
on:
  schedule:
    - cron: '0 9 * * 1'
  workflow_dispatch:
```

**Jobs:**
1. **check-outdated** - Generate outdated packages report
2. **test-with-updates** - Test with latest compatible updates (manual trigger only)
3. **dependency-review** - Security review on PRs (using GitHub Dependency Review)
4. **update-dependency-dashboard** - Create issue with comprehensive dependency status

**Features:**
- ✅ Weekly dependency health reports
- ✅ Security vulnerability tracking
- ✅ Automated dashboard issues
- ✅ Dependency review on PRs (deny GPL licenses)
- ✅ Test suite with updated dependencies before PR creation

**Example Dashboard:**
```markdown
# Dependency Dashboard

**Last Updated:** 2025-12-12 09:00 UTC

## Security Status
- 🔴 Critical: 0
- 🟠 High: 0
- 🟡 Moderate: 1
- 🟢 Low: 2

## Outdated Packages
| Package | Current | Wanted | Latest | Update Type |
|---------|---------|--------|--------|-------------|
| express | 4.18.0 | 4.18.2 | 5.0.0 | Major ⚠️ |
| zod | 3.22.0 | 3.22.4 | 3.22.4 | Minor/Patch ✅ |
```

### Winner: **Depends on Project Needs** 🤝

**Actual-sync approach (PR-based):**
- Better for: Production systems requiring human oversight
- Better for: Teams with QA processes
- Better for: Less frequent but more controlled updates

**Actual-MCP-Server approach (Fully automated):**
- Better for: Fast-moving development
- Better for: Keeping up with upstream changes immediately
- Better for: Solo developers who want hands-off automation
- Better for: Projects where @actual-app/api is critical and updates are trusted

**Recommendation:** Actual-sync's PR-based approach is **safer for production**, but Actual-MCP-Server's automation is **more efficient for active development**.

---

## 3. Key Missing Features

### Actual-sync NEEDS from Actual-MCP-Server:

1. ❌ **Automated dependency updates** (optional feature, can enable)
2. ❌ **Weekly dependency dashboard** (Actual-sync has no health monitoring)
3. ❌ **Dependency review on PRs** (GitHub Dependency Review Action)
4. ❌ **TypeScript type checking** (Actual-sync uses JavaScript)
5. ❌ **Tool coverage validation** (Actual-MCP-Server checks all 53 tools registered)

### Actual-MCP-Server NEEDS from Actual-sync:

1. ❌ **Tag-based workflow triggers** (`tags: ['v*']`)
2. ❌ **Multi-registry Docker publishing** (GHCR + Docker Hub)
3. ❌ **Comprehensive Docker startup testing** (Actual-sync validates container actually runs)
4. ❌ **Security scanning with Trivy + SARIF upload** (GitHub Security tab integration)
5. ❌ **Deployment testing job** (Pull and test published images)
6. ❌ **Better Docker tag strategy** (semantic versioning on both registries)
7. ❌ **Docker Hub description updates** (Keeps README.md in sync)
8. ❌ **Unified Docker publish job** (Actual-MCP-Server splits develop/main into separate jobs)

---

## 4. Workflow Statistics

| Metric | Actual-sync | Actual-MCP-Server |
|--------|-------------|-------------------|
| **Total Workflows** | 2 | 3 (was 5, optimized to 3) |
| **Total Lines** | 804 | 1,080 |
| **CI/CD Lines** | 676 | 654 |
| **Dependency Lines** | 128 | 426 (214 + 212) |
| **Jobs in CI/CD** | 11 | 9 |
| **Docker Registries** | 2 (Docker Hub + GHCR) | 1 (Docker Hub only) |
| **Manual Intervention** | Required for updates | None (fully automated) |
| **Security Scanning** | Trivy + SARIF | npm audit only |
| **Tag Triggers** | ✅ Yes (`v*`) | ❌ No |
| **Multi-platform Builds** | ✅ Yes (amd64, arm64) | ✅ Yes (amd64, arm64) |
| **Dependency Dashboard** | ❌ No | ✅ Yes (weekly) |

---

## 5. Recommendations for Actual-MCP-Server

### High Priority (Adopt from Actual-sync)

1. **Add tag-based triggers to ci-cd.yml**
   ```yaml
   on:
     push:
       branches: [main, develop]
       tags: ['v*']  # ← Add this
   ```

2. **Add GHCR publishing to Docker workflow**
   ```yaml
   - name: Login to GitHub Container Registry
     uses: docker/login-action@v3
     with:
       registry: ghcr.io
       username: ${{ github.actor }}
       password: ${{ secrets.GITHUB_TOKEN }}
   ```

3. **Improve Docker tag strategy** (match Actual-sync)
   - Add semantic version tags to both registries
   - Add branch-specific tags (main, develop, latest)
   - Use conditional logic for :latest tag

4. **Add Trivy security scanning**
   ```yaml
   - name: Run Trivy vulnerability scanner
     uses: aquasecurity/trivy-action@master
     with:
       image-ref: ${{ secrets.DOCKERHUB_USER }}/actual-mcp-server:scan
       format: 'sarif'
       output: 'trivy-results.sarif'
   
   - name: Upload Trivy results to GitHub Security
     uses: github/codeql-action/upload-sarif@v3
     with:
       sarif_file: 'trivy-results.sarif'
   ```

5. **Add deployment testing job**
   ```yaml
   deployment-test:
     name: Deployment Test
     runs-on: ubuntu-latest
     needs: docker
     steps:
       - name: Test Docker Hub image
         run: |
           docker pull ${{ secrets.DOCKERHUB_USER }}/actual-mcp-server:$VERSION
           docker run --rm --name test \
             -e VERSION=$VERSION \
             ${{ secrets.DOCKERHUB_USER }}/actual-mcp-server:$VERSION \
             node --version
   ```

6. **Consolidate Docker jobs** (develop + main into single job with conditionals)

### Medium Priority

7. **Add Docker Hub description updates**
   ```yaml
   - name: Update Docker Hub description
     uses: peter-evans/dockerhub-description@v4
     with:
       username: ${{ secrets.DOCKERHUB_USER }}
       password: ${{ secrets.DOCKERHUB_TOKEN }}
       repository: ${{ secrets.DOCKERHUB_USER }}/actual-mcp-server
       short-description: "MCP server for Actual Budget - 53 tools for conversational finance management"
       readme-filepath: ./docker/description/long.md
   ```

8. **Improve Docker startup validation** (like Actual-sync)
   ```yaml
   - name: Verify Docker image can start
     run: |
       docker run --rm -d --name test-container \
         -e ACTUAL_SERVER_URL=http://test:5006 \
         actual-mcp-server:test
       
       # Wait and verify container actually starts
       for i in {1..10}; do
         if docker ps | grep -q test-container; then
           echo "✅ Container is running"
           docker logs test-container
           docker stop test-container
           exit 0
         fi
         sleep 1
       done
   ```

### Low Priority (Optional)

9. **Consider PR-based dependency updates** (hybrid approach)
   - Keep automated updates for patch versions
   - Use PRs for minor/major updates requiring review
   - Add testing checklist like Actual-sync

10. **Add Docker description validation** (like Actual-sync)
    ```yaml
    - name: Validate Docker Hub short description
      run: |
        CHAR_COUNT=$(wc -c < docker/description/short.md)
        if [ $CHAR_COUNT -gt 100 ]; then
          echo "❌ Short description exceeds 100 characters"
          exit 1
        fi
    ```

---

## 6. Summary Table: Which Workflow is Better?

| Feature | Winner | Reasoning |
|---------|--------|-----------|
| **CI/CD Structure** | Actual-sync 🏆 | Simpler, unified Docker job, tag triggers |
| **Docker Publishing** | Actual-sync 🏆 | Multi-registry, better tagging, comprehensive testing |
| **Security Scanning** | Actual-sync 🏆 | Trivy + SARIF upload to GitHub Security |
| **Dependency Automation** | Actual-MCP-Server 🏆 | Fully automated, zero manual intervention |
| **Dependency Monitoring** | Actual-MCP-Server 🏆 | Weekly dashboards, comprehensive reports |
| **Testing Strategy** | Actual-MCP-Server 🏆 | TypeScript, E2E tests, tool coverage validation |
| **Version Management** | Tie 🤝 | Both use semantic versioning (different sources) |
| **Deployment Testing** | Actual-sync 🏆 | Tests published images from both registries |
| **Failure Handling** | Actual-MCP-Server 🏆 | Auto-creates issues on failure |
| **Manual Control** | Actual-sync 🏆 | PR-based updates allow human oversight |
| **Speed of Updates** | Actual-MCP-Server 🏆 | Immediate automated updates (within 24 hours) |

### Overall Winner: **Hybrid Approach** 🎯

**Best solution:** Combine both approaches:
- Use **Actual-sync's CI/CD structure** (tag triggers, multi-registry, security scanning)
- Keep **Actual-MCP-Server's dependency automation** (with optional manual mode)
- Add **Actual-sync's deployment testing**
- Maintain **Actual-MCP-Server's TypeScript testing** and tool coverage

---

## 7. Action Plan

### Phase 1: Critical Improvements (Week 1)
1. ✅ Add tag-based triggers to ci-cd.yml
2. ✅ Add GHCR publishing
3. ✅ Add Trivy security scanning
4. ✅ Consolidate Docker jobs (remove split develop/main jobs)

### Phase 2: Enhanced Testing (Week 2)
5. ✅ Add deployment testing job
6. ✅ Improve Docker startup validation
7. ✅ Add Docker Hub description updates

### Phase 3: Optimization (Week 3)
8. ⚠️ Review dependency automation strategy (consider hybrid PR-based for major updates)
9. ✅ Add semantic versioning to Docker tags
10. ✅ Add branch-specific Docker tags

### Phase 4: Documentation (Week 4)
11. ✅ Create docker/description/short.md and long.md
12. ✅ Update workflow README with new features
13. ✅ Document Docker registry strategy

---

## Appendix: Side-by-Side Workflow Comparison

### Actual-sync Workflow Flow
```
Push/PR/Tag → Version Extract → Lint → Test → Build
                                  ↓
                    Validate Docker Description
                                  ↓
                          Docker Test Build
                                  ↓
              ┌─────────────────────────────────┐
              ↓                                 ↓
       Docker Publish                    Security Scan
    (Docker Hub + GHCR)                     (Trivy)
              ↓                                 ↓
         Update Docker Hub                     │
          Description                          │
              ↓                                 ↓
          Release Creation ←──────────────────┘
              ↓
       Deployment Test
    (Pull from both registries)
              ↓
           Summary
```

### Actual-MCP-Server Workflow Flow
```
Push/PR → Lint (TypeScript) → Test → E2E (disabled)
                                ↓
                             Build
                                ↓
                         Docker Test Build
                                ↓
          ┌────────────────────┴──────────────────┐
          ↓                                       ↓
    Docker Push Develop              Docker Push Main
    (Docker Hub :development)   (Docker Hub :latest, :0.2.0)
          ↓                                       ↓
          └────────────────────┬──────────────────┘
                               ↓
                         Release (main only)
                               ↓
                            Summary
```

**Key Difference:** Actual-sync uses a **unified, conditional approach**, while Actual-MCP-Server uses **separate jobs for different branches** (more complex).

---

## Conclusion

Both workflows are **production-ready** but serve **different philosophies**:

- **Actual-sync:** Safety-first, manual control, comprehensive testing
- **Actual-MCP-Server:** Automation-first, speed, continuous delivery

**Recommended approach:** Adopt Actual-sync's CI/CD structure while maintaining Actual-MCP-Server's dependency automation capabilities as an **optional feature** (can be disabled for more conservative projects).

**Estimated effort to align:** ~40-60 hours of development + testing
**Estimated benefit:** 30% reduction in workflow complexity, 50% better observability (security scanning + deployment testing)

