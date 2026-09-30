# Contributing to Actual MCP Server

Thank you for your interest in contributing! This guide covers how to set up, what to run, and how a change reaches a release.

If you work with a coding agent (Codex, Copilot, Cursor, Claude Code, Gemini CLI and others), point it at [AGENTS.md](../AGENTS.md) at the repository root. That file holds the technical rules and the validation commands, and most agents read it automatically. Humans should read it too: this guide does not repeat it.

## 📋 Table of Contents

- [Code of Conduct](#-code-of-conduct)
- [Ways to Contribute](#-ways-to-contribute)
- [Development Setup](#-development-setup)
- [Making a Change](#-making-a-change)
- [Testing](#-testing)
- [Submitting a Pull Request](#-submitting-a-pull-request)
- [How Your Change Reaches a Release](#-how-your-change-reaches-a-release)
- [Getting Help](#-getting-help)

## 🤝 Code of Conduct

Be respectful and inclusive, keep feedback constructive, and put the community's interests first.

## 💡 Ways to Contribute

- 🐛 Report a bug or 💡 suggest a feature through the [issue templates](https://github.com/agigante80/actual-mcp-server/issues/new/choose). The templates ask only for what you know; the maintainer adds the test plan.
- 📝 Improve documentation.
- 🔧 Fix a bug or implement a feature.
- 🧪 Add tests.

Security vulnerabilities go through [SECURITY.md](SECURITY.md), never a public issue.

## 💻 Development Setup

### Prerequisites

- **Node.js 22 or newer** (the server refuses to start on an older version) and npm 10+
- **Git**
- **Docker**, optional: needed only for the Docker E2E suite and the local full-stack run
- An Actual Budget server, only if you want to run against real data

### 1. Fork and clone

```bash
git clone https://github.com/YOUR_USERNAME/actual-mcp-server.git
cd actual-mcp-server
git remote add upstream https://github.com/agigante80/actual-mcp-server.git
```

### 2. Install and build

```bash
npm ci
npm run build
```

### 3. Configure (only to run against a real server)

```bash
cp .env.example .env
# Set ACTUAL_SERVER_URL, ACTUAL_PASSWORD and ACTUAL_BUDGET_SYNC_ID (Actual: Settings, Advanced, Sync ID).
```

Every variable is documented in [docs/CONFIGURATION.md](../docs/CONFIGURATION.md).

### 4. Run

```bash
npm run dev -- --http                    # HTTP transport; rebuilds first and enables debug logging
npm run dev -- --stdio                   # stdio transport (Claude Desktop and similar)
npm run dev -- --test-actual-connection  # check the Actual connection and exit
```

## 🔄 Making a Change

Branch from **`develop`**, which is where all work lands. `main` only moves when a release is cut.

```bash
git fetch upstream
git checkout -b feat/short-description upstream/develop
```

Branch prefixes: `feat/`, `fix/`, `docs/`, `refactor/`, `chore/`.

### Project structure

```
actual-mcp-server/
├── src/
│   ├── index.ts              # Entry point and CLI flags
│   ├── config.ts             # Environment validation (Zod)
│   ├── actualToolsManager.ts # Tool registry and dispatch
│   ├── lib/                  # Adapter, connection pool, shared schemas, logging
│   ├── server/               # HTTP and stdio transports
│   └── tools/                # MCP tool definitions (82 tools)
├── types/                    # Type declarations (do not edit)
├── tests/
│   ├── unit/                 # Plain Node unit tests (the test:unit-js chain)
│   ├── e2e/                  # Playwright E2E, run inside Docker
│   └── manual/               # Integration runner against a live server
├── scripts/                  # Build, drift-guard and release scripts (see scripts/README.md)
├── docs/                     # Documentation
└── .github/                  # Workflows, issue and PR templates, path-scoped instructions
```

The architecture and the rules that matter (every Actual call through the adapter, amounts in integer cents, dates as `YYYY-MM-DD`, no `console.*`) are in [AGENTS.md](../AGENTS.md). Adding a tool has its own checklist: [docs/NEW_TOOL_CHECKLIST.md](../docs/NEW_TOOL_CHECKLIST.md).

### Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/) and reference the issue:

```
feat(tools): add support for payee merging (#123)
fix(adapter): handle null values in transaction import (#124)
docs: correct the stdio setup steps
```

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `perf`, `chore`.

## 🧪 Testing

Run the full validation sequence from [AGENTS.md](../AGENTS.md#validate-before-you-commit) before opening a pull request. The core of it:

```bash
npm run build
npm run verify-tools
npm run test:adapter
npm run test:unit-js
npm run knip
npm audit --audit-level=moderate
```

There is no `lint` or `format` script: the TypeScript build is the type check, and `knip` reports dead code.

- **Unit tests** are plain Node scripts in `tests/unit/`. Add a new file to the `test:unit-js` chain in `package.json`, or it never runs.
- **End-to-end tests** for the tool surface go in `tests/e2e/docker-all-tools.e2e.spec.ts`, using the fixtures in `tests/e2e/fixtures.ts`. Run them with `npm run test:e2e:docker:full` (needs Docker).
- Every new behaviour needs a positive and a negative test.

The test layers and every test file are described in [docs/TESTING_AND_RELIABILITY.md](../docs/TESTING_AND_RELIABILITY.md).

## 📤 Submitting a Pull Request

1. Rebase on the latest `develop`:
   ```bash
   git fetch upstream
   git rebase upstream/develop
   ```
2. Push to your fork and open a pull request **against `develop`**.
3. Fill in the pull request template and link the issue.
4. Make sure CI passes, and answer review comments.

Keep a pull request to one concern, update the docs your change affects, and do not add dependencies without saying why.

## 🚀 How Your Change Reaches a Release

The maintainer integrates every change through the same pipeline: a gated ticket, review, a version bump and a full live test run over both transports. Because of that, **your pull request may be reimplemented on `develop` and then closed as superseded instead of being merged**. That is the normal path, not a rejection. Your authorship is kept as a `Co-Authored-By` trailer on the commit, and you are credited in the release notes. The change reaches `main`, npm and Docker Hub in the next release.

## 🆘 Getting Help

- **Questions, bugs and ideas**: open a [GitHub issue](https://github.com/agigante80/actual-mcp-server/issues).
- **Documentation**: the [docs/](../docs/) folder, starting from [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md).

## 📝 License

By contributing, you agree that your contributions are licensed under the [MIT License](../LICENSE).

---

Thank you for contributing to Actual MCP Server! 🎉
