# File Organization Plan

**Created**: December 10, 2025  
**Project**: Actual MCP Server  
**Purpose**: Systematic file and folder reorganization

---

## Executive Summary

**Current Issues Identified:**
- ✅ Core structure is good (src/, tests/, docs/ established)
- ⚠️ **7 test scripts** in root directory (should be in tests/ or scripts/)
- ⚠️ **3 log files** in root (should be in logs/ or gitignored)
- ⚠️ **1 obsolete markdown** file (`QUICK_FIX_TIMEOUT.md`)
- ⚠️ **Tests/manual folder removed** but references may remain
- ⚠️ **Duplicate package.json entries** in tree output
- ⚠️ **Python venv in repo** (.venv/ should be in .gitignore only)

**Good Existing Structure:**
- ✅ `src/` - Well organized with clear subdirectories
- ✅ `docs/` - Comprehensive documentation, recently consolidated
- ✅ `tests/` - Proper test organization (e2e/, integration/, unit/)
- ✅ `scripts/` - Build and utility scripts properly placed
- ✅ `.github/` - CI/CD and GitHub configs properly placed

---

## Detailed Analysis

### **Root Directory Files (Current)**

| File | Size | Assessment | Action |
|------|------|------------|--------|
| `package.json` | - | ✅ Essential | **KEEP** |
| `package-lock.json` | - | ✅ Essential | **KEEP** |
| `tsconfig.json` | - | ✅ Essential | **KEEP** |
| `playwright.config.ts` | - | ✅ Essential | **KEEP** |
| `README.md` | - | ✅ Essential | **KEEP** |
| `LICENSE` | - | ✅ Essential | **KEEP** |
| `SECURITY.md` | - | ✅ Essential | **KEEP** |
| `CONTRIBUTING.md` | - | ✅ Essential | **KEEP** |
| `Dockerfile` | - | ✅ Essential | **KEEP** |
| `.gitignore` | - | ✅ Essential | **KEEP** |
| `.dockerignore` | - | ✅ Essential | **KEEP** |
| `docker-compose*.yml` | - | ✅ Essential | **KEEP** |
| `nginx.conf` | - | ✅ Essential | **KEEP** |
| `renovate.json` | - | ✅ Essential | **KEEP** |
| | | | |
| `create-sample-budget.js` | 2.2K | ⚠️ Script | **MOVE** → `scripts/` |
| `register-tsconfig-paths.js` | - | ⚠️ Script | **MOVE** → `scripts/` |
| `get_version.sh` | - | ⚠️ Script | **MOVE** → `scripts/` |
| | | | |
| `test-comprehensive.js` | 4.4K | ⚠️ Test | **MOVE** → `tests/scratch/` |
| `test-transaction-browser.js` | 2.4K | ⚠️ Test | **MOVE** → `tests/scratch/` |
| `test-transaction-direct.js` | 2.7K | ⚠️ Test | **MOVE** → `tests/scratch/` |
| `test-transaction-server.js` | 2.6K | ⚠️ Test | **MOVE** → `tests/scratch/` |
| `test-transaction-simple.js` | 2.4K | ⚠️ Test | **MOVE** → `tests/scratch/` |
| `test-transaction-synced.js` | 2.7K | ⚠️ Test | **MOVE** → `tests/scratch/` |
| `test-verify-fields.js` | 2.2K | ⚠️ Test | **MOVE** → `tests/scratch/` |
| `test-update-tool.mjs` | - | ⚠️ Test | **MOVE** → `tests/scratch/` |
| | | | |
| `test-budget-e2e.json` | 503B | ⚠️ Test data | **MOVE** → `tests/fixtures/` |
| | | | |
| `mcp-server.log` | 443K | ❌ Log file | **DELETE** (gitignored) |
| `mcp-server-e2e.log` | 6.5K | ❌ Log file | **DELETE** (gitignored) |
| `server.log` | 6.2K | ❌ Log file | **DELETE** (gitignored) |
| | | | |
| `QUICK_FIX_TIMEOUT.md` | - | ❌ Obsolete | **DELETE** or **ARCHIVE** |

### **Issues to Address**

#### 1. **Scratch Test Files in Root**
**Problem**: 8 test files cluttering root directory  
**Solution**: Create `tests/scratch/` for exploratory/one-off tests

#### 2. **Log Files in Root**
**Problem**: 3 log files committed or present in root  
**Solution**: Delete and ensure they're in `.gitignore`

#### 3. **Utility Scripts in Root**
**Problem**: 3 utility scripts that should be in `scripts/`  
**Solution**: Move to `scripts/` directory

#### 4. **Obsolete Documentation**
**Problem**: `QUICK_FIX_TIMEOUT.md` appears to be temporary documentation  
**Solution**: Review content, archive if historical value, delete if obsolete

#### 5. **Python venv in Repository**
**Problem**: `.venv/` directory present (should only be in .gitignore)  
**Solution**: Ensure it's properly gitignored and document Python requirement if needed

---

## Migration Plan

### **Phase 1: Create New Directories** (2 minutes)

```bash
# Create scratch test directory
mkdir -p tests/scratch

# Create fixtures directory if doesn't exist
mkdir -p tests/fixtures

# Verify
ls -la tests/
```

**Status**: ⬜ Not Started

---

### **Phase 2: Move Utility Scripts** (5 minutes)

| Current Path | Target Path | Reason |
|--------------|-------------|--------|
| `create-sample-budget.js` | `scripts/create-sample-budget.js` | Utility script |
| `register-tsconfig-paths.js` | `scripts/register-tsconfig-paths.js` | Build utility |
| `get_version.sh` | `scripts/get_version.sh` | Build utility |

**Actions**:
```bash
git mv create-sample-budget.js scripts/
git mv register-tsconfig-paths.js scripts/
git mv get_version.sh scripts/

# Update any references in package.json
# Check for imports/requires in other files

# Test
npm run build
npm run test:adapter

# Commit
git commit -m "refactor: move utility scripts to scripts/ directory"
```

**Files to Check for References**:
- `package.json` - npm scripts
- `Dockerfile` - build process
- `.github/workflows/*.yml` - CI/CD

**Status**: ⬜ Not Started

---

### **Phase 3: Move Scratch Test Files** (10 minutes)

| Current Path | Target Path | Reason |
|--------------|-------------|--------|
| `test-comprehensive.js` | `tests/scratch/test-comprehensive.js` | Exploratory test |
| `test-transaction-browser.js` | `tests/scratch/test-transaction-browser.js` | Exploratory test |
| `test-transaction-direct.js` | `tests/scratch/test-transaction-direct.js` | Exploratory test |
| `test-transaction-server.js` | `tests/scratch/test-transaction-server.js` | Exploratory test |
| `test-transaction-simple.js` | `tests/scratch/test-transaction-simple.js` | Exploratory test |
| `test-transaction-synced.js` | `tests/scratch/test-transaction-synced.js` | Exploratory test |
| `test-verify-fields.js` | `tests/scratch/test-verify-fields.js` | Exploratory test |
| `test-update-tool.mjs` | `tests/scratch/test-update-tool.mjs` | Exploratory test |

**Actions**:
```bash
# Move test files
git mv test-comprehensive.js tests/scratch/
git mv test-transaction-browser.js tests/scratch/
git mv test-transaction-direct.js tests/scratch/
git mv test-transaction-server.js tests/scratch/
git mv test-transaction-simple.js tests/scratch/
git mv test-transaction-synced.js tests/scratch/
git mv test-verify-fields.js tests/scratch/
git mv test-update-tool.mjs tests/scratch/

# Add README to scratch directory
cat > tests/scratch/README.md << 'EOF'
# Scratch Tests

This directory contains exploratory and one-off test scripts that are not part of the regular test suite.

**Purpose**: Quick experiments, debugging tests, and temporary validation scripts.

**Note**: These tests may be out of date and are not maintained. Use for reference only.
EOF

# Commit
git add tests/scratch/README.md
git commit -m "refactor: move exploratory test scripts to tests/scratch/"
```

**Status**: ⬜ Not Started

---

### **Phase 4: Move Test Fixtures** (2 minutes)

| Current Path | Target Path | Reason |
|--------------|-------------|--------|
| `test-budget-e2e.json` | `tests/fixtures/test-budget-e2e.json` | Test data |

**Actions**:
```bash
# Move test fixture
git mv test-budget-e2e.json tests/fixtures/

# Check for references
grep -r "test-budget-e2e.json" tests/ .github/

# Update references if found
# Example: sed -i 's|../test-budget-e2e.json|../fixtures/test-budget-e2e.json|g' tests/e2e/*.ts

# Commit
git commit -m "refactor: move test fixtures to tests/fixtures/"
```

**Status**: ⬜ Not Started

---

### **Phase 5: Clean Up Log Files** (2 minutes)

| File | Action | Reason |
|------|--------|--------|
| `mcp-server.log` | DELETE | Runtime log, should be gitignored |
| `mcp-server-e2e.log` | DELETE | Runtime log, should be gitignored |
| `server.log` | DELETE | Runtime log, should be gitignored |

**Actions**:
```bash
# Remove log files
rm -f mcp-server.log mcp-server-e2e.log server.log

# Verify they're in .gitignore
grep -E "\.log$|logs/" .gitignore

# If not, add them
echo "*.log" >> .gitignore
echo "logs/" >> .gitignore

# Commit gitignore if updated
git add .gitignore
git commit -m "chore: ensure log files are gitignored"
```

**Status**: ⬜ Not Started

---

### **Phase 6: Handle Obsolete Documentation** (5 minutes)

**File**: `QUICK_FIX_TIMEOUT.md`

**Decision**: **DELETE** - Content is redundant with `docs/NGINX_PROXY.md`

**Rationale**: 
- `QUICK_FIX_TIMEOUT.md` covers LibreChat SSE timeout issues
- `docs/NGINX_PROXY.md` already has comprehensive timeout troubleshooting section
- Same solutions documented in both places (timeout: 600000, MCP_TIMEOUT env var)
- NGINX_PROXY.md is more authoritative and better maintained

**Actions**:
```bash
# Delete obsolete doc
git rm QUICK_FIX_TIMEOUT.md
git commit -m "docs: remove redundant QUICK_FIX_TIMEOUT.md (covered in NGINX_PROXY.md)"
```

**Status**: ⬜ Not Started - **Decision Made: DELETE**

---

### **Phase 7: Update Documentation References** (10 minutes)

**Files to Update**:
- `docs/TESTING_AND_RELIABILITY.md` - Update test file locations
- `docs/ARCHITECTURE.md` - Update script locations if referenced
- `docs/AI_INTERACTION_GUIDE.md` - Update file paths if referenced
- `.github/copilot-instructions.md` - Update file paths if referenced

**Actions**:
```bash
# Search for references to moved files
grep -r "test-comprehensive" docs/ .github/
grep -r "create-sample-budget" docs/ .github/
grep -r "register-tsconfig-paths" docs/ .github/

# Update any references found
# Use sed or manual editing

# Commit
git add docs/ .github/
git commit -m "docs: update file paths after reorganization"
```

**Status**: ✅ **COMPLETED** - December 10, 2025

**Actions Taken**:
- Updated `package.json` scripts to use `scripts/register-tsconfig-paths.js`
- Updated `docs/DYNAMIC_VERSIONING_SPEC.md` to reference `scripts/get_version.sh`
- No other code files reference the moved files (verified with grep)
- Test fixture `test-budget-e2e.json` not referenced in code (only in plan documentation)

---

### **Phase 8: Verification** (15 minutes)

**Actions**:
```bash
# 1. Build verification
npm run build

# 2. Test suite verification
npm run test:adapter
npm run test:unit-js
npm run test:e2e

# 3. Check for broken references
grep -r "\\.\\./" src/ tests/ | grep -E "\\.\\./test-|\\.\\./(create-sample|register-tsconfig)"

# 4. Verify package.json scripts still work
npm run verify-tools
npm run generate-tools

# 5. Check CI/CD workflows
# Review .github/workflows/*.yml for broken paths

# 6. Final structure check
tree -L 2 -I 'node_modules|dist|.git|logs|.venv'
```

**Success Criteria**:
- [ ] All builds succeed
- [ ] All tests pass
- [ ] No broken import paths
- [ ] No files in root except essentials
- [ ] CI/CD workflows unchanged or updated
- [ ] Documentation reflects new structure

**Status**: ⬜ Not Started

---

## Target Structure (After Refactoring)

```
actual-mcp-server/
├── .github/              ✅ GitHub configs (CI/CD, templates)
├── certs/                ✅ SSL certificates
├── docker/               ✅ Docker description files
├── docs/                 ✅ All documentation
│   ├── archive/          ✅ Historical documents
│   └── *.md             ✅ Current documentation
├── generated/            ✅ Generated type definitions
├── scripts/              ✅ All utility scripts
│   ├── create-sample-budget.js       🆕 MOVED
│   ├── register-tsconfig-paths.js    🆕 MOVED
│   ├── get_version.sh               🆕 MOVED
│   ├── generate-tools-node.js
│   ├── generate-tools.ts
│   ├── list-actual-api-methods.mjs
│   └── verify-tools.js
├── src/                  ✅ Source code
│   ├── lib/              ✅ Core libraries
│   ├── server/           ✅ Server implementations
│   ├── tools/            ✅ MCP tools (49 tools)
│   ├── types/            ✅ TypeScript types
│   └── *.ts             ✅ Main application files
├── tests/                ✅ All tests
│   ├── e2e/              ✅ End-to-end tests
│   ├── integration/      ✅ Integration tests
│   ├── unit/             ✅ Unit tests
│   ├── fixtures/         🆕 Test data
│   │   └── test-budget-e2e.json     🆕 MOVED
│   └── scratch/          🆕 Exploratory tests
│       ├── README.md                🆕 CREATED
│       ├── test-comprehensive.js    🆕 MOVED
│       ├── test-transaction-*.js    🆕 MOVED (5 files)
│       ├── test-verify-fields.js    🆕 MOVED
│       └── test-update-tool.mjs     🆕 MOVED
├── types/                ✅ Global TypeScript types
├── package.json          ✅ Essential config
├── package-lock.json     ✅ Essential config
├── tsconfig.json         ✅ Essential config
├── playwright.config.ts  ✅ Essential config
├── Dockerfile            ✅ Essential config
├── docker-compose*.yml   ✅ Essential config
├── nginx.conf            ✅ Essential config
├── renovate.json         ✅ Essential config
├── .gitignore            ✅ Essential config
├── .dockerignore         ✅ Essential config
├── .env*                 ✅ Environment configs
├── README.md             ✅ Main documentation
├── LICENSE               ✅ License file
├── SECURITY.md           ✅ Security policy
└── CONTRIBUTING.md       ✅ Contribution guide
```

**Removed from Root**:
- ❌ `create-sample-budget.js` (moved to scripts/)
- ❌ `register-tsconfig-paths.js` (moved to scripts/)
- ❌ `get_version.sh` (moved to scripts/)
- ❌ `test-*.js` (moved to tests/scratch/ - 8 files)
- ❌ `test-budget-e2e.json` (moved to tests/fixtures/)
- ❌ `*.log` (deleted - 3 files)
- ❌ `QUICK_FIX_TIMEOUT.md` (deleted or archived)

---

## Risk Assessment

**Risk Level**: **LOW** ✅

**Reasons**:
- Moving scripts and tests is low-risk (not critical code paths)
- Git mv preserves history
- Tests verify functionality after each phase
- Easy to rollback individual commits

**Potential Issues**:
1. **Scripts in package.json** - May reference moved files
   - **Mitigation**: Check package.json scripts before/after
   - **Impact**: Low - Easy to fix

2. **CI/CD References** - Workflows may reference moved files
   - **Mitigation**: Review .github/workflows/
   - **Impact**: Low - Workflows may break but easy to fix

3. **Import Paths** - Files may import moved scripts
   - **Mitigation**: Grep for references before moving
   - **Impact**: Low - TypeScript will catch broken imports

---

## Execution Timeline

| Phase | Estimated Time | Risk | Priority |
|-------|---------------|------|----------|
| 1. Create directories | 2 min | None | High |
| 2. Move scripts | 5 min | Low | High |
| 3. Move test files | 10 min | None | Medium |
| 4. Move fixtures | 2 min | None | Medium |
| 5. Clean logs | 2 min | None | High |
| 6. Review obsolete doc | 5 min | None | Low |
| 7. Update docs | 10 min | None | Medium |
| 8. Verification | 15 min | None | Critical |
| **Total** | **51 min** | **LOW** | - |

---

## Rollback Plan

If issues arise:

```bash
# Rollback to before reorganization
git log --oneline -10  # Find commit before refactor
git reset --hard <commit-hash>

# Or rollback individual phases
git revert <commit-hash>  # Revert specific commit
```

---

## Success Metrics

- [ ] **Zero files in root except essentials** (configs, README, LICENSE, etc.)
- [ ] **All scripts in scripts/ directory**
- [ ] **All tests in tests/ with clear organization**
- [ ] **No log files committed**
- [ ] **All tests passing** (adapter, unit, e2e)
- [ ] **Build succeeds**
- [ ] **Documentation updated**
- [ ] **CI/CD workflows working**
- [ ] **Git history preserved** (used git mv)
- [ ] **Team notified** (commit messages clear)

---

## Notes

**Good Current Structure** ✅:
- Source code properly organized in `src/`
- Tests properly organized in `tests/` with subdirectories
- Documentation consolidated in `docs/`
- Scripts in `scripts/` directory (except 3 files)

**Minor Issues to Fix** ⚠️:
- 3 utility scripts in root → Move to scripts/
- 8 test files in root → Move to tests/scratch/
- 3 log files in root → Delete
- 1 obsolete doc in root → Review and delete/archive

**Overall Assessment**: Project structure is **85% excellent**, just needs minor cleanup of root directory.

---

## Approval

- [ ] Plan reviewed by team
- [ ] Timeline approved
- [ ] Rollback plan understood
- [ ] Ready to execute

**Approver**: _____________  
**Date**: _____________

---

**Next Steps**: Review this plan, approve phases, then execute systematically following the order above.
