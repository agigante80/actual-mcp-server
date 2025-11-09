# Security Policy

## Supported Versions

We release patches for security vulnerabilities in the following versions:

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |
| < 0.1.0 | :x:                |

## Reporting a Vulnerability

We take the security of Actual MCP Server seriously. If you discover a security vulnerability, please report it responsibly.

### 🔒 How to Report

**Please do NOT report security vulnerabilities through public GitHub issues.**

Instead, please report security issues to:

**Email**: security@example.com (replace with your actual email)

Or use GitHub's private vulnerability reporting:

1. Go to the repository's [Security tab](https://github.com/agigante80/actual-mcp-server/security)
2. Click "Report a vulnerability"
3. Fill out the vulnerability report form

### 📋 What to Include

Please include the following information in your report:

- **Type of vulnerability** (e.g., SQL injection, XSS, authentication bypass)
- **Full path** of affected source file(s)
- **Location** of the affected source code (tag/branch/commit or direct URL)
- **Step-by-step instructions** to reproduce the issue
- **Proof-of-concept** or exploit code (if possible)
- **Impact** of the vulnerability
- **Potential fixes** (if you have suggestions)

### ⏱️ Response Timeline

- **Initial Response**: Within 48 hours
- **Status Update**: Within 7 days
- **Fix Timeline**: Depends on severity
  - **Critical**: 1-7 days
  - **High**: 7-30 days
  - **Medium**: 30-90 days
  - **Low**: Best effort

### 🎯 Vulnerability Disclosure Process

1. **You report** the vulnerability privately
2. **We acknowledge** your report within 48 hours
3. **We investigate** and confirm the vulnerability
4. **We develop** a fix in a private repository
5. **We notify** you when the fix is ready
6. **We release** the fix and security advisory
7. **We credit** you in the advisory (if desired)

### 🏆 Recognition

We will publicly acknowledge security researchers who responsibly disclose vulnerabilities (unless you prefer to remain anonymous).

## Security Best Practices

### For Users

#### Production Deployment

1. **Use Docker Secrets** or Kubernetes Secrets for sensitive data:
   ```bash
   # Don't use environment variables for passwords
   # Use Docker secrets instead
   echo "your_password" > secrets/actual_password.txt
   chmod 600 secrets/actual_password.txt
   ```

2. **Enable HTTPS** with valid TLS certificates:
   ```yaml
   # Use reverse proxy (nginx, Traefik) with Let's Encrypt
   # Never expose MCP server directly without HTTPS
   ```

3. **Set Authorization Tokens**:
   ```bash
   # Generate strong random token
   MCP_SSE_AUTHORIZATION=$(openssl rand -hex 32)
   ```

4. **Restrict Network Access**:
   ```bash
   # Use firewall rules to limit access
   # Example: Only allow from LibreChat server IP
   iptables -A INPUT -p tcp --dport 3000 -s 10.0.0.5 -j ACCEPT
   iptables -A INPUT -p tcp --dport 3000 -j DROP
   ```

5. **Regular Updates**:
   ```bash
   # Keep dependencies updated
   npm audit
   npm audit fix
   
   # Pull latest Docker image
   docker pull ghcr.io/agigante80/actual-mcp-server:latest
   ```

#### File Permissions

```bash
# Environment files should be read-only for owner
chmod 600 .env
chmod 600 secrets/*.txt

# Verify permissions
ls -la .env secrets/
# Should show: -rw------- (600)
```

#### Environment Variables

```bash
# ❌ DON'T: Commit .env files to git
git add .env  # BAD!

# ✅ DO: Use .env.example as template
git add .env.example  # OK

# ✅ DO: Add .env to .gitignore
echo ".env" >> .gitignore
```

### For Developers

#### Secure Coding Practices

1. **Input Validation**: Always validate user input with Zod schemas
   ```typescript
   const InputSchema = z.object({
     id: z.string().uuid(),
     amount: z.number().int().positive(),
   });
   ```

2. **SQL Injection Prevention**: Use parameterized queries (Actual Budget API handles this)

3. **Authentication**: Never log or expose passwords
   ```typescript
   // ❌ BAD
   logger.debug('Password:', password);
   
   // ✅ GOOD
   logger.debug('Authentication successful');
   ```

4. **Error Handling**: Don't expose sensitive info in errors
   ```typescript
   // ❌ BAD
   return { error: `Database error: ${dbError.message}` };
   
   // ✅ GOOD
   logger.error('Database error:', dbError);
   return { error: 'An internal error occurred' };
   ```

5. **Dependencies**: Keep dependencies up-to-date
   ```bash
   npm audit
   npm outdated
   ```

#### Code Review Checklist

- [ ] No hardcoded credentials
- [ ] Input validation with Zod
- [ ] Error messages don't leak sensitive data
- [ ] Logging doesn't contain passwords/tokens
- [ ] Dependencies are up-to-date
- [ ] Tests cover security-critical paths

## Known Security Considerations

### Current Security Model

1. **No Built-in Authentication**: The MCP server doesn't implement user authentication
   - ⚠️ **Impact**: Anyone with network access can use the server
   - ✅ **Mitigation**: Use reverse proxy with authentication (nginx + Basic Auth, OAuth2 Proxy)
   - ✅ **Mitigation**: Use `MCP_SSE_AUTHORIZATION` token for SSE transport
   - ✅ **Mitigation**: Firewall rules to restrict access

2. **Direct Actual Budget Access**: Server has full access to Actual Budget
   - ⚠️ **Impact**: All operations are allowed (read/write/delete)
   - ✅ **Mitigation**: Run with least-privilege Actual Budget user (if supported in future)
   - ✅ **Mitigation**: Regular backups of Actual Budget data

3. **No Rate Limiting**: No built-in rate limiting
   - ⚠️ **Impact**: Potential for abuse or DoS
   - ✅ **Mitigation**: Use reverse proxy with rate limiting (nginx limit_req)
   - ✅ **Mitigation**: Internal concurrency limiting (5 concurrent requests)

4. **Local Data Storage**: Budget data cached in SQLite
   - ⚠️ **Impact**: Sensitive financial data on disk
   - ✅ **Mitigation**: Encrypt Docker volumes or VM disks
   - ✅ **Mitigation**: Restrict file system permissions
   - ✅ **Mitigation**: Regular backups with encryption

### Future Security Enhancements

- [ ] **Read-only mode**: Option to disable write operations
- [ ] **API key authentication**: Built-in token validation
- [ ] **Rate limiting**: Per-client request throttling
- [ ] **Audit logging**: Complete operation history
- [ ] **Role-based access**: Different permission levels
- [ ] **Data encryption**: Encrypt local SQLite database

## Security Advisories

We will publish security advisories for confirmed vulnerabilities:

- **GitHub Security Advisories**: [View advisories](https://github.com/agigante80/actual-mcp-server/security/advisories)
- **Release Notes**: Security fixes documented in releases

## Compliance

### Data Privacy

- **No External Connections**: Data stays between MCP server and Actual Budget
- **No Telemetry**: We don't collect usage data or analytics
- **GDPR Compatible**: All data is user-controlled and local

### Industry Standards

We follow security best practices from:

- **OWASP Top 10**: Web application security risks
- **CWE Top 25**: Most dangerous software weaknesses
- **NIST Cybersecurity Framework**: Security standards

## Security Contact

For security-related questions (not vulnerability reports):

- **GitHub Discussions**: [Security category](https://github.com/agigante80/actual-mcp-server/discussions/categories/security)
- **Email**: security@example.com (replace with your actual email)

## Hall of Fame

We thank the following researchers for responsibly disclosing vulnerabilities:

| Researcher | Vulnerability | Severity | Reported | Fixed |
|------------|---------------|----------|----------|-------|
| -          | -             | -        | -        | -     |

*No vulnerabilities reported yet.*

---

**Last Updated**: November 2025
