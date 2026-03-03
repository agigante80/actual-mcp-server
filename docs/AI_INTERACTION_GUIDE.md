# AI Interaction Guide

**Project:** Actual MCP Server  
**Version:** 0.4.20  
**Purpose:** Define operational boundaries and rules for AI agents  
**Last Updated:** 2026-03-03

---

## 🎯 Purpose

This document establishes **mandatory rules and policies** for AI agents working on this project. These rules ensure code quality, security, and documentation consistency.

> ⚠️ **CRITICAL**: AI agents must follow these rules without exception. Violations may result in broken builds, security vulnerabilities, or production incidents.

---

## 🛠️ Tool Count Reference

**Tool Count:** 56 tools (all registered in IMPLEMENTED_TOOLS array as of 2026-03-02)

**Tool Categories**:
- Accounts: 7 tools
- Transactions: 12 tools (6 standard + 4 search + 2 summary — all ActualQL-powered exclusives)
- Budgets: 8 tools
- Categories: 4 tools
- Category Groups: 4 tools
- Payees: 6 tools
- Rules: 4 tools
- Query & Sync: 2 tools (query_run, bank_sync)
- Batch: 1 tool (budget_updates_batch)
- Lookup & Server: 3 tools (server_info, server_get_version, get_id_by_name)
- Session Management: 2 tools (session_list, session_close)

**Location**: `src/actualToolsManager.ts` - IMPLEMENTED_TOOLS array

---

## ✅ Local Testing Enforcement

### The Golden Rule

> **✅ The AI must ALWAYS run the complete test suite locally before committing or pushing to GitHub.**

### Testing Policy

**BEFORE every commit:**

```bash
# 1. Build the project
npm run build

# 2. Run all tests
npm run test:adapter      # Adapter smoke tests
npm run test:unit-js      # Unit tests

# 3. Security audit
npm audit --audit-level=moderate

# 4. TypeScript type checking (included in build)
# Already done in step 1
```

**If ANY test fails:**
- ❌ **DO NOT commit**
- ❌ **DO NOT push to GitHub**
- ✅ **Fix the failing test first**
- ✅ **Re-run full test suite**
- ✅ **Only commit when ALL tests pass**

### Commit Checklist

Before `git commit`:

- [ ] `npm run build` - ✅ No TypeScript errors
- [ ] `npm run test:adapter` - ✅ All adapter tests pass
- [ ] `npm run test:unit-js` - ✅ All unit tests pass
- [ ] `npm audit` - ✅ No high/critical vulnerabilities
- [ ] Documentation updated (see [Documentation Sync Policy](#documentation-sync-policy))

### Exception Cases

**Only skip tests if:**
1. Documentation-only changes (no code modifications)
2. README.md or docs/*.md updates
3. Configuration file updates that don't affect functionality

**Still required for:**
- TypeScript changes
- JavaScript changes
- Environment variable changes
- Dockerfile or Docker Compose changes
- CI/CD workflow changes

---

## 🔒 Safe Modification Rules

### General Principles

1. **Read Before Writing**
   - Always read existing files to understand context
   - Never make blind modifications
   - Preserve existing patterns and conventions

2. **Minimal Changes**
   - Make the smallest change that solves the problem
   - Don't refactor unrelated code in the same commit
   - One logical change per commit

3. **Type Safety**
   - Maintain TypeScript strict mode compliance
   - Never use `any` type without strong justification
   - Add proper type definitions for new code

4. **Error Handling**
   - All async operations must have error handling
   - Use try/catch blocks appropriately
   - Log errors with context

### File Modification Rules

#### ✅ SAFE to Modify

- **Tool implementations** (`src/tools/*.ts`)
  - Follow existing tool patterns
  - Validate inputs with Zod
  - Return proper MCP response format

- **Test files** (`test/**/*.js`, `test/**/*.ts`)
  - Add tests for new features
  - Update tests when behavior changes

- **Documentation** (`docs/**/*.md`, `README.md`)
  - Update when code changes
  - Keep examples current

- **Configuration** (`.env.example`, `docker-compose.yaml`)
  - Add new environment variables
  - Document all changes

#### ⚠️ MODIFY WITH CAUTION

- **Core modules** (`src/index.ts`, `src/actualConnection.ts`)
  - High-risk changes
  - Require thorough testing
  - Update documentation

- **Adapter layer** (`src/lib/actual-adapter.ts`)
  - Affects all tool calls
  - Test extensively before committing
  - Maintain retry logic and error handling

- **Transport servers** (`src/server/*.ts`)
  - Protocol-level changes
  - Test with real MCP clients
  - Verify LibreChat integration

#### ❌ DO NOT MODIFY WITHOUT EXPLICIT PERMISSION

- **Type definitions** (`types/*.d.ts`)
  - Generated from external sources
  - Changes will be overwritten

- **Generated code** (`generated/**/*`)
  - Auto-generated from OpenAPI specs
  - Modify source, not output

- **Git configuration** (`.gitignore`, `.git/**`)
  - Only modify with clear justification

### Security-Sensitive Areas

Before modifying, read [SECURITY_AND_PRIVACY.md](./SECURITY_AND_PRIVACY.md):

1. **Authentication** (`src/server/*.ts`)
   - Bearer token validation
   - HTTPS configuration
   - Never log tokens or passwords

2. **Environment handling** (`src/config.ts`)
   - Secrets management
   - Environment variable validation
   - Never expose secrets in logs

3. **External connections** (`src/actualConnection.ts`, `src/lib/actual-adapter.ts`)
   - API credentials
   - Connection pooling
   - Error messages must not leak credentials

---

## 📝 Documentation Sync Policy

### The Documentation Contract

> **After every code modification, the AI must identify affected documentation and update it automatically.**

### Sync Matrix

| Code Change | Required Documentation Updates |
|-------------|-------------------------------|
| **New MCP tool** | • `PROJECT_OVERVIEW.md` (increment tool count)<br>• `ARCHITECTURE.md` (add to tool list and file tree)<br>• Update tool table in main `README.md`<br>• Update smoke test stubs in `tests/unit/generated_tools.smoke.test.js` |
| **New API route/endpoint** | • `ARCHITECTURE.md` (update endpoints)<br>• `PROJECT_OVERVIEW.md` (if user-facing feature) |
| **Environment variable added** | • `.env.example` (add variable with comment)<br>• `ARCHITECTURE.md` (Configuration section)<br>• `AI_INTERACTION_GUIDE.md` (this file, Common Commands if relevant) |
| **Test changes** | • `TESTING_AND_RELIABILITY.md` (update test commands/coverage) |
| **Security/auth changes** | • `SECURITY_AND_PRIVACY.md` (update security policies)<br>• `AI_INTERACTION_GUIDE.md` (update safe modification rules) |
| **New feature** | • `PROJECT_OVERVIEW.md` (add to features)<br>• `ROADMAP.md` (mark as completed, move from planned)<br>• Main `README.md` (update feature list) |
| **Dependency update** | • `PROJECT_OVERVIEW.md` (update technology stack) |
| **Docker changes** | • `ARCHITECTURE.md` (update deployment info)<br>• Main `README.md` (update Docker commands if changed) |

### Documentation Update Workflow

```
1. Make code change
   │
2. Identify affected documentation
   │
3. Update relevant docs in SAME commit
   │
4. Verify documentation accuracy
   │
5. Run tests (npm run build && npm test)
   │
6. Commit code + docs together
```

### Documentation Quality Standards

- **Accuracy**: All examples must work with current code
- **Completeness**: No missing sections or TODOs
- **Consistency**: Terminology matches across all docs
- **Timeliness**: Updates happen with code changes, not later

---

## 🛠️ Common Commands

### Development Workflow

```bash
# 1. Setup
npm install
cp .env.example .env
# Edit .env with your Actual Budget credentials

# 2. Build
npm run build                    # TypeScript compilation

# 3. Run development server
npm run dev -- --debug --http    # HTTP transport with debug logging

# 4. Test
npm run test:adapter             # Adapter smoke tests
npm run test:unit-js             # Unit tests
npm run test:e2e                 # End-to-end tests (Playwright)

# 5. Verify
npm run verify-tools             # Check tool coverage
npm audit                        # Security audit
```

### Docker Commands

```bash
# Build custom image
docker build -t actual-mcp-server:local .

# Run container
docker run -d \
  --name actual-mcp \
  -p 3600:3600 \
  --env-file .env \
  -v actual-data:/data \
  actual-mcp-server:local

# View logs
docker logs -f actual-mcp

# Stop and remove
docker stop actual-mcp && docker rm actual-mcp
```

### Testing Commands

```bash
# Quick test suite
npm run build && npm run test:adapter

# Full test suite (before commit)
npm run build && \
npm run test:adapter && \
npm run test:unit-js && \
npm audit --audit-level=moderate

# Test specific tool
node dist/src/tests_adapter_runner.js

# Test Actual Budget connection
npm run dev -- --test-actual-connection

# Test all tools
npm run dev -- --test-actual-tools
```

### Code Generation

```bash
# Regenerate tool definitions from OpenAPI
npm run generate-tools

# Verify tool coverage
npm run verify-tools

# Check API method coverage
npm run check:coverage
```

---

## 🤖 Example AI Prompts

### Adding a New Tool

**Prompt:**
```
Add a new MCP tool called "actual_reports_generate" that generates financial reports.

Requirements:
1. Create src/tools/reports_generate.ts
2. Follow existing tool patterns
3. Export from src/tools/index.ts
4. Add tool name to IMPLEMENTED_TOOLS in src/actualToolsManager.ts
5. Add smoke test in src/tests/actualToolsTests.ts
6. Update PROJECT_OVERVIEW.md tool count
7. Update ARCHITECTURE.md tool list
8. Run full test suite before committing
```

**AI Response Checklist:**
- [ ] Tool file created with proper structure
- [ ] Zod schema for input validation
- [ ] Adapter function called correctly
- [ ] Error handling implemented
- [ ] Exported from src/tools/index.ts
- [ ] Added to IMPLEMENTED_TOOLS in src/actualToolsManager.ts
- [ ] Test added
- [ ] Documentation updated
- [ ] Tests pass locally
- [ ] Committed with descriptive message

### Refactoring Code

**Prompt:**
```
Refactor the retry logic in src/lib/actual-adapter.ts to use a separate utility module.

Requirements:
1. Extract retry logic to src/lib/retry.ts
2. Maintain existing behavior
3. Add unit tests for retry utility
4. Update documentation if needed
5. No breaking changes
```

**AI Response Checklist:**
- [ ] New retry.ts module created
- [ ] Existing functionality preserved
- [ ] Tests added for new module
- [ ] All existing tests still pass
- [ ] Documentation updated if needed
- [ ] ARCHITECTURE.md updated if structure changed
- [ ] Committed with clear refactor message

### Fixing a Bug

**Prompt:**
```
Fix the issue where transactions_filter fails when no categoryId is provided.

Requirements:
1. Identify root cause
2. Fix in src/tools/transactions_filter.ts
3. Add test case for the bug
4. Document fix in commit message
5. Verify fix doesn't break existing tests
```

**AI Response Checklist:**
- [ ] Root cause identified
- [ ] Fix implemented
- [ ] Regression test added
- [ ] All tests pass
- [ ] Fix documented in commit message
- [ ] Committed with "fix:" prefix

---

## 🚨 Common Pitfalls to Avoid

### ❌ DON'T DO THIS

1. **Committing without testing**
   ```bash
   # BAD
   git add . && git commit -m "Added feature" && git push
   ```

2. **Hardcoding secrets**
   ```typescript
   // BAD
   const password = "my-secret-password";
   ```

3. **Ignoring TypeScript errors**
   ```bash
   # BAD
   npm run build  # Shows errors
   git commit -m "WIP"  # Commits anyway
   ```

4. **Using `any` type**
   ```typescript
   // BAD
   function processData(data: any) { ... }
   ```

5. **Skipping documentation updates**
   ```bash
   # BAD - Added new tool but didn't update docs
   git commit -m "Add reports tool"
   ```

### ✅ DO THIS INSTEAD

1. **Test before committing**
   ```bash
   # GOOD
   npm run build && npm run test:adapter && npm audit
   git add . && git commit -m "feat: add reports tool"
   ```

2. **Use environment variables**
   ```typescript
   // GOOD
   const password = process.env.ACTUAL_PASSWORD;
   ```

3. **Fix errors before committing**
   ```bash
   # GOOD
   npm run build  # Shows errors
   # Fix the errors first
   npm run build  # No errors
   git commit -m "feat: add feature"
   ```

4. **Use proper types**
   ```typescript
   // GOOD
   function processData(data: TransactionData): void { ... }
   ```

5. **Update docs with code**
   ```bash
   # GOOD
   git add src/tools/reports_generate.ts
   git add docs/PROJECT_OVERVIEW.md
   git add docs/ARCHITECTURE.md
   git commit -m "feat: add reports tool with documentation"
   ```

---

## 🔄 Continuous Learning

### When You're Uncertain

1. **Read existing code** - Look for similar patterns
2. **Check documentation** - Especially ARCHITECTURE.md and SECURITY_AND_PRIVACY.md
3. **Run tests frequently** - Catch issues early
4. **Ask for clarification** - Better to ask than break things

### Learning from CI/CD

When GitHub Actions fails:
1. Read the error logs carefully
2. Reproduce the failure locally
3. Fix the issue
4. Run full test suite locally
5. Only then push again

---

## 📚 Related Documentation

For more details:
- [Security & Privacy](./SECURITY_AND_PRIVACY.md) - Security policies and incident response
- [Testing & Reliability](./TESTING_AND_RELIABILITY.md) - Comprehensive testing guide
- [Architecture](./ARCHITECTURE.md) - System design and components
- [Roadmap](./ROADMAP.md) - Future improvements and feature planning

---

## ✨ Summary

**Remember the core principles:**

1. ✅ **Always test locally before committing**
2. ✅ **Update documentation with code changes**
3. ✅ **Follow security policies for sensitive areas**
4. ✅ **Make minimal, focused changes**
5. ✅ **Maintain type safety and error handling**

**When in doubt:**
- Read the relevant documentation
- Look at existing patterns
- Test thoroughly
- Ask for clarification

**The goal:** Maintain high code quality, security, and documentation consistency while enabling rapid, confident development.
