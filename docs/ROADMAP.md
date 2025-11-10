# Roadmap

**Project:** Actual MCP Server  
**Version:** 0.1.0  
**Purpose:** Future improvements and feature planning  
**Last Updated:** 2025-11-11

---

## 🎯 Vision

Transform the Actual MCP Server from a **functional bridge** into a **production-grade, enterprise-ready platform** for AI-powered financial management.

---

## 📊 Roadmap Overview

### Current State (v0.1.0)

- ✅ **42 MCP tools** covering ~80% of Actual Budget API
- ✅ **LibreChat verified** - all tools working
- ✅ **Production-ready** - Docker images, CI/CD, HTTPS
- ✅ **Security-conscious** - Bearer auth, input validation
- ✅ **Well-documented** - Comprehensive documentation ecosystem

### Target State (v1.0.0)

- 🎯 **100% API coverage** - All Actual Budget features
- 🎯 **Enterprise-grade security** - RBAC, audit logging, rate limiting
- 🎯 **Advanced features** - Reports, goals, multi-budget workflows
- 🎯 **Production-hardened** - Load tested, highly available
- 🎯 **Multi-client support** - LibreChat, Claude Desktop, custom clients

---

## 🚀 Short-Term (1-3 Months)

### 🔴 High Priority

#### 1. **Complete API Coverage (4 tools)**
**Target**: v0.2.0 (December 2025)

**Features**:
- [ ] Implement `actual_schedules_get`
- [ ] Implement `actual_schedules_create`
- [ ] Implement `actual_schedules_update`
- [ ] Implement `actual_schedules_delete`

**Impact**: Achieves 100% Actual Budget API coverage

**Technical Approach**:
- Research internal Actual API access
- Use `send()` method for schedule operations
- Add comprehensive tests for schedule tools

**Success Criteria**:
- All 46 tools implemented
- LibreChat integration verified
- Documentation updated

---

#### 2. **Security Hardening**
**Target**: v0.2.0 (December 2025)

**Features**:
- [ ] Add rate limiting middleware
- [ ] Implement request/response sanitization
- [ ] Add CSRF protection for HTTP transport
- [ ] Improve error messages (no information leakage)

**Impact**: Production-ready security posture

**Technical Approach**:
- Use `express-rate-limit` for rate limiting
- Create sanitization middleware
- Add CSRF token validation
- Audit all error messages

**Success Criteria**:
- No high/critical security audit findings
- Rate limiting tested under load
- OWASP Top 10 compliance improved

---

#### 3. **Improved Error Messages**
**Target**: v0.2.0 (December 2025)

**Features**:
- [ ] Actionable error messages for all tools
- [ ] Suggest next steps in errors
- [ ] Link to relevant list tools
- [ ] Provide example values

**Impact**: Better user experience

**Example**:
```typescript
// Before
throw new Error('Account not found');

// After
throw new Error(
  'Account "abc-123" not found. ' +
  'Use actual_accounts_list to see available accounts. ' +
  'Example: {"id": "uuid-456", "name": "Checking"}'
);
```

**Success Criteria**:
- All tools have helpful error messages
- User testing shows improved experience
- Documentation includes error handling guide

---

#### 4. **Multi-Budget Switching**
**Target**: v0.2.0 (December 2025)

**Features**:
- [ ] Add `actual_budgets_switch` tool
- [ ] Seamless switching without reconnection
- [ ] Preserve tool state across switches
- [ ] Update cache management

**Impact**: Better multi-budget support

**Technical Approach**:
- Disconnect from current budget
- Connect to new budget
- Update internal state
- Clear/update cache

**Success Criteria**:
- Switch budgets in <5 seconds
- No data loss during switch
- LibreChat integration verified

---

### 🟠 Medium Priority

#### 5. **Integration Test Suite**
**Target**: v0.3.0 (January 2026)

**Features**:
- [ ] Test multi-step workflows
- [ ] Test error propagation
- [ ] Test concurrent operations
- [ ] Test transaction boundaries

**Impact**: Higher confidence in refactoring

**Technical Approach**:
- Use `@playwright/test` for integration tests
- Create test fixtures for common scenarios
- Add to CI/CD pipeline

**Success Criteria**:
- 50%+ integration test coverage
- All critical workflows tested
- CI/CD integration complete

---

#### 6. **Performance Optimization**
**Target**: v0.3.0 (January 2026)

**Features**:
- [ ] Add caching layer for read-heavy operations
- [ ] Optimize transaction filtering
- [ ] Implement connection pooling
- [ ] Add pagination for large result sets

**Impact**: Better performance for power users

**Technical Approach**:
- Use `node-cache` for in-memory caching
- Optimize filtering algorithms
- Profile with real-world data
- Add pagination API

**Success Criteria**:
- 50% reduction in response time for cached operations
- Handle 10k+ transactions efficiently
- Load testing passes

---

## 🔄 Medium-Term (3-6 Months)

### 🟠 Recommended

#### 7. **Report Generation Tools**
**Target**: v0.4.0 (March 2026)

**Features**:
- [ ] `actual_reports_spending_by_category`
- [ ] `actual_reports_income_vs_expenses`
- [ ] `actual_reports_net_worth_trend`
- [ ] `actual_reports_budget_vs_actual`
- [ ] Custom date ranges and grouping

**Impact**: High user value - AI can generate financial reports

**Technical Approach**:
- Use `query_run` internally for complex queries
- Format results for easy consumption
- Support multiple output formats (JSON, CSV)

**Success Criteria**:
- 5+ report tools implemented
- LibreChat can generate reports conversationally
- Documentation includes report examples

---

#### 8. **Goal Tracking Tools**
**Target**: v0.4.0 (March 2026)

**Features**:
- [ ] `actual_goals_list`
- [ ] `actual_goals_create`
- [ ] `actual_goals_update`
- [ ] `actual_goals_get_progress`
- [ ] `actual_goals_delete`

**Impact**: Complete feature parity with Actual Budget UI

**Technical Approach**:
- Wait for upstream API support OR
- Implement using custom queries
- Track progress over time

**Success Criteria**:
- Goal management via AI conversations
- Progress tracking works correctly
- Integration with budget tools

---

#### 9. **Advanced Search & Filtering**
**Target**: v0.4.0 (March 2026)

**Features**:
- [ ] Full-text search across transactions
- [ ] Natural language date ranges ("last month", "Q1 2025")
- [ ] Fuzzy payee matching
- [ ] Smart category suggestions

**Impact**: Better user experience for large datasets

**Technical Approach**:
- Use SQLite FTS5 for full-text search
- Parse natural language dates with `date-fns`
- Implement fuzzy matching algorithm
- Use ML for category suggestions (optional)

**Success Criteria**:
- Search 100k+ transactions in <1 second
- Natural language queries work
- High relevance in search results

---

#### 10. **Enhanced Observability**
**Target**: v0.5.0 (May 2026)

**Features**:
- [ ] Detailed Prometheus metrics (latency percentiles, queue depth)
- [ ] Enhanced health check endpoint
- [ ] Request tracing with correlation IDs
- [ ] Log aggregation support (structured JSON logs)

**Impact**: Better production monitoring

**Technical Approach**:
- Extend Prometheus metrics
- Add OpenTelemetry (optional)
- Implement request ID middleware
- Structure logs for ELK/Loki

**Success Criteria**:
- Full observability stack deployed
- Dashboards created (Grafana)
- Alerting configured

---

## 🌟 Long-Term (6+ Months)

### 🟢 Future Enhancements

#### 11. **Multi-Client Support**
**Target**: v0.6.0 (August 2026)

**Features**:
- [ ] Claude Desktop integration
- [ ] Custom MCP client SDKs
- [ ] REST API wrapper (in addition to MCP)
- [ ] GraphQL API (optional)

**Impact**: Broader ecosystem adoption

**Technical Approach**:
- Test with Claude Desktop
- Create SDK examples (Python, JavaScript)
- Add REST endpoints alongside MCP
- Consider GraphQL layer

**Success Criteria**:
- Multiple clients verified
- SDK documentation complete
- Examples for each client type

---

#### 12. **Enterprise Features**
**Target**: v0.7.0 (November 2026)

**Features**:
- [ ] Role-Based Access Control (RBAC)
- [ ] Audit logging
- [ ] Multi-tenant support
- [ ] SSO/SAML integration
- [ ] Compliance reporting (SOC 2, GDPR)

**Impact**: Enterprise-ready platform

**Technical Approach**:
- Design permission system
- Implement audit log storage
- Add tenant isolation
- Integrate SSO providers

**Success Criteria**:
- RBAC fully functional
- Audit logs comprehensive
- Multi-tenant tested
- Compliance certified

---

#### 13. **High Availability & Scalability**
**Target**: v0.8.0 (February 2027)

**Features**:
- [ ] Horizontal scaling support
- [ ] Load balancing
- [ ] Redis-backed caching
- [ ] Session management
- [ ] Kubernetes Helm charts

**Impact**: Support large-scale deployments

**Technical Approach**:
- Stateless server design
- External cache (Redis)
- Session store (Redis)
- K8s deployment templates

**Success Criteria**:
- Scale to 1000+ concurrent users
- <100ms p95 latency
- 99.9% uptime

---

#### 14. **AI/ML Enhancements**
**Target**: v0.9.0 (May 2027)

**Features**:
- [ ] Spending anomaly detection
- [ ] Category auto-suggestion (ML-based)
- [ ] Budget recommendation engine
- [ ] Fraud detection
- [ ] Predictive analytics

**Impact**: Intelligent financial insights

**Technical Approach**:
- Train models on transaction data
- Use lightweight models (TensorFlow.js)
- Privacy-preserving ML (on-device)

**Success Criteria**:
- High accuracy (>90%)
- Fast inference (<100ms)
- Privacy-compliant

---

#### 15. **Advanced Integrations**
**Target**: v1.0.0 (August 2027)

**Features**:
- [ ] Plaid integration (bank connectivity)
- [ ] Zapier/IFTTT workflows
- [ ] Webhook support
- [ ] Email/SMS notifications
- [ ] Mobile app API

**Impact**: Complete ecosystem

**Technical Approach**:
- Integrate external APIs
- Build webhook system
- Add notification service

**Success Criteria**:
- Major integrations working
- Webhook reliability >99%
- Notification delivery <1 minute

---

## 🎯 Version Milestones

### v0.2.0 - "Complete & Secure" (December 2025)
- ✅ 100% API coverage (46 tools)
- ✅ Security hardening
- ✅ Improved error messages
- ✅ Multi-budget switching

### v0.3.0 - "Performance & Quality" (January 2026)
- ✅ Integration test suite
- ✅ Performance optimization
- ✅ Caching layer
- ✅ Connection pooling

### v0.4.0 - "Feature Complete" (March 2026)
- ✅ Report generation tools
- ✅ Goal tracking tools
- ✅ Advanced search
- ✅ Natural language queries

### v0.5.0 - "Production Grade" (May 2026)
- ✅ Enhanced observability
- ✅ Load testing
- ✅ High availability
- ✅ Documentation complete

### v0.6.0 - "Multi-Client" (August 2026)
- ✅ Claude Desktop support
- ✅ Custom client SDKs
- ✅ REST API wrapper
- ✅ Example applications

### v1.0.0 - "Enterprise Ready" (August 2027)
- ✅ RBAC & multi-tenant
- ✅ Advanced integrations
- ✅ ML/AI features
- ✅ Full ecosystem

---

## 🤖 AI Assistance Opportunities

AI agents can help with:

### High-Impact AI Tasks

1. **Test Writing** (High priority)
   - Generate unit tests for all tools
   - Create integration test scenarios
   - Write E2E test cases

2. **Documentation** (High priority)
   - Keep docs in sync with code
   - Generate API examples
   - Create troubleshooting guides

3. **Code Quality** (Medium priority)
   - Refactor long functions
   - Extract duplicated code
   - Improve error handling

4. **Security Audits** (Medium priority)
   - Scan for vulnerabilities
   - Review authentication logic
   - Check for leaked secrets

5. **Performance Analysis** (Low priority)
   - Profile code execution
   - Identify bottlenecks
   - Suggest optimizations

---

## 🔄 Quarterly Reviews

### Q4 2025 (October-December)
**Focus**: Complete API coverage & security

**Deliverables**:
- v0.2.0 release
- 46 tools implemented
- Security audit passed
- Documentation updated

### Q1 2026 (January-March)
**Focus**: Performance & quality

**Deliverables**:
- v0.3.0 & v0.4.0 releases
- Integration tests complete
- Performance benchmarks met
- Report tools implemented

### Q2 2026 (April-June)
**Focus**: Production readiness

**Deliverables**:
- v0.5.0 release
- Observability complete
- Load testing passed
- High availability verified

### Q3 2026 (July-September)
**Focus**: Ecosystem growth

**Deliverables**:
- v0.6.0 release
- Multi-client support
- SDK documentation
- Community engagement

---

## 📊 Success Metrics

### Technical Metrics

| Metric | Current | v0.5.0 Target | v1.0.0 Target |
|--------|---------|---------------|---------------|
| **API Coverage** | 80% (42/46) | 100% (46/46) | 100% + reports |
| **Test Coverage** | ~80% | 90% | 95% |
| **Response Time (p95)** | <500ms | <200ms | <100ms |
| **Uptime** | N/A | 99.5% | 99.9% |
| **Concurrent Users** | ~10 | ~100 | ~1000 |
| **Security Score** | B+ | A | A+ |

### Adoption Metrics

| Metric | Current | 6-Month Target | 12-Month Target |
|--------|---------|----------------|-----------------|
| **Docker Pulls** | <1000 | 10,000 | 50,000 |
| **GitHub Stars** | <50 | 500 | 2,000 |
| **Active Users** | <100 | 1,000 | 10,000 |
| **Contributing Devs** | 1-2 | 5-10 | 20-50 |

---

## 🔗 Related Documentation

- [Refactoring Plan](./REFACTORING_PLAN.md) - Detailed task tracking
- [Improvement Areas](./IMPROVEMENT_AREAS.md) - Known gaps and technical debt
- [Project Overview](./PROJECT_OVERVIEW.md) - Current state
- [Security & Privacy](./SECURITY_AND_PRIVACY.md) - Security roadmap

---

## 📝 How to Contribute

### For Developers

1. Check this roadmap for upcoming features
2. Pick a high-priority item
3. Create GitHub issue discussing approach
4. Implement with tests and documentation
5. Submit pull request

### For Users

1. Use the server and provide feedback
2. Report bugs and suggest improvements
3. Share use cases and workflows
4. Help with documentation

### For AI Agents

1. Focus on high-impact AI tasks
2. Write tests for existing features
3. Improve documentation
4. Refactor code quality issues

---

## ✨ Summary

**The Actual MCP Server is production-ready today**, but this roadmap outlines the path to becoming an **enterprise-grade, AI-powered financial management platform**.

**Priorities**:
1. 🔴 **Complete API coverage** (v0.2.0)
2. 🔴 **Security hardening** (v0.2.0)
3. 🟠 **Performance optimization** (v0.3.0)
4. 🟠 **Advanced features** (v0.4.0-v0.5.0)
5. 🟢 **Enterprise features** (v0.6.0-v1.0.0)

**Timeline**: v1.0.0 targeted for August 2027 (21 months)

**Next Milestone**: v0.2.0 "Complete & Secure" - December 2025
