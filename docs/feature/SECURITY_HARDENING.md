# Security Hardening

**Status:** Planned — v0.5.x (Q2 2026)  
**Priority:** 🔴 High  
**Effort:** ~1 week  
**Blocker:** None

---

## Overview

Harden the HTTP transport layer against common web attack vectors: rate limiting, request sanitization, CSRF protection, and improved error message safety.

## Scope

### 1. Rate Limiting
- Add `express-rate-limit` middleware
- Default: 100 req/min per IP, configurable via env
- Return `429 Too Many Requests` with `Retry-After` header

### 2. Request / Response Sanitization
- Strip or escape unexpected fields before passing to Actual API
- Sanitize error messages to prevent information leakage

### 3. CSRF Protection
- Add CSRF token validation for mutation endpoints (POST/PUT/DELETE)
- Exempt `/.well-known/*` and `/health`

### 4. Security Headers
- Add `helmet` middleware: `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`, `Content-Security-Policy`

## New Dependencies

```bash
npm install express-rate-limit helmet
```

## Success Criteria

- [ ] OWASP Top 10 findings addressed
- [ ] No critical/high findings in `npm audit`
- [ ] Rate limiting tested under load (1000 req/s)
- [ ] All error messages audited for sensitive data leakage

## References

- [express-rate-limit](https://www.npmjs.com/package/express-rate-limit)
- [helmet](https://www.npmjs.com/package/helmet)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [`src/server/httpServer.ts`](../../src/server/httpServer.ts)
- [`src/config.ts`](../../src/config.ts)
