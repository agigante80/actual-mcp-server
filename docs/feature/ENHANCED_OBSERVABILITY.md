# Enhanced Observability

**Status:** Planned — v0.5.x (Q2 2026)  
**Priority:** 🟠 Medium  
**Effort:** ~1 week  
**Blocker:** None (basic Prometheus metrics already in place)

---

## Overview

Extend current Prometheus metrics with latency percentiles, queue depth tracking, and optional OpenTelemetry tracing. Add Grafana dashboard templates and structured log support for ELK/Loki stacks.

## Scope

### 1. Prometheus Metrics (extend `src/observability.ts`)
- [ ] Latency histograms per tool name (p50, p95, p99)
- [ ] Queue depth gauge (concurrent operations in flight)
- [ ] Error rate counter per tool + error type
- [ ] Cache hit/miss counters (once caching is added)

### 2. Request Tracing
- [ ] Add `X-Request-ID` middleware — generates/propagates correlation IDs
- [ ] Include request ID in all log lines for trace-ability
- [ ] Optional: OpenTelemetry export (Jaeger / Tempo compatible)

### 3. Structured Logging
- [ ] Confirm all winston logs emit valid JSON (`format.json()`)
- [ ] Add `request_id`, `tool_name`, `duration_ms` fields to every tool invocation log
- [ ] Log aggregation tested with Loki (via `docker compose` profile)

### 4. Grafana Dashboard
- [ ] Dashboard JSON for: RPS, latency percentiles, error rate, queue depth
- [ ] Store in `docker/grafana/dashboards/actual-mcp.json`

## New Env Vars

```bash
OTEL_ENABLED=false              # Enable OpenTelemetry export
OTEL_EXPORTER_URL=              # OTLP HTTP endpoint
```

## References

- [Prometheus best practices](https://prometheus.io/docs/practices/naming/)
- [OpenTelemetry Node.js](https://opentelemetry.io/docs/languages/js/)
- [`src/observability.ts`](../../src/observability.ts)
- [`src/logger.ts`](../../src/logger.ts)
- [`docker-compose.yaml`](../../docker-compose.yaml)
