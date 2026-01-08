# Dependency Update Plan

**Generated:** November 24, 2025  
**Project:** Actual MCP Server v0.1.0  
**Purpose:** Phased execution plan for dependency updates  
**Next Review:** December 24, 2025  

---

## 🎯 Executive Summary

**Current Status:** 
- ✅ 0 security vulnerabilities
- 🔄 9 packages with updates available
- ⚡ Automation configured and ready
- 📋 3-phase update plan prepared

**Priority:** LOW-MEDIUM (all updates are non-critical enhancements)

**Estimated Total Effort:** 11-22 hours across 3 phases

---

## Phase 1: Patch Updates (Week 1)

### Overview
**Goal:** Apply low-risk patch updates to get latest bug fixes and security patches  
**Risk Level:** LOW  
**Estimated Time:** 1-2 hours  
**Auto-merge:** YES (after CI passes)  

### Packages to Update

| Package | Current | Target | Type | Purpose |
|---------|---------|--------|------|---------|
| dotenv | 17.2.2 | 17.2.3 | Patch | Environment config |
| @playwright/test | 1.56.0 | 1.56.1 | Patch | E2E testing |
| @types/express | 5.0.3 | 5.0.5 | Patch | TypeScript types |
| @types/node | 24.5.2 | 24.10.1 | Minor | TypeScript types |
| nodemon | 3.1.10 | 3.1.11 | Patch | Dev server |
| typescript | 5.9.2 | 5.9.3 | Patch | Compiler |

### Execution Steps

```bash
# 1. Create update branch
git checkout develop
git pull origin develop
git checkout -b deps/patch-updates-2025-11-24

# 2. Update packages
npm update dotenv @playwright/test @types/express @types/node nodemon typescript

# 3. Verify installation
npm ci

# 4. Run build
npm run build
# Expected: No TypeScript errors

# 5. Run tests
npm run test:adapter
# Expected: All tests passing

# 6. Review changes
git diff package.json package-lock.json

# 7. Commit
git add package.json package-lock.json
git commit -m "chore(deps): update patch versions

Updates:
- dotenv: 17.2.2 → 17.2.3
- @playwright/test: 1.56.0 → 1.56.1
- @types/express: 5.0.3 → 5.0.5
- @types/node: 24.5.2 → 24.10.1
- nodemon: 3.1.10 → 3.1.11
- typescript: 5.9.2 → 5.9.3

Testing:
- ✅ TypeScript build passing
- ✅ Adapter smoke tests passing
- ✅ No breaking changes

Risk: LOW - All patch versions"

# 8. Push and create PR
git push origin deps/patch-updates-2025-11-24

# Create PR via GitHub UI or CLI:
gh pr create --title "chore(deps): Batch patch updates" \
  --body "Automated patch-level dependency updates. All tests passing." \
  --label "dependencies,automated,patch-update"

# 9. Monitor CI
# Wait for GitHub Actions to complete
# Dependabot/Renovate should auto-merge if configured

# 10. Verify production
# After merge, monitor logs for any issues
```

### Success Criteria
- [ ] All packages updated successfully
- [ ] `npm ci` completes without errors
- [ ] TypeScript compilation succeeds
- [ ] All tests pass
- [ ] No new linting errors
- [ ] CI/CD pipeline passes
- [ ] PR auto-merged or manually merged

### Rollback Plan
```bash
# If issues detected post-merge:
git checkout develop
git revert HEAD
git push origin develop

# Or restore specific package:
npm install <package>@<previous-version>
```

---

## Phase 2: Minor Updates (Week 2)

### Overview
**Goal:** Update MCP SDK and Axios to latest minor versions  
**Risk Level:** MEDIUM  
**Estimated Time:** 2-4 hours  
**Auto-merge:** NO (manual review required)  

### Packages to Update

| Package | Current | Target | Type | Risk | Impact |
|---------|---------|--------|------|------|--------|
| @modelcontextprotocol/sdk | 1.18.2 | 1.22.0 | Minor | MEDIUM | Core protocol SDK |
| axios | 1.12.2 | 1.13.2 | Minor | LOW | HTTP client |

### Pre-Update Research

**MCP SDK (1.18.2 → 1.22.0):**
- [ ] Review changelog: https://github.com/modelcontextprotocol/sdk/releases
- [ ] Check for breaking changes in minor versions
- [ ] Identify deprecated methods
- [ ] Review migration guides (if any)
- [ ] Check for new features we can leverage

**Axios (1.12.2 → 1.13.2):**
- [ ] Review changelog: https://github.com/axios/axios/releases
- [ ] Check for breaking changes
- [ ] Review security fixes
- [ ] Verify TypeScript type compatibility

### Execution Steps

```bash
# 1. Create update branch
git checkout develop
git pull origin develop
git checkout -b deps/minor-updates-mcp-axios

# 2. Update MCP SDK
npm install @modelcontextprotocol/sdk@1.22.0

# 3. Update Axios
npm install axios@1.13.2

# 4. Install dependencies
npm ci

# 5. Run full build
npm run build
# Expected: No TypeScript errors
# If errors: Review breaking changes, update code

# 6. Run adapter tests
npm run test:adapter
# Expected: All tests passing

# 7. Run E2E tests (if available)
npm run test:e2e
# Expected: All tests passing

# 8. Manual testing - All 42 MCP tools
node tests/manual/actual-mcp-integration-test.js
# Expected: All tools functional

# 9. Test critical paths manually
# - Create transaction
# - List accounts
# - Query budget data
# - Bank sync (if configured)

# 10. Review code for deprecated usage
grep -r "deprecated" node_modules/@modelcontextprotocol/sdk/CHANGELOG.md || echo "Check changelog manually"

# 11. Commit changes
git add package.json package-lock.json
git commit -m "chore(deps): update MCP SDK and Axios

Updates:
- @modelcontextprotocol/sdk: 1.18.2 → 1.22.0
- axios: 1.12.2 → 1.13.2

Breaking changes: None identified
Migration notes: Reviewed changelogs, no API changes affecting our usage

Testing:
- ✅ TypeScript build passing
- ✅ Adapter smoke tests passing
- ✅ E2E tests passing
- ✅ All 42 MCP tools validated
- ✅ Manual integration tests successful

Risk: MEDIUM (core dependencies)"

# 12. Push and create PR
git push origin deps/minor-updates-mcp-axios

gh pr create --title "chore(deps): Update MCP SDK and Axios" \
  --body "## Minor Version Updates

### Changes
- MCP SDK: 1.18.2 → 1.22.0 (4 minor versions)
- Axios: 1.12.2 → 1.13.2

### Testing
- ✅ All 42 MCP tools tested
- ✅ Full test suite passing
- ✅ Manual integration testing completed

### Breaking Changes
None identified. Reviewed changelogs and tested all affected code paths.

### Review Notes
MCP SDK update brings [list features from changelog]. No deprecated methods in our usage." \
  --label "dependencies,review-required,minor-update"

# 13. Request review
gh pr review --request <reviewer-username>

# 14. After approval, merge
gh pr merge --squash

# 15. Deploy and monitor
# Watch logs for any runtime issues
# Monitor error rates and metrics
```

### Testing Checklist

**MCP Protocol Testing:**
- [ ] `tools/list` returns all 42 tools
- [ ] `tools/call` works for sample tools
- [ ] Error handling still functional
- [ ] Streaming responses work (if applicable)
- [ ] Protocol version compatibility

**HTTP Client Testing:**
- [ ] Actual Budget API calls succeed
- [ ] Retry logic still works
- [ ] Error handling correct
- [ ] Timeout behavior unchanged

**Integration Testing:**
- [ ] Create transaction
- [ ] Delete transaction
- [ ] List accounts
- [ ] Query budget data
- [ ] Bank sync (if configured)
- [ ] Multi-budget switching (if configured)

### Success Criteria
- [ ] All packages updated successfully
- [ ] No TypeScript compilation errors
- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] All 42 MCP tools functional
- [ ] Manual testing complete
- [ ] Code review approved
- [ ] No production issues after deployment

### Rollback Plan
```bash
# Immediate rollback if production issues:
git checkout develop
git revert HEAD
git push origin develop

# Then investigate and fix before retry:
npm install @modelcontextprotocol/sdk@1.18.2 axios@1.12.2
# Fix issues, retest, re-apply update
```

---

## Phase 3: Major Updates (Q1 2026)

### Overview
**Goal:** Migrate to Express v5 with breaking changes  
**Risk Level:** HIGH  
**Estimated Time:** 8-16 hours  
**Auto-merge:** NO (dedicated sprint required)  
**Scheduled:** Q1 2026 (January-March)  

### Package to Update

| Package | Current | Target | Type | Risk | Impact |
|---------|---------|--------|------|------|--------|
| express | 4.21.2 | 5.1.0 | Major | HIGH | Core HTTP framework |
| @types/express | 5.0.5 | 5.0.5+ | Types | MEDIUM | TypeScript types |

### Breaking Changes Analysis

**API Removals:**
- `app.del()` → Use `app.delete()`
- `res.sendfile()` → Use `res.sendFile()` (capital F)
- Deprecated middleware removed
- Legacy routing behavior changed

**Behavior Changes:**
1. **Promise Support:** Native async/await in middleware
2. **Rejection Handling:** Unhandled rejections trigger error middleware
3. **Path Routing:** Stricter path matching rules
4. **Query Parsing:** Updated query string behavior

**Files Requiring Changes:**
- `src/server/httpServer.ts` (PRIMARY - 200+ lines)
- `src/server/sseServer.ts` (SSE implementation)
- `src/index.ts` (server initialization)
- Any custom middleware
- Error handling logic

### Pre-Migration Research (2-3 hours)

**Research Tasks:**
- [ ] Read Express v5 migration guide: https://expressjs.com/en/guide/migrating-5.html
- [ ] Review breaking changes: https://github.com/expressjs/express/blob/5.x/History.md
- [ ] Search codebase for deprecated API usage
- [ ] Identify all Express middleware in project
- [ ] Review error handling patterns
- [ ] Check community migration experiences (GitHub issues, Stack Overflow)
- [ ] Assess codemods or automated migration tools

**Deprecated API Scan:**
```bash
# Scan for deprecated methods
grep -r "app\.del\|res\.sendfile" src/ || echo "None found"
grep -r "\.sendfile(" src/ || echo "None found"
```

### Migration Steps (6-10 hours)

#### Step 1: Setup (30 minutes)
```bash
# 1. Create feature branch
git checkout develop
git pull origin develop
git checkout -b feature/express-v5-migration

# 2. Create migration checklist issue on GitHub
gh issue create --title "Express v5 Migration Tracking" \
  --body "Track progress on Express v4 → v5 migration. See DEPENDENCY_UPDATE_PLAN.md"

# 3. Backup current state
git tag backup-before-express-v5
```

#### Step 2: Update Dependencies (15 minutes)
```bash
# Update Express and types
npm install express@5.1.0 @types/express@latest

# Install fresh
npm ci
```

#### Step 3: Code Migration (4-6 hours)

**Priority 1: Fix Breaking API Usage**
```typescript
// src/server/httpServer.ts

// BEFORE (Express v4):
app.del('/some-route', handler);
res.sendfile('/path/to/file');

// AFTER (Express v5):
app.delete('/some-route', handler);
res.sendFile('/path/to/file');
```

**Priority 2: Update Middleware for Promises**
```typescript
// BEFORE (Express v4):
app.get('/route', async (req, res, next) => {
  try {
    const data = await fetchData();
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// AFTER (Express v5 - cleaner):
app.get('/route', async (req, res) => {
  const data = await fetchData();  // Unhandled rejections auto-trigger error middleware
  res.json(data);
});
```

**Priority 3: Update Error Handling**
```typescript
// src/server/httpServer.ts

// Enhanced error middleware for Express v5
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  logger.error('Express error:', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method
  });
  
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error'
  });
});
```

**Priority 4: Review SSE Implementation**
```typescript
// src/server/sseServer.ts
// Verify SSE streaming still works correctly
// Test: Long-running responses, keep-alive, error handling
```

**Files to Update:**
- [ ] `src/server/httpServer.ts` - Main HTTP server
- [ ] `src/server/sseServer.ts` - SSE endpoints
- [ ] `src/index.ts` - Server initialization
- [ ] Any custom middleware files
- [ ] Route handlers using deprecated APIs

#### Step 4: Testing (2-3 hours)

**Build Validation:**
```bash
npm run build
# Expected: No TypeScript errors
# If errors: Fix type mismatches with updated @types/express
```

**Unit Tests:**
```bash
npm run test:adapter
# Expected: All passing
```

**Integration Tests:**
```bash
npm run test:e2e
# Expected: All passing
```

**Manual Testing:**
```bash
# 1. Start server
npm run dev

# 2. Test all HTTP endpoints
# - Health check: GET /health
# - Metrics: GET /metrics
# - MCP requests: POST / with JSON-RPC

# 3. Test SSE streaming
# - Connect to SSE endpoint
# - Send MCP requests
# - Verify responses stream correctly

# 4. Test error handling
# - Send invalid requests
# - Verify error responses
# - Check error logs

# 5. Test authentication
# - Requests with/without Bearer token
# - Verify auth works correctly
```

**Load Testing:**
```bash
# Install load testing tool
npm install -g autocannon

# Basic load test
autocannon -c 10 -d 30 http://localhost:3000/health

# MCP endpoint load test
autocannon -c 5 -d 30 -m POST -H "Content-Type: application/json" \
  -b '{"jsonrpc":"2.0","method":"tools/list","id":1}' \
  http://localhost:3000/
```

#### Step 5: Documentation (1 hour)
- [ ] Update `docs/ARCHITECTURE.md` with Express v5 notes
- [ ] Update `docs/REFACTORING_PLAN.md` - Mark Express migration complete
- [ ] Update `docs/DEPENDENCY_AUDIT_REPORT.md` - Update Express version
- [ ] Add migration notes to `docs/IMPROVEMENT_AREAS.md`
- [ ] Update package.json comments if any

#### Step 6: Commit and Review (30 minutes)
```bash
git add .
git commit -m "feat: migrate to Express v5

BREAKING CHANGE: Upgrade Express from v4 to v5

Changes:
- Updated Express to v5.1.0
- Refactored HTTP server for promise-based middleware
- Updated error handling for async routes
- Removed deprecated API usage (app.del, res.sendfile)
- Updated TypeScript types (@types/express@5.x)

Migration:
- Reviewed all Express usage in codebase
- Updated middleware to leverage native promise support
- Enhanced error handling for unhandled rejections
- Tested all HTTP endpoints and SSE streaming
- Load tested server performance

Testing:
- ✅ TypeScript build passing
- ✅ All unit tests passing
- ✅ All integration tests passing
- ✅ All E2E tests passing
- ✅ Manual testing of all endpoints completed
- ✅ Load testing successful (10 concurrent, 30s)
- ✅ Error handling validated

Files Modified:
- src/server/httpServer.ts (PRIMARY)
- src/server/sseServer.ts
- src/index.ts
- Updated docs (4 files)

Breaking Changes:
None for API consumers (internal refactoring only)

Performance:
- Response times: Similar to v4
- Memory usage: Improved (v5 optimizations)
- Error handling: More robust

Refs: #<issue-number>"

git push origin feature/express-v5-migration

# Create PR
gh pr create --title "feat: Migrate to Express v5" \
  --body "## Express v4 → v5 Migration

### Overview
This PR migrates the HTTP server from Express v4 to v5, a major version upgrade with breaking changes.

### Breaking Changes (Internal Only)
- Removed deprecated API usage
- Updated middleware for promise support
- Enhanced error handling

### Migration Highlights
- ✅ All deprecated APIs updated
- ✅ Promise-based middleware refactored
- ✅ Error handling enhanced
- ✅ Full test coverage maintained
- ✅ Load testing passed
- ✅ Zero downtime migration path

### Testing Performed
- TypeScript compilation: PASS
- Unit tests: PASS
- Integration tests: PASS
- E2E tests: PASS
- Manual endpoint testing: PASS
- Load testing: PASS (10 concurrent, 30s)
- Error scenarios: PASS

### Performance Impact
- Response time: No degradation
- Memory usage: Slight improvement
- Error handling: More robust

### Deployment Plan
1. Merge to develop
2. Deploy to staging
3. Monitor for 1 week
4. Deploy to production
5. Monitor for issues

### Rollback Plan
If issues detected:
\`\`\`bash
git revert <commit-sha>
npm install express@4.21.2
npm ci
\`\`\`

### References
- Express v5 Migration Guide: https://expressjs.com/en/guide/migrating-5.html
- Breaking Changes: https://github.com/expressjs/express/blob/5.x/History.md
- Tracking Issue: #<issue-number>" \
  --label "breaking-change,express-v5-migration,dependencies"
```

### Success Criteria
- [ ] Express v5 installed successfully
- [ ] All deprecated APIs removed
- [ ] All TypeScript errors resolved
- [ ] All tests pass (unit, integration, E2E)
- [ ] Manual testing complete
- [ ] Load testing passed
- [ ] Documentation updated
- [ ] Code review approved
- [ ] Staging deployment successful
- [ ] 1 week staging monitoring (no issues)
- [ ] Production deployment successful
- [ ] Production monitoring (no issues)

### Rollback Plan
```bash
# Stage 1: Immediate rollback (if production issues within 1 hour)
git checkout develop
git revert <commit-sha>
npm install express@4.21.2 @types/express@5.0.5
npm ci
npm run build
# Deploy immediately

# Stage 2: Investigated rollback (if issues detected after 1 hour)
# Create hotfix branch
git checkout -b hotfix/revert-express-v5
npm install express@4.21.2 @types/express@5.0.5
npm ci
git add package.json package-lock.json
git commit -m "hotfix: revert Express v5 migration due to production issues

Issues encountered:
- [List specific issues]

Rollback to Express v4.21.2 for stability.
Will re-attempt migration after fixing issues."
git push origin hotfix/revert-express-v5

# Emergency deploy
```

### Risk Mitigation
1. **Feature Flag:** Consider adding feature flag to switch between v4/v5 behavior
2. **Canary Deployment:** Deploy to 10% of traffic first, monitor, then 100%
3. **Monitoring:** Enhanced logging during migration period
4. **Staging First:** Mandatory 1 week staging validation
5. **Rollback Tested:** Test rollback procedure in staging before production

---

## Automation Status

### Configured Tools

**Dependabot (`.github/dependabot.yml`):**
- ✅ Weekly dependency scans (Mondays 9 AM)
- ✅ Grouped patch/minor updates
- ✅ Separate PRs for major updates
- ✅ Auto-labels and reviewers configured
- ✅ Monitors npm, GitHub Actions, Docker

**Renovate Bot (`renovate.json`):**
- ✅ Auto-merge patch updates after CI
- ✅ Auto-merge dev dependency minors
- ✅ Manual review for production minors
- ✅ Breaking change labels for majors
- ✅ Priority scoring for security updates
- ✅ Package grouping (TypeScript, testing)

**CI/CD (`.github/workflows/dependency-management.yml`):**
- ✅ Weekly automated audits
- ✅ Security vulnerability scanning
- ✅ Outdated package detection
- ✅ Test suite validation
- ✅ Dependency dashboard generation
- ✅ PR dependency review

### Expected Automation Behavior

**Phase 1 (Patch Updates):**
- Dependabot/Renovate will create grouped PR
- CI/CD will run tests automatically
- Auto-merge after CI passes (if configured)
- Notification sent to reviewers

**Phase 2 (Minor Updates):**
- Separate PRs for MCP SDK and Axios
- Manual review required
- CI/CD validation before merge
- Reviewer approval needed

**Phase 3 (Major Updates):**
- Express v5 PR flagged as "breaking-change"
- No auto-merge
- High priority review
- Staging deployment required

---

## Monitoring & Validation

### Post-Update Monitoring

**Immediate (First 24 hours):**
- Monitor error rates in logs
- Check response times/latency
- Verify all tools still functional
- Watch for new exceptions
- Monitor memory/CPU usage

**Short-term (First week):**
- Review user feedback
- Check for regression reports
- Monitor dependency alerts
- Validate CI/CD pipeline

**Long-term (Ongoing):**
- Weekly dependency audits
- Monthly dependency reports
- Quarterly major version reviews
- Annual security assessments

### Validation Commands

```bash
# Check installed versions
npm list --depth=0

# Verify no vulnerabilities
npm audit

# Verify build works
npm run build

# Run test suite
npm run test:adapter
npm run test:e2e

# Check for TypeScript errors
npx tsc --noEmit

# Validate package-lock.json integrity
npm install --package-lock-only
git diff package-lock.json  # Should be no changes
```

### Rollback Triggers

**Immediate Rollback Required:**
- Critical production outage
- Data loss or corruption
- Security vulnerability introduced
- Complete feature failure

**Investigate Before Rollback:**
- Isolated edge cases
- Minor performance degradation
- Non-critical warnings
- Single tool malfunction

---

## Communication Plan

### Stakeholders
- Development team
- DevOps team
- End users (if breaking changes)
- Security team (for vulnerability fixes)

### Notifications

**Phase 1 (Patch Updates):**
- Slack: #dependencies channel (if applicable)
- GitHub: PR comments
- Email: Automated PR notifications

**Phase 2 (Minor Updates):**
- Slack: #general or #dev channel
- GitHub: PR with detailed testing notes
- Email: Request review from team lead

**Phase 3 (Major Updates):**
- Slack: Announcement with migration plan
- GitHub: Issue tracking migration progress
- Email: Team meeting invite for migration kickoff
- Documentation: Migration guide in wiki

### Incident Response

**If production issues occur:**
1. Create incident ticket
2. Notify on-call team
3. Assess severity
4. Rollback if critical
5. Investigate root cause
6. Document lessons learned
7. Update procedures

---

## Success Metrics

### Phase 1 Success
- [ ] All patch updates applied within 1 week
- [ ] Zero production issues
- [ ] CI/CD pipeline passing
- [ ] Auto-merge functioning correctly

### Phase 2 Success
- [ ] MCP SDK updated within 2 weeks
- [ ] Axios updated within 2 weeks
- [ ] All 42 tools functional
- [ ] No breaking changes detected
- [ ] Production stable for 1 week post-update

### Phase 3 Success
- [ ] Express v5 migration completed Q1 2026
- [ ] Zero API breaking changes for consumers
- [ ] Performance maintained or improved
- [ ] Full test coverage maintained
- [ ] Staging validation passed (1 week)
- [ ] Production stable for 1 month post-migration

### Overall Project Success
- [ ] Dependency update process automated
- [ ] Team trained on procedures
- [ ] Documentation complete
- [ ] Rollback plans tested
- [ ] Security posture improved
- [ ] Maintenance burden reduced

---

## Timeline

| Phase | Duration | Start Date | Target Completion |
|-------|----------|------------|-------------------|
| **Phase 1** | 1 week | 2025-11-25 | 2025-12-01 |
| **Phase 2** | 2 weeks | 2025-12-02 | 2025-12-15 |
| **Phase 3** | 2-3 weeks | 2026-01-06 | 2026-01-31 |

**Total Timeline:** ~2 months (with breaks for holidays)

---

## Next Steps

**Immediate Actions (This Week):**
1. ✅ Review this update plan
2. ⏳ Execute Phase 1 (patch updates)
3. ⏳ Monitor automation PRs
4. ⏳ Validate CI/CD pipeline

**Short-Term (This Month):**
5. Schedule Phase 2 minor updates
6. Review MCP SDK and Axios changelogs
7. Plan testing strategy

**Long-Term (Q1 2026):**
8. Schedule Express v5 migration sprint
9. Conduct team training on dependency management
10. Review and optimize update procedures

---

## Contact & Support

**Questions or Issues:**
- GitHub Issues: https://github.com/agigante80/actual-mcp-server/issues
- Label: `dependencies`

**Emergency Contact:**
- Production incidents: On-call rotation
- Security vulnerabilities: See SECURITY.md

**Documentation:**
- Full audit report: `docs/DEPENDENCY_AUDIT_REPORT.md`
- Security policies: `docs/SECURITY_AND_PRIVACY.md`
- Architecture: `docs/ARCHITECTURE.md`

---

**Plan Version:** 1.0  
**Last Updated:** 2025-11-24  
**Next Review:** After Phase 2 completion
