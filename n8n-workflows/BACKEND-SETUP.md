# RealFlow Backend — n8n Integration Setup

This document covers every backend change required to support the six n8n workflows in this folder.

---

## Environment Variables

Add these to your `.env` file:

```env
N8N_BASE_URL=https://n8n.boldme.site
N8N_API_KEY=<your-n8n-api-key>
N8N_CALLBACK_SECRET=<shared-secret-min-32-chars>   # must match N8N_CALLBACK_SECRET in n8n env
```

Generate a secret:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## API Endpoints Added / Changed

### `POST /api/leads` — Create lead from n8n (Lead Extraction workflow)

**Security:** `x-n8n-secret` header (verified by `n8nAuth` middleware — no bearer token needed)

Used by workflow `4-lead-extraction.json` after parsing a raw email.

**Request body:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `userId` | string | Yes | MongoDB ObjectId of the user |
| `source` | string | No | defaults to `"email"` |
| `customerName` | string | No | |
| `customerEmail` | string | No | |
| `customerPhone` | string | No | |
| `fromAddress` | string | No | |
| `toAddress` | string | No | |
| `movingDate` | string | No | |
| `services` | string\|array | No | n8n sends as `JSON.stringify(array)` |
| `notes` | string | No | |
| `confidence` | number | No | 0–100 |
| `rawEmailId` | string | No | Gmail message ID |
| `rawEmailSubject` | string | No | |
| `rawEmailFrom` | string | No | |
| `status` | string | No | defaults to `"new"` |

**Response 201:**
```json
{ "success": true, "data": { "lead": { ...leadObject } } }
```

---

### `POST /api/webhooks/n8n-callback` — Status callback from n8n

**Security:** `x-n8n-secret` header (verified by `n8nAuth` middleware)

All six workflows POST here after completing. Sets `Lead.autoReplySent = true` and increments `Workflow.triggerCount`.

**Request body:**

| Field | Type | Notes |
|-------|------|-------|
| `leadId` | string | MongoDB Lead `_id` (optional for cron flows) |
| `workflowId` | string | MongoDB Workflow `_id` — increments `triggerCount` |
| `status` | string | `"sent"` \| `"failed"` |
| `error` | string | Error message if `status = "failed"` |
| `eventType` | string | `"new_lead"` \| `"workflow_triggered"` \| `"daily_summary"` |

**Response 200:**
```json
{ "success": true }
```

---

### `POST /api/webhooks/n8n` — Generic n8n status update

**Security:** `x-n8n-secret` header

Updates `Lead.status` from n8n payload. Used for CRM-sync or custom status flows.

---

### `PATCH /api/workflows/:id` — Update workflow config

**Security:** Bearer JWT token

Stores which template is assigned to a workflow. Supports partial `config` merge.

**Request body (all optional):**
```json
{
  "name": "Auto Reply v2",
  "webhookUrl": "https://n8n.boldme.site/webhook/realflow/auto-reply",
  "config": {
    "templateId": "<Template ObjectId>",
    "templateName": "Welcome Email",
    "subject": "We received your enquiry",
    "fallbackToGlobal": true
  }
}
```

---

### `POST /api/templates/:id/render` — Render template with variables

**Security:** Bearer JWT token

Only renders templates with `status: "approved"`. Substitutes `{{variable}}` placeholders.

**Request body:**
```json
{
  "variables": {
    "customerName": "John Smith",
    "fromAddress": "123 Main St",
    "toAddress": "456 Oak Ave",
    "movingDate": "2026-06-15",
    "services": "Packing, Loading",
    "businessName": "RealFlow Movers",
    "emailSignature": "Best regards, The Team"
  }
}
```

**Response 200:**
```json
{ "success": true, "data": { "html": "<!DOCTYPE html>..." } }
```

---

## Middleware Added

### `src/middlewares/n8nAuth.ts`

Validates `x-n8n-secret` header against `config.n8n.callbackSecret` (`N8N_CALLBACK_SECRET` env var).

Applied to:
- `POST /api/leads` (n8n lead creation)
- `POST /api/webhooks/n8n`
- `POST /api/webhooks/n8n-callback`

```typescript
// Usage in routes
import { n8nAuth } from '../middlewares/n8nAuth'
router.post('/n8n-callback', webhookLimiter, n8nAuth, handleN8nCallback)
```

---

## Workflow → Backend Endpoint Map

| Workflow | n8n Webhook Path | Backend Endpoints Called |
|----------|-----------------|--------------------------|
| `1-auto-reply-pattern-a.json` | `realflow/auto-reply` | `POST /api/webhooks/n8n-callback` |
| `2-auto-reply-pattern-b.json` | `realflow/auto-reply-fetch` | `GET /api/templates/:id/render`, `POST /api/webhooks/n8n-callback` |
| `3-notification.json` | `realflow/notification` | `POST /api/webhooks/n8n-callback` |
| `4-lead-extraction.json` | `realflow/lead-extract` | `POST /api/leads`, then triggers auto-reply |
| `5-daily-summary.json` | Cron (8 AM UTC) | `GET /api/leads/stats`, `GET /api/settings` |
| `6-gmail-watch-renewal.json` | Cron (every 6 days) | `POST /api/gmail/watch` |

---

## How Backend Triggers n8n

The backend triggers n8n workflows by POSTing to `Workflow.webhookUrl`. The workflow document stores the full n8n webhook URL.

### Auto Reply (Pattern A) — Backend pre-renders, n8n sends

```
Lead arrives → Backend resolves auto_reply workflow
→ Backend resolves template (config.templateId → Settings.autoReplyTemplate fallback)
→ Backend renders {{variables}} → HTML
→ Backend POSTs to Workflow.webhookUrl:
  { html, subject, to, from, leadId, workflowId }
→ n8n sends Gmail → POSTs callback to /api/webhooks/n8n-callback
→ Backend sets Lead.autoReplySent = true, Workflow.triggerCount++
```

### Notification

```
Backend POSTs to notification Workflow.webhookUrl:
{
  "eventType": "new_lead",
  "html": "(optional pre-rendered HTML)",
  "subject": "New Lead: John Smith",
  "to": "notifications@company.com",
  "leadId": "...",
  "workflowId": "...",
  "customerName": "...",
  ...
}
```

If `html` is provided, n8n sends it directly. If omitted, n8n builds the HTML itself.

---

## Storing Webhook URLs

After importing workflows into n8n and noting their webhook URLs, store them in the database:

```
PATCH /api/workflows/:id
{ "webhookUrl": "https://n8n.boldme.site/webhook/realflow/auto-reply" }
```

Default webhook URLs after import:

| Workflow | URL |
|----------|-----|
| Auto Reply A | `https://n8n.boldme.site/webhook/realflow/auto-reply` |
| Auto Reply B | `https://n8n.boldme.site/webhook/realflow/auto-reply-fetch` |
| Notification | `https://n8n.boldme.site/webhook/realflow/notification` |
| Lead Extraction | `https://n8n.boldme.site/webhook/realflow/lead-extract` |

---

## Daily Summary — Service Token

Workflow `5-daily-summary.json` calls `GET /api/leads/stats` and `GET /api/settings` using a service bearer token (`BACKEND_SERVICE_TOKEN` in n8n env). This must be a valid JWT for an active user/admin account.

Generate one by logging in via `POST /api/auth/google` and copying the returned `accessToken`.

---

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| 401 on `/api/webhooks/n8n-callback` | `N8N_CALLBACK_SECRET` mismatch | Check both n8n env and backend `.env` have the same value |
| 401 on `POST /api/leads` from n8n | Same — missing or wrong secret header | Confirm `x-n8n-secret` header is set in n8n HTTP Request node |
| `config.n8n.callbackSecret` is empty | `N8N_CALLBACK_SECRET` not in `.env` | Add the env var and restart the server |
| Lead not created from lead-extraction | `userId` missing in n8n payload | Set `userId` in the n8n workflow's HTTP body parameters |
| `Workflow.triggerCount` not incrementing | `workflowId` not passed in callback | Confirm n8n callback body includes `workflowId` |
| Daily summary not sending | `BACKEND_SERVICE_TOKEN` expired | Re-generate the JWT and update n8n env |
