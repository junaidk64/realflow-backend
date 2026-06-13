# RealFlow Backend — Workflow Audit Report

**Date:** 2026-06-13  
**Branch:** main  
**Auditor:** Claude Code (automated + manual analysis)

---

## Executive Summary

The backend implements **8 workflow types** across two execution paths: **Backend-Managed** (BullMQ workers, no n8n dependency) and **n8n-Delegated** (webhook triggers to self-hosted n8n). This report covers the 6 workflows visible in the UI, their current backend status, known bugs, and test cases needed to validate each.

> **Auto Reply Workflow** has been tested by the user and is confirmed working. All others need verification.

---

## Status Overview

| # | Workflow | Type | Path | Backend Code | n8n Template | Status |
|---|----------|------|------|-------------|-------------|--------|
| 1 | **CRM Sync** | `crm_sync` | n8n-only | Trigger queue ✅ | Template ✅ | ⚠️ Untested — placeholder URL |
| 2 | **Slack Lead Alert** | `slack_notification` | n8n-only | Trigger queue ✅ | Template ✅ | ⚠️ Untested — placeholder URL |
| 3 | **Gmail Lead Trigger** | `webhook_lead_trigger` | n8n + backend gate | Gate + queue ✅ | Template ✅ | ⚠️ Untested |
| 4 | **Auto Reply Workflow** | `auto_reply` / `webhook_auto_reply` | Backend-primary | Direct worker ✅ | Optional ✅ | ✅ Working (user confirmed) |
| 5 | **Follow-up Sequence** | `follow_up` | n8n-only | Trigger queue ✅ | Template ✅ | ❌ Not working — no webhookUrl path |
| 6 | **Google Sheets Logger** | `google_sheets` | n8n-only | Trigger queue ✅ | Template ✅ | ❌ Not working — placeholder Sheet ID |

---

## Execution Architecture

```
Incoming Email
     │
     ▼
emailProcessingWorker (email-processing queue)
     │
     ▼
leadExtractionWorker (lead-extraction queue)
     │
     ├─► [Gate: lead_extraction OR webhook_lead_trigger active?] ── NO ──► skip
     │
     ├─► [Gate: spam_filtering active?] ── spam ──► drop
     │
     ├─► AI Extraction (Gemini → aiScore, confidence, isLead)
     │
     ├─► [isLead + confidence ≥ threshold?] ── NO ──► skip
     │
     ├─► Lead.create() in MongoDB
     │
     ├─► [notification/slack_notification/webhook_lead_trigger active?]
     │       └─► createNotification()
     │
     ├─► [auto_reply OR webhook_auto_reply active?]
     │       └─► autoReplyQueue.add() ──► autoReplyWorker ──► sendAutoReply()
     │
     └─► For each active workflow with webhookUrl (NOT backend-managed):
             └─► n8nTriggerQueue.add() ──► n8nTriggerWorker ──► POST to n8n
```

**Backend-Managed types** (never go through n8n): `spam_filtering`, `daily_digest`, `whatsapp_auto_reply`, `whatsapp_lead_trigger`

**n8n-Delegated types** (must have `webhookUrl` set on Workflow record): `crm_sync`, `slack_notification`, `webhook_lead_trigger`, `follow_up`, `google_sheets`, `webhook_auto_reply`

---

## Workflow 1 — CRM Sync

### What Works
- Workflow model persists correctly in MongoDB
- Install endpoint (`POST /api/workflows/install/crm_sync`) creates record
- Toggle endpoint activates/deactivates correctly
- `n8nTriggerWorker` builds correct payload on lead extraction:
  ```json
  {
    "isLead": true, "userId": "...", "leadId": "...",
    "customerName": "...", "customerEmail": "...", "customerPhone": "...",
    "businessType": "...", "aiScore": 8, "sentiment": "positive",
    "status": "new", "confidence": 85, "createdAt": "..."
  }
  ```
- n8n template node pushes to `https://your-crm.com/api/leads` via HTTP POST
- `triggerCount` and `lastTriggered` update on success
- In-app notification fires on workflow trigger

### What's Broken / Missing
- ❌ **n8n template has hardcoded placeholder URL** — `https://your-crm.com/api/leads` must be replaced in n8n before any CRM sync works
- ❌ **No backend validation** — workflow can be activated even if n8n isn't configured or webhookUrl is empty
- ❌ **Silent failures** — if n8n webhook call fails (HTTP 4xx/5xx), the error goes to logs only; user sees nothing
- ❌ **No retry visibility** — BullMQ retries 3 times silently; user never knows CRM sync failed
- ❌ **Webhook URL stored in plaintext** in MongoDB `Workflow.webhookUrl` field

### Test Cases

```
TC-CRM-01: Install + activate CRM Sync workflow
  Given: User is authenticated, no existing crm_sync workflow
  When:  POST /api/workflows/install/crm_sync
  Then:  201 response, Workflow record created with type='crm_sync', isActive=false

TC-CRM-02: Activate without webhookUrl
  Given: CRM Sync workflow installed, webhookUrl is null
  When:  POST /api/workflows/:id/toggle (activate)
  Then:  Workflow activates (currently no block — this is the gap to fix)

TC-CRM-03: Trigger fires on lead extraction
  Given: CRM Sync active, valid webhookUrl pointing to a requestbin/webhook.site
  When:  A qualifying email arrives and is processed
  Then:  n8nTriggerQueue receives job, webhook.site receives POST with lead payload

TC-CRM-04: Payload structure validation
  Given: Webhook received at test endpoint
  Then:  Payload must contain: isLead=true, userId, leadId, customerName, 
         customerEmail, customerPhone, businessType, aiScore, confidence, createdAt

TC-CRM-05: Retry on webhook failure
  Given: webhookUrl points to a 500-returning endpoint
  When:  Lead is extracted and CRM sync fires
  Then:  BullMQ retries job up to 3 times, then marks job as failed

TC-CRM-06: triggerCount increments
  Given: CRM Sync active with valid webhookUrl
  When:  Two leads extracted
  Then:  Workflow.triggerCount === 2, lastTriggered is recent
```

---

## Workflow 2 — Slack Lead Alert

### What Works
- Workflow type `slack_notification` triggers in-app notification creation at queueService.ts:383
- Also queues n8n trigger if webhookUrl set
- n8n template formats message: `🔔 New lead: *{name}* ({email}) — {subject}`
- `n8nTriggerWorker` delivers lead payload to n8n webhook

### What's Broken / Missing
- ❌ **Hardcoded Slack webhook URL** — `https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK` must be replaced in n8n
- ❌ **No Slack webhook URL field on the workflow** — currently there's no way to configure the Slack URL from the RealFlow UI; user must go into n8n manually
- ❌ **n8n template uses `rawEmailSubject`** but the payload field is `subject` — this field mismatch means Slack message will show `undefined`
- ❌ **No test-send button** — no endpoint to fire a test Slack message without a real lead

### Test Cases

```
TC-SLACK-01: Install Slack Lead Alert
  Given: User authenticated
  When:  POST /api/workflows/install/slack_notification
  Then:  201, Workflow record created

TC-SLACK-02: In-app notification fires without n8n
  Given: slack_notification workflow active (even without n8n webhookUrl)
  When:  A lead is extracted
  Then:  Notification record created with type='new_lead' in MongoDB
         GET /api/notifications returns the notification

TC-SLACK-03: Slack message delivered (requires n8n)
  Given: slack_notification active, n8n running, Slack webhook configured in n8n
  When:  Lead extracted
  Then:  Slack channel receives message with name, email

TC-SLACK-04: Field name bug — rawEmailSubject vs subject
  Given: n8n template uses {{$json["rawEmailSubject"]}}
  When:  Payload arrives at n8n
  Then:  EXPECTED BUG: rawEmailSubject is undefined — message shows truncated output
  Fix:   Change n8n template field to {{$json["subject"]}} OR add rawEmailSubject to payload

TC-SLACK-05: Notification only (no n8n configured)
  Given: slack_notification active, webhookUrl is null
  When:  Lead extracted
  Then:  n8nTriggerQueue job NOT added, in-app notification still fires
```

---

## Workflow 3 — Gmail Lead Trigger

### What Works
- Acts as the **primary gate** for all lead processing — `lead_extraction` OR `webhook_lead_trigger` must be active or ALL extraction is skipped (queueService.ts:216-231)
- On activation, in-app notifications fire for every new lead
- n8n template includes an `If` node that checks `isLead === true` before forwarding
- Full lead payload delivered to n8n

### What's Broken / Missing
- ❌ **Critical gate behavior may confuse users** — if user deactivates this workflow thinking it just stops forwarding to a team endpoint, it actually disables ALL lead extraction for the account
- ❌ **n8n template `Notify Team` node is missing** — the `connections` in `workflowCatalogue.ts:67-71` references a `Notify Team` node that has no definition in the `nodes` array; this causes n8n import to fail silently
- ❌ **No customizable team endpoint** — hardcoded to `{frontendUrl}/api/notifications`, which may not exist or handle the payload

### Test Cases

```
TC-GMAIL-01: Deactivating stops ALL extraction
  Given: webhook_lead_trigger is the only active lead-processing workflow
  When:  Toggle it to inactive
  Then:  New emails are not processed — leadExtractionWorker returns {skipped: 'lead_extraction_disabled'}
         IMPORTANT: Verify this is communicated clearly in UI

TC-GMAIL-02: Activating re-enables extraction
  Given: webhook_lead_trigger inactive (and no lead_extraction workflow)
  When:  Toggle to active
  Then:  New qualifying emails are processed and leads created

TC-GMAIL-03: isLead flag check in n8n
  Given: n8n webhook_lead_trigger workflow running
  When:  Backend sends payload with isLead=false (below confidence threshold)
  Then:  n8n If node routes to false branch — no team notification sent

TC-GMAIL-04: Missing Notify Team node bug
  Given: User imports n8n template from workflowCatalogue
  When:  Template is imported into n8n
  Then:  EXPECTED BUG: n8n will error "Notify Team node not found in connections"
  Fix:   Add Notify Team HTTP Request node definition to the nodes array

TC-GMAIL-05: Notification on new lead
  Given: webhook_lead_trigger active
  When:  Lead extracted with isLead=true
  Then:  GET /api/notifications returns new notification with type='new_lead'
```

---

## Workflow 4 — Auto Reply Workflow ✅ (Confirmed Working)

### What Works
- Backend-direct path (`auto_reply` type) processes via `autoReplyWorker` using BullMQ
- SMTP connection tried first; falls back to Gmail OAuth
- Business-type aware HTML templates (moving, real-estate, insurance, cleaning, legal, general)
- AI-generated replies via Claude Haiku when `useAiReply=true`
- Template selection via `config.templateId`
- Deduplication guard: `lead.autoReplySent` prevents double sends
- Logs email in `EmailLog` collection
- Updates lead with `autoReplySent=true` + `autoReplySentAt`
- In-app notification fires on successful send

### Known Issues (Non-blocking)
- ⚠️ If both `auto_reply` AND `webhook_auto_reply` are active simultaneously, two emails can be sent to the same lead — backend picks only the first match (`find()`) so this is partially mitigated, but two workflow records of different types would both match
- ⚠️ `useAiReply=true` calls Claude API for every lead — no caching, cost accumulates
- ⚠️ No email preview before going live

### Test Cases

```
TC-AUTOREPLY-01: End-to-end send (already passing)
  Given: auto_reply workflow active, SMTP configured
  When:  Qualifying email arrives
  Then:  Lead created, autoReplyQueue job fires, email delivered, autoReplySent=true

TC-AUTOREPLY-02: Deduplication guard
  Given: Lead with autoReplySent=true exists
  When:  autoReplyWorker job fires for that leadId again
  Then:  Returns {skipped: true}, no second email sent

TC-AUTOREPLY-03: AI reply mode
  Given: auto_reply workflow active, config.useAiReply=true
  When:  Lead extracted
  Then:  Claude Haiku generates personalized reply, email sent with AI content

TC-AUTOREPLY-04: Template selection
  Given: auto_reply workflow active, config.templateId set to a valid EmailTemplate id
  When:  Lead extracted
  Then:  Email uses the selected template's HTML, with {{customerName}} interpolated

TC-AUTOREPLY-05: No email address — skip gracefully
  Given: Lead extracted but customerEmail is empty/null
  When:  autoReplyWorker job fires
  Then:  Job completes without error, no email attempt, warning logged

TC-AUTOREPLY-06: SMTP failure fallback to Gmail
  Given: SMTP config broken, Gmail OAuth active
  When:  Lead extracted
  Then:  sendAutoReply retries via Gmail OAuth connection, email delivered

TC-AUTOREPLY-07: EmailLog record created
  Given: Successful auto-reply send
  Then:  EmailLog.findOne({leadId}) returns record with status='sent', sentAt populated
```

---

## Workflow 5 — Follow-up Sequence

### What Works
- Workflow catalogue entry exists (`follow_up` type)
- n8n template defined with: Webhook → Wait 24h → Send Follow-up Email
- If n8n is configured with a working SMTP credential and webhookUrl is set on the Workflow record, the full sequence runs

### What's Broken / Missing
- ❌ **Critical: `follow_up` is NOT in `BACKEND_MANAGED_TYPES`** — this is correct, but it means the workflow ONLY fires if `Workflow.webhookUrl` is set. The install flow currently does NOT prompt the user to set a webhookUrl, so the trigger never fires
- ❌ **100% dependent on n8n being online** — if n8n is down when a lead arrives, the follow-up is permanently lost (no backend retry queue)
- ❌ **n8n email node has no SMTP credential configured** in the template — user must manually add their SMTP credentials in n8n
- ❌ **No lead status update** — when follow-up is sent via n8n, the backend `Lead.followUpSent` field is never updated (backend doesn't know it happened)
- ❌ **No way to customize the 24h delay** from RealFlow UI
- ❌ **Email template hardcoded in n8n node** — the follow-up text cannot be edited from RealFlow

### Test Cases

```
TC-FOLLOWUP-01: Install follow_up workflow
  Given: User authenticated
  When:  POST /api/workflows/install/follow_up
  Then:  201, Workflow created with type='follow_up'

TC-FOLLOWUP-02: No webhookUrl = silent no-op (current bug)
  Given: follow_up workflow active, webhookUrl is null
  When:  Lead extracted
  Then:  n8nTriggerQueue job is NOT added (webhook check at queueService.ts:425 fails)
         Follow-up NEVER queued — user never knows
  Fix:   Show warning in UI if follow_up is active but webhookUrl not configured

TC-FOLLOWUP-03: Trigger fires with webhookUrl set
  Given: follow_up active, webhookUrl = http://n8n:5678/webhook/follow-up
  When:  Lead extracted
  Then:  n8nTriggerQueue fires, n8n receives lead payload, waits 24h, sends email
         Workflow.triggerCount increments, lastTriggered updates

TC-FOLLOWUP-04: Payload contains required fields
  Given: follow-up webhook received at n8n
  Then:  Payload has: customerName, customerEmail, fromEmail (for reply-from address)
         EXPECTED GAP: fromEmail is NOT in the standard n8n payload — n8n template references 
         {{$json["fromEmail"]}} but payload only has userId, customerEmail, etc.
  Fix:   Add fromEmail to n8nTriggerWorker payload for follow_up type

TC-FOLLOWUP-05: n8n down — lead extraction still completes
  Given: n8n unreachable, follow_up active with webhookUrl
  When:  Lead extracted
  Then:  n8nTriggerQueue job added, fails after retries, lead STILL created in MongoDB
         Follow-up permanently missed (acceptable for now, but should alert user)
```

---

## Workflow 6 — Google Sheets Logger

### What Works
- Workflow catalogue entry exists (`google_sheets` type)
- n8n template defined with: Webhook → Google Sheets Append
- `n8nTriggerWorker` delivers standard lead payload to n8n
- Column mapping covers: Name, Email, Phone, Date, Status, Confidence, Created

### What's Broken / Missing
- ❌ **Hardcoded `YOUR_GOOGLE_SHEET_ID`** in the n8n template — user must manually edit in n8n before anything logs
- ❌ **Same silent no-op if webhookUrl not set** (same as Follow-up #TC-FOLLOWUP-02)
- ❌ **No Google credentials in template** — user must add their Google Sheets OAuth credential in n8n manually
- ❌ **`movingDate`/`Date` field** — the payload has `movingDate` as undefined for non-moving business types; Google Sheet will have empty Date column for all non-moving leads
- ❌ **No backend fallback logging** — if n8n is down when lead arrives, that lead row is permanently missing from the sheet
- ❌ **No validation** that configured Sheet ID is accessible before workflow activation
- ❌ **`aiScore` field missing from payload** — template maps `Confidence` to `{{$json["confidence"]}}` but the meaningful field is `aiScore`; user may want both

### Test Cases

```
TC-SHEETS-01: Install google_sheets workflow
  Given: User authenticated
  When:  POST /api/workflows/install/google_sheets
  Then:  201, Workflow record created with type='google_sheets'

TC-SHEETS-02: Silent no-op without webhookUrl (same as follow-up)
  Given: google_sheets workflow active, webhookUrl is null
  When:  Lead extracted
  Then:  n8nTriggerQueue job NOT added — lead never logged to sheet
  Fix:   Block activation or show warning if webhookUrl not set

TC-SHEETS-03: Trigger fires and sheet row appended (requires n8n + Google creds)
  Given: google_sheets active, n8n configured with Google Sheets OAuth, valid Sheet ID
  When:  Lead extracted
  Then:  New row appended to Google Sheet with Name, Email, Phone, Status, Confidence

TC-SHEETS-04: Non-moving lead — Date column is empty
  Given: businessType='insurance' or other non-moving
  When:  Lead extracted and logged to sheet
  Then:  EXPECTED: Date column is empty (movingDate is undefined for these types)
  Fix:   Add generic 'date' field = createdAt as fallback for Date column

TC-SHEETS-05: Payload structure check
  Given: Webhook received at n8n
  Then:  All these fields present: customerName, customerEmail, customerPhone, 
         status, confidence, createdAt
         MISSING: aiScore (only confidence present), movingDate undefined for non-movers

TC-SHEETS-06: Sheet ID validation
  Given: User sets Sheet ID to invalid value
  When:  n8n tries to append
  Then:  Google Sheets node fails, n8nTriggerWorker job fails after retries
         EXPECTED GAP: User never notified — only visible in backend logs
```

---

## Cross-Cutting Issues

### Bug 1 — Follow-up `fromEmail` Missing from Payload

**File:** [src/services/queueService.ts](src/services/queueService.ts#L542-L558)  
**Impact:** Follow-up Sequence and potentially Google Sheets Logger  
**Problem:** The n8n trigger payload for non-auto-reply types doesn't include `fromEmail`. The follow-up email template uses `{{$json["fromEmail"]}}` as the sender address, so n8n sends from an empty/undefined address.

```typescript
// queueService.ts ~line 543 — add fromEmail to general payload
payload = {
  isLead: true,
  userId,
  leadId,
  customerName: lead.customerName,
  customerEmail: lead.customerEmail,
  customerPhone: lead.customerPhone,
  fromEmail: settings?.replyToEmail ?? '',   // ← ADD THIS
  businessType: ...,
  ...
}
```

### Bug 2 — Gmail Lead Trigger n8n Template Missing Node

**File:** [src/config/workflowCatalogue.ts](src/config/workflowCatalogue.ts#L64-L72)  
**Impact:** Gmail Lead Trigger n8n import fails or creates broken workflow  
**Problem:** `connections` references `'Notify Team'` node but no node with that name is defined in `nodes[]`.

### Bug 3 — Slack Template Uses Wrong Field Name

**File:** [src/config/workflowCatalogue.ts](src/config/workflowCatalogue.ts#L188-L194)  
**Impact:** Slack message shows `undefined` for email subject  
**Problem:** Template uses `$json["rawEmailSubject"]` but payload key is `subject`.

### Bug 4 — Workflows 5 & 6 Silently Do Nothing Without webhookUrl

**File:** [src/services/queueService.ts](src/services/queueService.ts#L424-L433)  
**Impact:** Follow-up Sequence and Google Sheets Logger never fire for most users  
**Problem:** `workflow.webhookUrl && !BACKEND_MANAGED_TYPES.has(workflow.type)` — if user installs and activates either workflow without setting a webhookUrl, the condition is false and no job is queued. No warning is shown.

---

## Fix Priority

| Priority | Issue | Effort | File |
|----------|-------|--------|------|
| P0 | Follow-up + Sheets silent no-op (no webhookUrl check/warning) | Low | workflowController.ts |
| P0 | Gmail Lead Trigger missing `Notify Team` node in template | Low | workflowCatalogue.ts |
| P1 | Slack template uses `rawEmailSubject` instead of `subject` | Low | workflowCatalogue.ts |
| P1 | Follow-up `fromEmail` missing from n8n payload | Low | queueService.ts |
| P1 | CRM Sync placeholder URL — no activation guard | Medium | workflowController.ts |
| P2 | `movingDate` empty for non-moving leads in Sheets | Low | queueService.ts |
| P2 | No user-visible error when n8n webhook fails | Medium | n8nTriggerWorker |
| P3 | AI reply (useAiReply) has no caching — cost per lead | Medium | emailService.ts |

---

## How to Run Tests

### Prerequisites
- Backend running: `npm run dev`
- Redis running (BullMQ queues)
- MongoDB connected
- At least one Gmail connection or SMTP config for the test user

### Manual Test Trigger (send a fake email to processing queue)

Use this endpoint to inject a test email without waiting for real Gmail:

```bash
# Inject test email directly to processing queue
curl -X POST http://localhost:3000/api/email/test-inject \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "subject": "Moving from London to Manchester in July",
    "body": "Hi, I need help moving my 3-bed house. My number is 07700 900123.",
    "fromEmail": "testlead@example.com",
    "fromName": "Test Lead"
  }'
```

> If `/api/email/test-inject` doesn't exist, the quickest workaround is to send a real email to the connected Gmail inbox while watching queue logs.

### Watch Queue Processing

```bash
# Watch logs for queue activity
npm run dev 2>&1 | grep -E "(lead-extraction|auto-reply|n8n-trigger|autoReply|Queue)"
```

### Verify in Database

```js
// MongoDB shell — check last lead and its workflow state
db.leads.find().sort({createdAt: -1}).limit(1).pretty()
db.workflows.find({isActive: true}).pretty()
db.emaillogs.find().sort({sentAt: -1}).limit(1).pretty()
```

---

## Appendix — Workflow Type Reference

| Type String | UI Name | Backend Path | backendManaged |
|-------------|---------|-------------|----------------|
| `spam_filtering` | Spam Filtering | BullMQ worker | ✅ |
| `daily_digest` | Daily Digest | BullMQ worker | ✅ |
| `lead_extraction` | (internal) | BullMQ gate | ✅ |
| `webhook_lead_trigger` | Gmail Lead Trigger | BullMQ + n8n | ❌ |
| `auto_reply` | (internal) | BullMQ worker | ✅ |
| `webhook_auto_reply` | Auto Reply Workflow | BullMQ + n8n | ❌ |
| `crm_sync` | CRM Sync | n8n webhook | ❌ |
| `slack_notification` | Slack Lead Alert | n8n webhook | ❌ |
| `google_sheets` | Google Sheets Logger | n8n webhook | ❌ |
| `follow_up` | Follow-up Sequence | n8n webhook | ❌ |
| `whatsapp_auto_reply` | WhatsApp Auto Reply | BullMQ worker | ✅ |
| `whatsapp_lead_trigger` | WhatsApp Lead Trigger | BullMQ worker | ✅ |
