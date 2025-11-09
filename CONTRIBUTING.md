# Contributing to Actual MCP Server

Thank you for your interest in contributing to the Actual MCP Server! This document provides guidelines and instructions for contributing to the project.

## 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Development Workflow](#development-workflow)
- [Testing](#testing)
- [Code Standards](#code-standards)
- [Submitting Changes](#submitting-changes)
- [Auto-merge Workflow](#auto-merge-workflow)

## 🤝 Code of Conduct

This project adheres to a code of conduct that fosters an open and welcoming environment. By participating, you agree to:

- Be respectful and inclusive
- Focus on constructive feedback
- Accept responsibility for mistakes
- Prioritize the community's best interests

## 🚀 Getting Started

### Prerequisites

- **Node.js 20+** (LTS recommended)
- **npm 9+** or **pnpm**
- **Docker** (optional, for local Actual Budget server)
- **Git**
- Access to an Actual Budget server (or run one locally)

### Ways to Contribute

- 🐛 Report bugs and issues
- 💡 Suggest new features or improvements
- 📝 Improve documentation
- 🔧 Fix bugs or implement features
- 🧪 Add tests to increase coverage
- 🎨 Improve code quality and performance

## 💻 Development Setup

### 1. Fork and Clone

```bash
# Fork the repository on GitHub, then clone your fork
git clone https://github.com/YOUR_USERNAME/actual-mcp-server.git
cd actual-mcp-server

# Add upstream remote
git remote add upstream https://github.com/agigante80/actual-mcp-server.git
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment

```bash
# Copy example environment file
cp .env.example .env

# Edit .env with your Actual Budget credentials
# You need:
#   - ACTUAL_SERVER_URL (your Actual server URL)
#   - ACTUAL_PASSWORD (your Actual password)
#   - ACTUAL_BUDGET_SYNC_ID (found in Actual: Settings → Sync ID)
```

### 4. Build the Project

```bash
npm run build
```

### 5. Run in Development Mode

```bash
# With debug logging
npm run dev -- --debug

# Test connection only
npm run dev -- --test-actual-connection

# Test all tools
npm run dev -- --test-actual-tools
```

## 📁 Project Structure

```
actual-mcp-server/
├── src/                      # Source code
│   ├── index.ts             # Main entry point
│   ├── config.ts            # Configuration & validation
│   ├── actualConnection.ts  # Actual Finance API connection
│   ├── actualToolsManager.ts # MCP tool registry
│   ├── lib/                 # Core libraries
│   │   ├── actual-adapter.ts # API wrapper with retry logic
│   │   └── ActualMCPConnection.ts # MCP protocol implementation
│   ├── server/              # Transport implementations (HTTP/WS/SSE)
│   ├── tools/               # MCP tool definitions (37 tools)
│   └── types/               # TypeScript type definitions
├── test/                     # Test suites
│   ├── e2e/                 # End-to-end tests (Playwright)
│   ├── integration/         # Integration tests
│   └── unit/                # Unit tests
├── scripts/                  # Build and generation scripts
│   ├── generate-tools.ts    # Auto-generate tools from OpenAPI
│   └── openapi/             # OpenAPI specifications
├── docs/                     # Documentation
└── .github/                  # GitHub Actions workflows
```

## 🔄 Development Workflow

### Creating a Branch

```bash
# Update your fork
git fetch upstream
git checkout main
git merge upstream/main

# Create a feature branch
git checkout -b feature/your-feature-name

# Or for bug fixes
git checkout -b fix/issue-description
```

### Branch Naming Conventions

- `feature/` - New features or enhancements
- `fix/` - Bug fixes
- `docs/` - Documentation changes
- `refactor/` - Code refactoring
- `test/` - Adding or updating tests
- `chore/` - Maintenance tasks

### Making Changes

1. **Write code** following our [Code Standards](#code-standards)
2. **Add tests** for new functionality
3. **Update documentation** if needed
4. **Run tests** to ensure nothing breaks
5. **Commit changes** with clear messages

### Commit Message Format

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks
- `perf`: Performance improvements

**Examples:**
```bash
feat(tools): add support for payee merging
fix(adapter): handle null values in transaction import
docs: update API coverage documentation
test(e2e): add tests for account creation flow
```

## 🧪 Testing

### Running Tests

```bash
# Run all unit tests
npm run test:unit

# Run end-to-end tests
npm run test:e2e

# Run adapter tests
npm run test:adapter

# Run specific test file
npx playwright test test/e2e/specific-test.spec.ts
```

### Writing Tests

- **Unit tests**: Test individual functions and modules
- **Integration tests**: Test interactions between components
- **E2E tests**: Test complete user workflows

Example test structure:

```typescript
import { describe, it, expect } from '@playwright/test';

describe('accounts_list tool', () => {
  it('should return list of accounts', async () => {
    const result = await toolManager.callTool('actual_accounts_list', {});
    expect(result).toBeDefined();
    expect(Array.isArray(result.result)).toBe(true);
  });
});
```

### Test Coverage

- Aim for >80% coverage for new code
- All new tools must have corresponding tests
- Critical paths require E2E test coverage

## 📏 Code Standards

### TypeScript Style

- Use TypeScript strict mode
- Prefer `const` over `let`
- Use meaningful variable names
- Add JSDoc comments for public APIs
- Use Zod for runtime validation

### Code Formatting

```bash
# Format code (if prettier is configured)
npm run format

# Lint code
npm run lint
```

### Best Practices

1. **Keep functions small**: Single responsibility principle
2. **Error handling**: Always handle errors appropriately
3. **Logging**: Use the logger for debugging, not console.log
4. **Type safety**: Avoid `any` types when possible
5. **Documentation**: Document complex logic with comments

### Adding New MCP Tools

When adding a new tool:

1. Create tool file in `src/tools/`
2. Define Zod input schema
3. Implement tool function calling adapter
4. Export from `src/tools/index.ts`
5. Add tests in `test/unit/`
6. Update documentation

Example:

```typescript
// src/tools/your_new_tool.ts
import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({
  id: z.string().describe('The ID parameter'),
  // ... other parameters
});

const tool: ToolDefinition = {
  name: 'actual_your_new_tool',
  description: 'Description of what this tool does',
  inputSchema: InputSchema,
  call: async (args: unknown) => {
    const validated = InputSchema.parse(args);
    const result = await adapter.yourNewFunction(validated);
    return { result };
  },
};

export default tool;
```

## 📤 Submitting Changes

### Pull Request Process

1. **Update your branch**:
   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

2. **Push to your fork**:
   ```bash
   git push origin feature/your-feature-name
   ```

3. **Open a Pull Request**:
   - Go to GitHub and create a PR from your branch to `main`
   - Fill out the PR template
   - Link related issues
   - Add screenshots/demos if applicable

4. **CI Checks**: Ensure all CI checks pass
   - Build succeeds
   - All tests pass
   - No linting errors

5. **Code Review**: Address reviewer feedback
   - Make requested changes
   - Push updates to your branch
   - Respond to comments

6. **Merge**: Once approved, your PR will be merged!

### Pull Request Guidelines

- **Keep PRs focused**: One feature/fix per PR
- **Write clear descriptions**: Explain what and why
- **Update documentation**: If you change behavior
- **Add tests**: For new functionality
- **Keep commits clean**: Squash if needed
- **Be responsive**: Reply to review comments promptly

## 🤖 Auto-merge Workflow

To reduce manual overhead, this repository supports an automatic merge workflow.

### How to Use Auto-merge

1. **Open a PR** against `main` with focused changes (one concern per PR)
2. **Ensure CI passes**: Build, unit tests, and E2E tests must be green
3. **Add the `automerge` label**: GitHub Actions will attempt to merge automatically
4. **Wait for checks**: Once all checks pass, the PR will be merged

### Auto-merge Requirements

- ✅ All CI checks must pass
- ✅ Branch must be up-to-date with `main`
- ✅ No merge conflicts
- ✅ Required approvals met (if configured)

### Notes

- Branch protection rules still apply
- Maintainers can manually merge if auto-merge fails
- Remove the label if you want to prevent auto-merge

## 🆘 Getting Help

- **Issues**: Open a GitHub issue for bugs or feature requests
- **Discussions**: Use GitHub Discussions for questions
- **Documentation**: Check the `docs/` folder for detailed guides

## 📝 License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

Thank you for contributing to Actual MCP Server! 🎉
