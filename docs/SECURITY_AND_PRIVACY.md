# Security & Privacy

**Project:** Actual MCP Server  
**Version:** 0.4.25  
**Purpose:** Define security policies, privacy practices, and incident response  
**Last Updated:** 2026-03-03

---

## 🎯 Purpose

This document establishes **security policies and privacy practices** for the Actual MCP Server. It defines how we protect user data, secure the system, and handle security incidents.

---

## 🔐 Authentication & Authorization

### Authentication Methods

#### 1. **Bearer Token Authentication**

**Status**: ✅ Implemented and recommended

**How it works**:
```yaml
# LibreChat configuration
mcpServers:
  actual-mcp:
    headers:
      Authorization: "Bearer your_secure_token_here"
```

**Token Generation**:
```bash
# Generate secure random token
openssl rand -hex 32

# Or use Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Environment Configuration**:
```bash
MCP_SSE_AUTHORIZATION=your_generated_token
```

**Security Properties**:
- ✅ Stateless - no session management needed
- ✅ Works with HTTP transport
- ✅ Can be rotated without restarting server

#### 2. **OIDC / JWT Authentication**

**Status**: ✅ Implemented (`AUTH_PROVIDER=oidc`)

**How it works**: The server validates JWTs using JWKS from the OIDC issuer.
No PKCE flow runs on the server — the MCP client (e.g., LibreChat) handles the OAuth code exchange.

**Configuration**:
```bash
AUTH_PROVIDER=oidc
OIDC_ISSUER=https://sso.yourdomain.com
OIDC_RESOURCE=your-client-id          # must match 'aud' claim in JWT
OIDC_SCOPES=                          # leave empty for Casdoor (no scope claim)
AUTH_BUDGET_ACL=alice@example.com:budget-uuid-1
```

**Casdoor compatibility**: Casdoor auth-code flow JWTs omit the `scope` claim.
Set `OIDC_SCOPES=` (empty string) so the server enforces no scope requirements and logs `Scopes required: (none)`.

**Per-user Budget ACL** (`AUTH_BUDGET_ACL`):
```
# Format: principal:budget-sync-id (comma-separated)
AUTH_BUDGET_ACL=alice@example.com:aaa-bbb-ccc,group:admins:ddd-eee-fff
```
Principals are matched against JWT claims `email`, `sub`, and `groups`.
If `AUTH_BUDGET_ACL` is not set, all authenticated users access the single configured budget.

**Security Properties**:
- ✅ JWKS-validated JWT — cryptographically verified
- ✅ Per-user budget isolation via `AUTH_BUDGET_ACL`
- ✅ Compatible with Casdoor v2.13, Keycloak, Auth0
- ✅ Group-based access control
- ⚠️ Requires OIDC issuer reachable from MCP server

#### 3. **Password-Based (Actual Budget)**

**Purpose**: Authenticate with Actual Budget server

**Configuration**:
```bash
ACTUAL_PASSWORD=your_actual_budget_password
```

**Security**:
- ✅ Stored in environment variables
- ✅ Never logged or exposed
- ✅ Supports Docker secrets
- ❌ Cannot use OAuth/JWT (Actual Budget limitation)

### Authorization Model

**Default** (`AUTH_PROVIDER=none`): Single-user, full access

**OIDC mode** (`AUTH_PROVIDER=oidc`): Per-user budget ACL via `AUTH_BUDGET_ACL`

**All authenticated users can**:
- Read all financial data
- Modify all transactions
- Delete accounts and budgets
- Access all tools

**With `AUTH_BUDGET_ACL` configured**:
- Each user is mapped to a specific budget sync ID
- Users can only access their own budget
- Group principals (`group:admins`) give shared access
- Suitable for household or small-team deployments

**Without `AUTH_BUDGET_ACL`**:
- All authenticated users share the single configured budget
- Suitable for personal use

---

## 🛡️ Data Protection

### Data at Rest

#### Budget Data Cache

**Location**: `MCP_BRIDGE_DATA_DIR` (default: `./actual-data`)

**Contents**: SQLite database with all budget data

**Protection**:
- ✅ Local filesystem permissions (0600 recommended)
- ✅ Not exposed via API
- ✅ Can be encrypted at filesystem level (LUKS, FileVault)
- ❌ No application-level encryption (relies on OS)

**Recommendation**:
```bash
# Set restrictive permissions
chmod 700 ./actual-data
chown $USER:$USER ./actual-data

# Or use encrypted volume
# Linux: LUKS
# macOS: FileVault
# Windows: BitLocker
```

#### Log Files

**Location**: `MCP_BRIDGE_LOG_DIR` (default: `./logs`)

**Risk**: May contain sensitive data in error messages

**Protection**:
- ✅ File permissions (0600)
- ✅ Log rotation with retention limits
- ⚠️ Sanitization needed (ongoing improvement)

**Best Practices**:
```bash
# Restrict log file permissions
chmod 600 ./logs/*.log

# Regular cleanup
find ./logs -type f -mtime +30 -delete
```

### Data in Transit

#### HTTPS/TLS

**Status**: ✅ Fully supported

**Configuration**:
```bash
MCP_ENABLE_HTTPS=true
MCP_HTTPS_CERT=/app/certs/cert.pem
MCP_HTTPS_KEY=/app/certs/key.pem
```

**Certificate Options**:
1. **Self-signed** (development)
   ```bash
   openssl req -x509 -newkey rsa:4096 -nodes \
     -keyout key.pem -out cert.pem -days 365 \
     -subj "/CN=your-server-ip"
   ```

2. **Let's Encrypt** (production)
   ```bash
   certbot certonly --standalone -d your-domain.com
   ```

3. **CA-signed certificate** (enterprise)

**Security Properties**:
- ✅ Encrypts all traffic between client and server
- ✅ Protects Bearer tokens in transit
- ✅ Prevents man-in-the-middle attacks
- ✅ Required for production deployments

#### Connection to Actual Budget

**Protocol**: HTTP or HTTPS (configurable)

**Security**:
- ⚠️ Often unencrypted (local deployment)
- ✅ Password transmitted securely via `@actual-app/api`
- ✅ Can use HTTPS if Actual Budget server supports it

**Recommendation**: Deploy Actual Budget and MCP server on same network/host

---

## 🔒 Secure Coding Practices

### Secrets Management

#### ✅ DO

**Use environment variables**:
```typescript
const password = process.env.ACTUAL_PASSWORD;
```

**Validate with Zod**:
```typescript
const configSchema = z.object({
  ACTUAL_PASSWORD: z.string().min(1)
});
```

#### ❌ DON'T

**Hardcode secrets**:
```typescript
// NEVER DO THIS
const password = "my-secret-password";
```

**Log secrets**:
```typescript
// NEVER DO THIS
logger.info(`Password: ${password}`);
```

**Commit secrets**:
```bash
# NEVER DO THIS
git add .env
git commit -m "Added config"
```

### Input Validation

#### All User Inputs Must Be Validated

**Using Zod schemas**:
```typescript
const schema = z.object({
  accountId: z.string().uuid(),
  amount: z.number().int(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
});

// Validation happens automatically in tools
```

**SQL Injection Prevention**:
- ✅ Use parameterized queries (Actual Budget API handles this)
- ❌ Never concatenate user input into SQL

**Path Traversal Prevention**:
- ✅ Validate file paths
- ✅ Use `path.resolve()` and check prefix
- ❌ Never directly use user input in file operations

### Error Handling

#### ✅ DO

**Provide helpful but not revealing errors**:
```typescript
throw new Error('Account not found');  // Good
```

**Log detailed errors securely**:
```typescript
logger.error('Account access failed', { 
  accountId, 
  userId,
  // Don't log passwords or tokens
});
```

#### ❌ DON'T

**Leak system information**:
```typescript
// NEVER DO THIS
throw new Error(`Database connection failed: ${dbConnectionString}`);
```

**Expose stack traces to users**:
```typescript
// NEVER DO THIS
return { error: error.stack };
```

---

## 🤖 AI Agent Security Rules

### Mandatory Rules for AI Agents

1. **Never expose secrets**
   - ❌ Don't log passwords, tokens, API keys
   - ❌ Don't include secrets in error messages
   - ❌ Don't commit secrets to git

2. **Never send private data externally**
   - ❌ Don't call external APIs with user data
   - ❌ Don't include financial data in AI prompts
   - ❌ Don't share credentials outside secure environment

3. **Use principle of least privilege**
   - ✅ Only access files necessary for the task
   - ✅ Don't modify files outside project scope
   - ✅ Request permission for sensitive operations

4. **Validate before executing**
   - ✅ Check input types and ranges
   - ✅ Sanitize user-provided data
   - ✅ Use prepared statements, never string concatenation

5. **Follow secure coding practices**
   - ✅ Use environment variables for secrets
   - ✅ Validate all inputs with Zod
   - ✅ Handle errors without leaking information

### Security Review Checklist

Before committing code that touches:

**Authentication**:
- [ ] No hardcoded tokens or passwords
- [ ] Secrets from environment variables only
- [ ] Error messages don't leak credentials

**Database/API Access**:
- [ ] All inputs validated
- [ ] No SQL injection vectors
- [ ] Error messages don't leak schema

**File Operations**:
- [ ] Path traversal prevented
- [ ] File permissions checked
- [ ] No arbitrary file access

**Logging**:
- [ ] No secrets in logs
- [ ] PII properly redacted
- [ ] Debug logs disabled in production

---

## 🔍 Security Testing

### Automated Security Checks

#### 1. **Dependency Auditing**

**Command**:
```bash
npm audit
```

**CI/CD Integration**: Runs on every push

**Policy**:
- **Critical**: Block merge, fix immediately
- **High**: Block merge, fix before next release
- **Moderate**: Track, fix in next patch
- **Low**: Track, fix opportunistically

#### 2. **TypeScript Type Checking**

**Command**:
```bash
npm run build
```

**Purpose**: Catch type errors that could lead to security issues

**CI/CD Integration**: Runs on every push

#### 3. **Secret Scanning**

**Manual check**:
```bash
git grep -i "password\|token\|secret\|api.?key" -- "*.ts" "*.js" "*.json" | grep -v "PASSWORD"
```

**Recommended**: Add `git-secrets` or `truffleHog`

### Manual Security Reviews

**Before major releases**:
1. Review authentication logic
2. Check for exposed secrets
3. Verify input validation
4. Test error handling
5. Review Docker security

**Checklist**: See [Security Review Checklist](#security-review-checklist)

---

## 🚨 Incident Response

### Vulnerability Reporting

**If you discover a security vulnerability:**

1. **DO NOT** open a public GitHub issue
2. **DO** email: [Insert security contact email]
3. **DO** include:
   - Description of vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

**Response Time**:
- **Critical**: 24 hours
- **High**: 72 hours
- **Medium**: 1 week
- **Low**: Best effort

### Responsible Disclosure

**Our commitment**:
- Acknowledge receipt within 24 hours
- Provide status updates every 72 hours
- Credit reporter in release notes (if desired)
- Fix critical issues immediately

**Your responsibilities**:
- Allow reasonable time for fix (90 days)
- Don't exploit vulnerability
- Don't disclose publicly before fix

### Incident Response Procedure

**If security incident occurs:**

1. **Identify** (0-1 hour)
   - Confirm incident is real
   - Assess scope and impact
   - Notify security team

2. **Contain** (1-4 hours)
   - Isolate affected systems
   - Stop data exfiltration
   - Preserve evidence

3. **Remediate** (4-24 hours)
   - Fix vulnerability
   - Deploy patch
   - Verify fix

4. **Recover** (24-72 hours)
   - Restore normal operations
   - Monitor for recurrence
   - Validate security

5. **Learn** (1 week)
   - Post-mortem analysis
   - Update security policies
   - Prevent future incidents

---

## 🔄 Dependency Security Management

### Vulnerability Monitoring

**Automated Scanning:**
- **Tool:** GitHub Dependabot + Renovate Bot
- **Frequency:** Weekly (Mondays at 9 AM UTC)
- **Scope:** All npm dependencies (production + dev)
- **Alert Threshold:** Moderate severity and above

**Manual Audits:**
```bash
# Run security audit
npm audit

# Check for outdated packages with vulnerabilities
npm audit --audit-level=moderate

# Fix vulnerabilities automatically (use with caution)
npm audit fix
```

### Vulnerability Response SLA

| Severity | CVSS Score | Response Time | Action |
|----------|-----------|---------------|--------|
| **Critical** | 9.0-10.0 | 24 hours | Immediate patch, emergency deploy |
| **High** | 7.0-8.9 | 48 hours | Priority patch, next scheduled deploy |
| **Moderate** | 4.0-6.9 | 1 week | Scheduled patch, next sprint |
| **Low** | 0.1-3.9 | 1 month | Routine maintenance update |

### CVE Tracking

**Process:**
1. **Detection:** Dependabot/Renovate alerts on new CVE
2. **Assessment:** Review CVE details, CVSS score, exploitability
3. **Impact Analysis:** Determine if vulnerability affects our usage
4. **Remediation:** Apply patch or workaround
5. **Verification:** Test fix, deploy, monitor
6. **Documentation:** Automated via dependency update workflow

**Recent CVE Resolutions:**
- See CI/CD audit results and GitHub Dependabot alerts for current vulnerability status.
- Run `npm audit` locally at any time for an up-to-date report.

### Dependency Update Policy

**Patch Updates (x.x.X):**
- **Frequency:** Weekly automatic updates
- **Auto-merge:** Yes, after CI passes
- **Review:** Post-merge monitoring
- **Risk:** LOW - bug fixes and security patches only

**Minor Updates (x.X.x):**
- **Frequency:** Bi-weekly
- **Auto-merge:** Dev dependencies only
- **Review:** Required for production dependencies
- **Risk:** MEDIUM - new features, possible deprecations

**Major Updates (X.x.x):**
- **Frequency:** Quarterly or as needed
- **Auto-merge:** Never
- **Review:** Required + breaking change analysis
- **Risk:** HIGH - API changes, behavior changes, migration required

### Dependency Audit Reports

**Automated Audits:**
- Weekly dependency audits (automated via GitHub Actions)
- Continuous security vulnerability scanning (Dependabot)
- Automated dependency updates and PRs
- See `.github/workflows/dependency-update.yml` for automation details
- Breaking change assessments
- Update recommendations and roadmap

**Update Frequency:** Monthly (automated generation via CI/CD)

**Last Audit:** See CI/CD pipeline for current status (automatically audited on every push).
- Run `npm audit` locally to get an up-to-date report at any time.

### Dependency Pinning Strategy

**Production Dependencies:**
- Use caret ranges (`^1.2.3`) for automatic patch updates
- Pin specific versions for problematic packages
- Lock file (`package-lock.json`) committed to git

**Git Dependencies:**
- Pin to specific commit SHA (not branch name)
- Example: `@librechat/api` currently tracks `main` branch (⚠️ unpinned)
- **Recommendation:** Pin to commit SHA for stability

**Version Overrides:**
```json
{
  "overrides": {
    "vulnerable-package": "1.2.3"  // Force specific version tree-wide
  }
}
```

### Supply Chain Security

**Measures:**
1. ✅ Lock file committed (`package-lock.json`)
2. ✅ Automated dependency scanning (Dependabot, Renovate)
3. ✅ CI/CD validation (npm audit in pipeline)
4. ⚠️ Package signatures: Not verified (npm limitation)
5. ⚠️ Subresource Integrity: Not applicable (server-side)

**Best Practices:**
- Review dependency changes in PRs
- Verify package maintainer reputation (npm downloads, GitHub stars)
- Avoid dependencies with excessive transitive deps
- Monitor for typosquatting attempts
- Use npm audit before every release

**Dependency Review Checklist:**
- [ ] Package has > 1M weekly downloads OR established reputation
- [ ] Last update within 6 months (actively maintained)
- [ ] Permissive license (MIT, Apache, ISC, BSD)
- [ ] No open critical security issues
- [ ] Reasonable dependency tree (< 50 transitive deps)
- [ ] TypeScript types available (@types/* or built-in)

---

## 📜 Privacy Policy

### Data Collection

**We collect**:
- Actual Budget server URL (configuration)
- Budget data (cached locally)
- Tool usage metrics (optional)
- Error logs (local only)

**We do NOT collect**:
- Personal identification
- Financial data (stays local)
- Usage patterns (unless metrics enabled)
- IP addresses (unless reverse proxy logs)

### Data Storage

**All data stored locally**:
- Budget cache: `MCP_BRIDGE_DATA_DIR`
- Logs: `MCP_BRIDGE_LOG_DIR`
- No cloud storage
- No external transmission

### Data Retention

**Budget data**: Until manually deleted

**Logs**: 
- Default: 14 days (with rotation)
- Configurable via Winston settings
- Can be disabled entirely

**Metrics**: In-memory only (lost on restart)

### Third-Party Access

**No third-party services**:
- No analytics
- No crash reporting
- No external APIs
- Self-hosted only

### User Rights

**As a user, you can**:
- Access all your data (it's local)
- Export your data (standard Actual Budget export)
- Delete your data (delete cache directory)
- Opt out of metrics (disable observability)

---

## 🔧 Docker Security

### Container Security

**Non-root user**:
```dockerfile
USER node
```

**Minimal attack surface**:
- Alpine base image
- Multi-stage build
- Only production dependencies

**Best practices**:
```bash
# Run with read-only filesystem
docker run --read-only --tmpfs /tmp

# Limit resources
docker run --memory=512m --cpus=1

# Drop capabilities
docker run --cap-drop=ALL
```

### Secrets Management

**Docker secrets (Swarm/Compose)**:
```yaml
secrets:
  actual_password:
    file: ./secrets/password.txt

services:
  mcp:
    environment:
      ACTUAL_PASSWORD: ${ACTUAL_PASSWORD}
```

**Environment variables**:
```bash
# Recommended: pass via .env file or shell environment
docker run -e ACTUAL_PASSWORD=$(cat secrets/password.txt)
```

---

## ✅ Security Compliance

### OWASP Top 10 (2021)

| Risk | Status | Mitigation |
|------|--------|------------|
| **A01 Broken Access Control** | ⚠️ Partial | Bearer token auth, no RBAC |
| **A02 Cryptographic Failures** | ✅ Protected | HTTPS/TLS support |
| **A03 Injection** | ✅ Protected | Zod validation, prepared statements |
| **A04 Insecure Design** | ✅ Protected | Security-first architecture |
| **A05 Security Misconfiguration** | ⚠️ Partial | Default HTTP (users must enable HTTPS) |
| **A06 Vulnerable Components** | ✅ Monitored | npm audit in CI/CD |
| **A07 Auth Failures** | ⚠️ Partial | No rate limiting, no MFA |
| **A08 Data Integrity Failures** | ✅ Protected | Validated inputs, integrity checks |
| **A09 Logging Failures** | ⚠️ Partial | Needs sanitization |
| **A10 SSRF** | ✅ Protected | No user-controlled URLs |

**Overall**: Reasonable security for personal use, needs hardening for multi-user

---

## 🔗 Related Documentation

- [Testing & Reliability](./TESTING_AND_RELIABILITY.md) - Security testing
- [Architecture](./ARCHITECTURE.md) - Technical security design
- [Roadmap](./ROADMAP.md) - Security improvements

---

## ✨ Summary

**Security Posture**: **Good for personal use, needs hardening for production**

**Key Security Features**:
- ✅ Bearer token authentication
- ✅ HTTPS/TLS support
- ✅ Input validation with Zod
- ✅ Secrets in environment variables
- ✅ Non-root Docker container

**Key Security Gaps**:
- ⚠️ No rate limiting
- ⚠️ No audit logging
- ⚠️ No RBAC
- ⚠️ Log sanitization needed

**Recommendation**: 
- **Personal use**: Current security is sufficient
- **Team use**: Add rate limiting and audit logging
- **Enterprise use**: Add RBAC, SIEM integration, compliance auditing

See [ROADMAP.md](./ROADMAP.md) for planned security improvements.
