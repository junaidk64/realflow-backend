# RealFlow — n8n Workflow Setup Guide

n8n instance: **https://n8n.boldme.site**

---

## Workflows Overview

| File | Workflow | Trigger | Purpose |
|------|----------|---------|---------|
| `1-auto-reply-pattern-a.json` | Auto Reply (Pattern A) | POST webhook | Backend pre-renders HTML → n8n sends email (**Recommended**) |
| `2-auto-reply-pattern-b.json` | Auto Reply (Pattern B) | POST webhook | n8n fetches + renders template itself |
| `3-notification.json` | Notification | POST webhook | Send new_lead / workflow_triggered / daily_summary alerts |
| `4-lead-extraction.json` | Lead Extraction | POST webhook | Parse raw email, extract lead fields, create lead in backend |
| `5-daily-summary.json` | Daily Summary | Cron 8 AM UTC | Fetch stats → build HTML → email the summary |
| `6-gmail-watch-renewal.json` | Gmail Watch Renewal | Cron every 6 days | Keep Gmail push subscription alive |

**Use Pattern A for auto-reply** (recommended by the docs) — the backend renders the email and n8n just sends it. Pattern B is only needed if you want n8n to own the full rendering step.

---

## Step 1 — Set n8n Environment Variables

In n8n go to **Settings → Environment Variables** and add:

| Variable | Value | Used By |
|----------|-------|---------|
| `BACKEND_URL` | `https://your-backend-domain.com` (no trailing slash) | All |
| `N8N_CALLBACK_SECRET` | A shared secret string (e.g. `openssl rand -hex 32`) | All |
| `BACKEND_SERVICE_TOKEN` | JWT or API key for backend service calls (cron flows) | Flows 5, 6 |
| `ADMIN_EMAIL` | Admin email for failure alerts | Flow 6 |
| `FALLBACK_NOTIFY_EMAIL` | Fallback if Settings.notifications.emailAddress is empty | Flow 5 |
| `N8N_BASE_URL` | `https://n8n.boldme.site` | Flow 4 (optional) |

> **Important:** `N8N_CALLBACK_SECRET` must match the value your backend checks on `x-n8n-secret` header in `POST /api/webhooks/n8n-callback`.

---

## Step 2 — Create Gmail OAuth2 Credential

1. In n8n go to **Credentials → New Credential → Google → Gmail OAuth2**
2. Name it exactly: **Gmail OAuth2**
3. Connect the Gmail account that RealFlow uses to send emails
4. All 5 email-sending workflows reference this credential by name

---

## Step 3 — Import Workflows

For each `.json` file:
1. n8n → **Workflows → Import from file**
2. Upload the JSON
3. n8n will warn about missing credentials — map them to **Gmail OAuth2** (created above)
4. Save — the workflow is **inactive** by default

---

## Step 4 — Note Your Webhook URLs

After importing, click each webhook workflow to get its live URL. These are what you store in the backend as `Workflow.webhookUrl`:

| Workflow | n8n Path | Full Webhook URL |
|----------|----------|-----------------|
| Auto Reply (A) | `realflow/auto-reply` | `https://n8n.boldme.site/webhook/realflow/auto-reply` |
| Auto Reply (B) | `realflow/auto-reply-fetch` | `https://n8n.boldme.site/webhook/realflow/auto-reply-fetch` |
| Notification | `realflow/notification` | `https://n8n.boldme.site/webhook/realflow/notification` |
| Lead Extraction | `realflow/lead-extract` | `https://n8n.boldme.site/webhook/realflow/lead-extract` |

Store each URL in the backend Workflow document (`webhookUrl` field) and in the RealFlow Settings (`n8nWebhookUrl` for the default).

---

## Step 5 — Activate Workflows

Only activate what you need:
- **Always activate:** `1-auto-reply-pattern-a.json` + `3-notification.json`
- **Activate if using n8n-side rendering:** `2-auto-reply-pattern-b.json` (instead of Pattern A)
- **Activate if n8n handles lead parsing:** `4-lead-extraction.json`
- **Activate both crons:** `5-daily-summary.json` + `6-gmail-watch-renewal.json`

---

## Step 6 — Add Backend Middleware for x-n8n-secret

The HTTP callback node sends `x-n8n-secret` on all requests to your backend. Add this middleware to your Express callback route:

```js
// middleware/n8nAuth.js
module.exports = (req, res, next) => {
  const secret = req.headers['x-n8n-secret'];
  if (secret !== process.env.N8N_CALLBACK_SECRET) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  next();
};

// routes/webhooks.js
router.post('/n8n-callback', n8nAuth, handleN8nCallback);
```

---

## Payload Reference

### Backend → n8n Auto Reply (Pattern A)

```json
{
  "html": "<!DOCTYPE html>...(rendered email HTML)...",
  "subject": "We received your moving enquiry",
  "to": "customer@example.com",
  "from": "business@gmail.com",
  "leadId": "65f1a2b3c4d5e6f7a8b9c0aa",
  "workflowId": "65f1a2b3c4d5e6f7a8b9c0bb"
}
```

### Backend → n8n Auto Reply (Pattern B)

```json
{
  "leadId": "65f1...",
  "workflowId": "65f2...",
  "templateId": "65f3...",
  "to": "customer@example.com",
  "from": "business@gmail.com",
  "subject": "We received your enquiry",
  "serviceToken": "JWT_OR_API_KEY_FOR_TEMPLATE_RENDER",
  "variables": {
    "customerName": "John Smith",
    "fromAddress": "123 Main St, London",
    "toAddress": "456 Oak Ave, Manchester",
    "movingDate": "2026-06-15",
    "services": "Packing, Loading",
    "businessName": "RealFlow Movers",
    "emailSignature": "Best regards,\nThe Team"
  }
}
```

### Backend → n8n Notification

```json
{
  "eventType": "new_lead",
  "html": "<!DOCTYPE html>...(optional pre-rendered HTML)...",
  "subject": "New Lead: John Smith",
  "to": "notifications@yourcompany.com",
  "leadId": "65f1...",
  "workflowId": "65f2...",
  "customerName": "John Smith",
  "customerEmail": "john@example.com",
  "fromAddress": "123 Main St",
  "toAddress": "456 Oak Ave",
  "movingDate": "2026-06-15",
  "services": ["Packing", "Loading"],
  "confidence": 82,
  "timestamp": "2026-05-17T10:00:00.000Z",
  "businessName": "RealFlow Movers"
}
```

If `html` is provided, it sends directly. If missing, the Code node builds the HTML from the raw fields.

Supported `eventType` values: `new_lead` | `workflow_triggered` | `daily_summary`

### Backend → n8n Lead Extraction

```json
{
  "emailId": "gmail-message-id-abc123",
  "from": "noreply@comparemymove.com",
  "subject": "New Moving Lead — John Smith",
  "body": "Full email text body here...",
  "receivedAt": "2026-05-17T09:45:00.000Z",
  "userId": "65f1a2b3c4d5e6f7a8b9c0aa"
}
```

### n8n → Backend Callback

```json
{
  "leadId": "65f1a2b3c4d5e6f7a8b9c0aa",
  "workflowId": "65f1a2b3c4d5e6f7a8b9c0bb",
  "status": "sent",
  "error": "",
  "eventType": "new_lead"
}
```

Backend sets `Lead.autoReplySent = true` and `Lead.autoReplySentAt = new Date()` on receipt.

---

## Template Variable Reference

Use `{{variableName}}` in your Template `htmlContent`. These are substituted by the backend before calling n8n (Pattern A).

| Variable | Source |
|----------|--------|
| `{{customerName}}` | `Lead.customerName` |
| `{{customerEmail}}` | `Lead.customerEmail` |
| `{{fromAddress}}` | `Lead.fromAddress` |
| `{{toAddress}}` | `Lead.toAddress` |
| `{{movingDate}}` | `Lead.movingDate` |
| `{{services}}` | `Lead.services` (comma-joined) |
| `{{businessName}}` | `Settings.businessName` |
| `{{emailSignature}}` | `Settings.emailSignature` |
| `{{eventType}}` | notification event name |
| `{{leadCount}}` | count (daily summary) |
| `{{timestamp}}` | ISO date string |

> **Do NOT use `{{ $json.field }}` inside template HTML** — that is n8n expression syntax and will not be resolved in the rendered email body.

---

## Architecture: How All Pieces Connect

```
Gmail push notification
  ↓
Backend (Express) receives push at /api/gmail/webhook
  ↓
Backend extracts & parses lead email
  ↓
Backend creates Lead document in MongoDB
  ↓
Backend resolves Workflow by type = "auto_reply"
  ↓
Backend resolves Template from Workflow.config.templateId
  → fallback: Settings.autoReplyTemplate
  ↓
Backend renders {{variables}} → HTML
  ↓
Backend POSTs to Workflow.webhookUrl (n8n):
  { html, subject, to, from, leadId, workflowId }
  ↓
n8n receives webhook (responds 200 immediately)
  ↓
n8n sends email via Gmail OAuth2 node
  ↓
n8n POSTs callback to BACKEND_URL/api/webhooks/n8n-callback:
  { leadId, workflowId, status: "sent" }
  ↓
Backend sets Lead.autoReplySent = true
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `GMAIL_CREDENTIAL_ID` error on import | Re-map credential in workflow settings to your Gmail OAuth2 credential |
| 401 on n8n-callback | Check `N8N_CALLBACK_SECRET` matches between n8n env and backend middleware |
| Webhook URL 404 | Make sure the workflow is **active** in n8n |
| Email not sending | Check Gmail OAuth2 token is still valid; re-authorise in n8n Credentials |
| Cron not firing | Verify n8n instance timezone; adjust cron expression if needed (`0 8 * * *` = 8 AM UTC) |
| Template not rendering | Template must have `status: "approved"` before it can be assigned and rendered |
