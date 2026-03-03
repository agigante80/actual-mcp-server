# Advanced Integrations

**Status:** Planned — v1.0.x (Q3 2027)  
**Priority:** 🟢 Low  
**Effort:** 3–5 weeks  
**Blocker:** Core platform stability required first

---

## Overview

Connect Actual Budget to the broader financial and automation ecosystem: Plaid for automatic bank import, webhooks for event-driven workflows, and Zapier/IFTTT-style triggers.

## Scope

### 1. Plaid Bank Connectivity
- Tool: `actual_plaid_link_account`
- Use [Plaid Link](https://plaid.com/docs/link/) to connect bank accounts
- Sync transactions automatically on schedule or on-demand
- Requires Plaid API key (paid service after sandbox tier)

### 2. Webhook Support
- Tools: `actual_webhooks_create`, `actual_webhooks_list`, `actual_webhooks_delete`
- Emit events on: new transaction, budget exceeded, schedule triggered
- Configurable target URL + secret (HMAC-signed payloads)

```typescript
// Webhook payload shape
{
  event: 'transaction.created' | 'budget.exceeded' | 'schedule.triggered';
  timestamp: string;
  data: object;
  signature: string; // HMAC-SHA256
}
```

### 3. Zapier / IFTTT / n8n Integration
- Expose trigger endpoints compatible with Zapier's REST hooks pattern
- Document n8n HTTP node configuration
- No vendor SDK required — standard REST + webhooks

### 4. Email / SMS Notifications
- Configurable alerts: "Grocery budget 80% spent", "Unusual transaction detected"
- Transport: SMTP (via `nodemailer`) or Twilio SMS
- Triggered by budget threshold events or anomaly detection (see `AI_ML_ENHANCEMENTS.md`)

## New Env Vars

```bash
PLAID_CLIENT_ID=
PLAID_SECRET=
PLAID_ENV=sandbox          # or development, production
WEBHOOK_SIGNING_SECRET=    # HMAC secret for outbound webhooks
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
NOTIFICATION_EMAIL=
```

## References

- [Plaid API Docs](https://plaid.com/docs/)
- [Zapier REST hooks pattern](https://zapier.com/developer/documentation/v2/rest-hooks/)
- [n8n HTTP Request node](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest/)
- [nodemailer](https://nodemailer.com/)
- [`src/server/httpServer.ts`](../../src/server/httpServer.ts)
