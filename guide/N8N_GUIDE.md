# N8N Flows Guide — Keep vs Move to Backend

## Current N8N Workflows (from getDefaultWorkflowTemplates)

| Workflow | Type | Keep in N8N? | Reason |
|----------|------|-------------|--------|
| Gmail Lead Trigger | lead_extraction | ✅ Already on backend | Gmail Pub/Sub → queueService handles this |
| Auto Reply | auto_reply | ❌ Remove from n8n | Backend does this better, faster, reliably |
| CRM Sync | notification | ✅ Keep in n8n | Requires CRM-specific OAuth/auth — n8n excels at this |
| Slack Lead Alert | notification | ⚠️ Optional | Simple HTTP POST — could be on backend, but n8n is fine |
| Google Sheets Logger | custom | ✅ Keep in n8n | Requires Google Sheets OAuth — n8n excels at this |
| Follow-up Sequence | auto_reply | ✅ Keep in n8n | Timed delay (24h wait) — n8n's strength |

---

## Decision Logic

### Move to Backend When:
- The action is time-critical (auto-reply must be instant)
- The action uses data already on the backend (lead fields, settings)
- No third-party OAuth is needed
- The action should always succeed (critical path)
- Every user needs it (not a power-user feature)

### Keep in N8N When:
- Third-party OAuth is needed (Google Sheets, Salesforce, HubSpot)
- Time delays are needed (follow-up after 24h, 3 days, 1 week)
- The user needs to customise the logic visually
- It's an integration with an external system the backend doesn't know about

---

## Flow-by-Flow Analysis

### 1. Gmail Lead Trigger — ALREADY ON BACKEND ✅
The entire Gmail → Pub/Sub → email processing → lead extraction pipeline runs on the backend via BullMQ. The "Gmail Lead Trigger" n8n template is redundant. When a user creates this workflow, the n8n trigger is just an extra notification webhook — the actual work is done before n8n ever fires.

**Action:** Keep the workflow as a notification hook if the user wants n8n to know about new leads, but document clearly that the actual extraction is backend-driven.

---

### 2. Auto Reply — REMOVE FROM N8N ❌

**Why it's problematic:**
1. When `settings.autoReply = true` AND an `auto_reply` workflow is active → customer gets 2 emails
2. n8n must be running, the workflow must be active, the webhook must respond, and n8n must then call `/api/email/send` — 4 points of failure
3. The backend already generates better HTML (business-type aware, signature included)
4. Response time: Backend auto-reply fires in <2 seconds. N8N path can take 10-30 seconds

**What to do:**
- Remove `type: 'auto_reply'` from the workflow templates offered to users
- Change the Workflow model enum if `auto_reply` type should no longer be created
- Keep the `buildAutoReplyPayload` function in emailService — it's used for template rendering

---

### 3. CRM Sync — KEEP IN N8N ✅

This is n8n's sweet spot. Moving a lead to HubSpot, Salesforce, Pipedrive, or any CRM requires:
- OAuth2 flows specific to each CRM
- API-specific field mapping
- Error handling with CRM-specific retry logic

Building this on the backend would mean maintaining integrations with 10+ CRMs. Let n8n handle this.

**Payload sent to n8n (already correct):**
```json
{
  "userId": "...",
  "leadId": "...",
  "customerName": "John Smith",
  "customerEmail": "john@example.com",
  "customerPhone": "+44 7700 900000",
  "businessType": "moving",
  "aiScore": 8,
  "sentiment": "positive",
  "status": "new",
  "confidence": 80
}
```

**Improvement:** Also send `extraFields` in the payload so CRM can store business-specific data (propertyAddress, policyType, etc.).

---

### 4. Slack Lead Alert — OPTIONAL (Could Move to Backend)

This is a simple Slack webhook POST. The backend could do this in 10 lines:

```typescript
// If user has a Slack webhook URL in settings:
if (settings.slackWebhookUrl) {
  await fetch(settings.slackWebhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: `🔔 New ${lead.businessType} lead: *${lead.customerName}* (score: ${lead.aiScore}/10)`
    })
  })
}
```

**Recommendation:** Add `slackWebhookUrl` to Settings model. Let users paste their Slack webhook URL and get instant notifications without needing an n8n workflow.

**Why this helps:** No n8n dependency for Slack. Faster. And free-plan users who might not have n8n can still get Slack alerts.

---

### 5. Google Sheets Logger — KEEP IN N8N ✅

Google Sheets API requires OAuth2 with a service account or user consent. Managing per-user Google Sheets OAuth on the backend is complex and creates a liability. n8n handles this natively with its Google Sheets node.

**Improvement:** Send more fields in the webhook payload:
```json
{
  "leadId": "...",
  "customerName": "...",
  "customerEmail": "...",
  "businessType": "moving",
  "aiScore": 8,
  "sentiment": "positive",
  "confidence": 80,
  "extraFields": { "fromAddress": "...", "toAddress": "..." },
  "createdAt": "2026-05-19T..."
}
```

The current template only maps basic fields. Users should be able to log all extracted fields.

---

### 6. Follow-up Sequence — KEEP IN N8N ✅

This sends a follow-up email 24 hours after the initial auto-reply. The 24-hour wait requires either:
- A scheduled job / delayed queue (BullMQ supports this with `delay` option)
- n8n's Wait node

n8n's Wait node is perfect here and visual — users can change the delay from 24h to 48h or 3 days without code changes.

**However:** If you want to add this to the backend for reliability, BullMQ supports delayed jobs:
```typescript
await followUpQueue.add(
  'send-followup',
  { leadId, userId },
  { delay: 24 * 60 * 60 * 1000 } // 24h in ms
)
```

**Recommendation:** Start with n8n for simplicity. Add a `followUpQueue` on the backend if users report follow-up emails failing because n8n went down.

---

## Payload Improvements for All N8N Flows

The current n8n trigger payload for non-auto_reply workflows should include `extraFields`:

```typescript
// In queueService.ts n8nTriggerWorker, update the else branch:
payload = {
  userId,
  leadId,
  customerName: lead.customerName,
  customerEmail: lead.customerEmail,
  customerPhone: lead.customerPhone,
  businessType: lead.businessType,
  aiScore: lead.aiScore,
  aiScoreReason: lead.aiScoreReason,
  sentiment: lead.sentiment,
  status: lead.status,
  confidence: lead.confidence,
  createdAt: lead.createdAt,
  // Add these:
  extraFields: lead.extraFields ? Object.fromEntries(
    lead.extraFields instanceof Map
      ? lead.extraFields
      : Object.entries(lead.extraFields as object)
  ) : {},
  movingDate: lead.movingDate,       // moving
  fromAddress: lead.fromAddress,     // moving
  toAddress: lead.toAddress,         // moving
  services: lead.services,           // moving
}
```

This lets CRM sync and Google Sheets workflows access ALL lead data.

---

## Recommended Settings Model Addition

Add these optional fields to Settings to enable backend-native integrations:

```typescript
// src/models/Settings.ts additions:
slackWebhookUrl: { type: String, default: '' }   // Slack integration without n8n
zapierWebhookUrl: { type: String, default: '' }  // Zapier alternative to n8n
```

These let users integrate without needing n8n at all for basic notification flows.

---

## N8N Architecture Summary

```
Backend handles:            N8N handles:
├── Lead extraction         ├── CRM sync (HubSpot, Salesforce)
├── Auto-reply email        ├── Google Sheets logging
├── Notifications           ├── Follow-up sequences (with delays)
├── Spam filtering          ├── Custom business logic
└── Daily digest            └── Any external OAuth integrations
```

N8N is best used as the "power user customisation layer" — not as the critical path for every email action.
