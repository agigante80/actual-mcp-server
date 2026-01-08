# Changelog

All notable changes to the Actual MCP Server project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Docker E2E Tests** to CI/CD pipeline - Full integration testing with Docker Compose stack

### Changed
- Corrected tool count references from "49 tools" to "51 tools" across all documentation (18+ locations)
- Updated version numbers from v0.1.0 to v0.4.7 in 2 documentation files
- Fixed broken archive link in `.github/copilot-instructions.md`
- Enhanced `.gitignore` with comprehensive backup file patterns (`**/*.backup`, `**/*.old`, `**/*.bak`, `**/*.tmp`)

### Fixed
- Removed obsolete GitHub workflow backup files (ci-cd.yml.backup, ci-cd.yml.old)

## [0.4.7] - 2026-01-08

### Added
- Comprehensive multi-level test plan covering all 51 tools
- Error scenario testing matrix
- Docker E2E tests (11 tests, 10 passing)
- HTTP transport as default (SSE endpoint test skipped)
- **PROJECT_REASSESSMENT_REPORT.md** - Full project audit report (92/100 score)
- **CHANGELOG.md** - Version history tracking

### Changed
- Standardized documentation structure to 9 core files in `/docs/`
- Archived 19 obsolete documentation files to `docs/archive/docs-backup-2026-01-08/`
- Updated TESTING_AND_RELIABILITY.md with comprehensive 6-level test plan
- Switched default transport mode to HTTP (recommended)
- Updated test execution strategy documentation
- Improved test coverage tracking and goals

### Fixed
- Health check initialization logic for connection pool mode
- Docker file permissions for `/app/data` directory
- Account creation test assertion (UUID vs text message)
- SSE endpoint test timeout handling
- Version consistency across all documentation (v0.4.7)
- Tool count accuracy across all documentation (51 tools)

## [0.4.6] - Previous Releases

### Added
- 51 MCP tools covering 82% of Actual Budget API
- 6 exclusive ActualQL-powered search and summary tools
- Session-based connection pooling
- HTTP and SSE transport protocols
- Bearer token authentication
- HTTPS/TLS support
- Comprehensive logging with Winston
- Health check endpoint
- Docker deployment support
- LibreChat and LobeChat compatibility

### Security
- Zod version pinned to 3.25.76 (critical for LibreChat compatibility)
- Environment variable validation
- Secrets management via Docker secrets
- Optional Bearer token authentication

## Version History

For detailed version history prior to standardization, see:
- Git commit history: `git log --oneline`
- GitHub releases: https://github.com/agigante80/actual-mcp-server/releases
- Package.json version field

---

## Semantic Versioning

- **MAJOR** version: Incompatible API changes
- **MINOR** version: Backwards-compatible functionality additions
- **PATCH** version: Backwards-compatible bug fixes

## Release Process

1. Update version in `VERSION` file
2. Update `CHANGELOG.md` with changes
3. Commit changes: `git commit -m "chore: release v0.x.x"`
4. Tag release: `git tag v0.x.x`
5. Push changes: `git push && git push --tags`
6. CI/CD automatically publishes Docker images

---

**Note**: This changelog was standardized on 2026-01-08. Historical entries represent major milestones and may not be comprehensive.
