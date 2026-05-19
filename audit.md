# RealFlow Backend — Comprehensive Audit

**Date:** 2026-05-19  
**Scope:** Full backend including AI, n8n integration, auto-reply, email sending, queues, security

---

## Executive Summary

The architecture is solid — BullMQ queues, Mongoose, prompt caching, fingerprint dedup, SMTP/Gmail fallback. The critical issues are: (1) the auto-reply email was hardcoded for moving companies only, sending broken emails to real estate / insurance / legal businesses; (2) a double-send bug where customers could receive two auto-reply emails; (3) the business signature was never included in emails despite being stored. All three are now fixed.

---

## What Is Good

| Area | Assessment |
|------|-----------|
| Queue architecture | BullMQ with 4 dedicated queues, retry/backoff, concurrency limits — production-ready |
| AI cost control | Prompt caching on extraction (5-min TTL), token truncation (800 chars), usage logging |
| Fingerprint dedup | SHA256 of email+phone+businessType prevents duplicate leads across emails |
| SMTP → Gmail fallback | Resilient email sending with automatic fallback |
| Spam pre-filter | 14 spam patterns checked before AI — zero cost on junk |
| Credential security | AES encryption on all stored tokens and SMTP passwords |
| Plan limits | Free/Basic/Pro enforced per month with real DB count |
| Rate limiting | Global + per-route rate limiters with helmet security headers |
| Health check | Checks both MongoDB and Redis readiness |
| AI fallback | Legacy regex extraction kicks in if Claude API fails |

---

## Critical Bugs Fixed

### 1. Auto-reply email hardcoded for moving companies
**File:** `src/services/emailService.ts`  
**Problem:** `generateAutoReplyHTML()` showed "Moving From", "Moving To", "Moving Date" for ALL business types. A cleaning company or law firm would send a completely irrelevant email to their leads.  
**Fix:** Rewrote to be fully business-type aware. Each type now shows its own relevant fields from `extraFields` + has its own headline, message, and "What Happens Next" steps.

### 2. Double auto-reply send bug
**File:** `src/services/queueService.ts`  
**Problem:** When `settings.autoReply = true` AND an active workflow with `type: 'auto_reply'` existed, the customer received TWO emails — one from the backend queue and one triggered via n8n.  
**Fix:** Added `workflow.type !== 'auto_reply'` check in the n8n trigger loop. Backend owns auto-reply; n8n workflows are for external integrations only.

### 3. Email signature never included
**File:** `src/services/emailService.ts`  
**Problem:** `Settings.emailSignature` was stored and shown in the dashboard but `generateAutoReplyHTML()` never used it. The `buildAutoReplyPayload()` (n8n path) had it, but the direct backend path didn't.  
**Fix:** Signature now appears in the email footer when `settings.emailSignature` is non-empty.

### 4. EmailLog body was always empty
**File:** `src/services/queueService.ts`  
**Problem:** `EmailLog.create({ body: '' })` stored nothing. No audit trail of what was actually sent.  
**Fix:** Now stores `result.html` — the actual HTML content that was sent.

---

## Other Issues

### console.log in production service
**File:** `src/services/n8nService.ts:150`  
**Problem:** `console.log()` instead of `logger.debug()` — bypasses the logging system, can't be filtered or silenced in production.  
**Fix:** Changed to `logger.debug()`.

### Digest summary not using prompt caching
**File:** `src/services/aiService.ts`  
**Problem:** `generateDigestSummary()` had no system prompt with cache_control. Every daily digest call paid full input token price.  
**Fix:** Added stable system prompt with `cache_control: ephemeral`. Also trimmed max_tokens from 150 → 120 (2 sentences never needs more).

### Typo endpoint left in codebase
**File:** `src/index.ts:103`  
**Problem:** `app.post('/api/recieved', ...)` — misspelled, logs the body and does nothing. Looks like a forgotten debug endpoint.  
**Recommendation:** Remove it or secure it with auth middleware if it serves a purpose.

### autoReplyTemplate default says "moving request"
**File:** `src/models/Settings.ts:49`  
**Problem:** Default template text is `"...your moving request..."` even for insurance, legal, cleaning businesses.  
**Recommendation:** Change default to `"Thank you for your enquiry! We have received your request and will be in touch within 2 hours."` — generic enough for all business types.

### AI extraction truncates at 800 chars
**File:** `src/services/aiService.ts:35`  
**Problem:** Phone numbers and addresses are often at the bottom of emails, especially in signatures. 800 chars may miss them.  
**Recommendation:** Increase to 1200 chars. Still cheap on Haiku ($0.00096/call at cached rates). The signal-to-noise improvement is worth it.

### BullMQ jobs have no dead-letter queue
**File:** `src/services/queueService.ts`  
**Problem:** Failed jobs (after 3 attempts) are logged but not stored anywhere inspectable. Production debugging is hard.  
**Recommendation:** Add a `failed` event handler that writes to a `FailedJob` collection or sends an admin notification.

### No validation on webhook payload
**File:** `src/controllers/webhookController.ts`  
**Problem:** `handleN8nCallback` directly uses `body.leadId`, `body.status`, `body.workflowId` without validating their types or formats. A malformed n8n payload could cause unexpected DB updates.  
**Recommendation:** Add Zod validation on the callback body.

---

## Security Assessment

| Check | Status |
|-------|--------|
| JWT auth on protected routes | ✅ |
| N8n endpoints use secret header | ✅ |
| SMTP/OAuth tokens encrypted at rest | ✅ |
| Helmet security headers | ✅ |
| CORS whitelist | ✅ |
| Rate limiting on auth + global | ✅ |
| Input sanitization | ⚠️ No Zod on webhook callbacks |
| Gmail webhook verified | ⚠️ No signature verification on Pub/Sub messages |
| SQL injection | N/A (MongoDB) |
| XSS in emails | ⚠️ Template vars are not HTML-escaped before injection |

**Gmail webhook risk:** Google Pub/Sub messages should be verified by checking the JWT in the `Authorization` header. Currently any POST to `/api/webhooks/gmail` is processed. Low risk (attacker needs to know the URL and format the payload correctly) but worth fixing.

**XSS in email templates:** `{{customerName}}` replacement in `buildAutoReplyPayload` doesn't HTML-escape values. If a lead's name contains `<script>`, it goes straight into the HTML. Add an `escapeHtml()` helper on all template variable substitutions.

---

## Token Cost Analysis (Current)

| Operation | Model | Tokens/call | Cost/call (cached) |
|-----------|-------|-------------|---------------------|
| Lead extraction | Haiku 4.5 | ~200 in / 200 out | ~$0.00096 |
| Daily digest | Haiku 4.5 | ~80 in / 80 out | ~$0.00034 |
| Auto-reply | None | 0 | $0.00 |

Auto-reply emails are pure template rendering — **no AI tokens needed**. This is the right approach.

**Monthly cost estimate:**
- 500 leads/month (Basic plan): ~$0.48/month in AI costs
- 30 leads/month (Free plan): ~$0.03/month

The prompt caching is working correctly. After the first extraction call, the 4-line system prompt is cached and the 10x cheaper cache rate applies.

---

## Architecture Diagram

```
Gmail (Pub/Sub push)
        │
        ▼
/api/webhooks/gmail
        │
        ▼
emailProcessingQueue  (BullMQ)
        │
        ▼ processNewEmails()
leadExtractionQueue  (BullMQ)
        │
        ├── isSpam? → skip (0 cost)
        ├── AI extract (Haiku, cached)
        ├── Fallback regex if AI fails
        ├── Fingerprint dedup check
        ├── Save Lead to MongoDB
        │
        ├──► autoReplyQueue (if settings.autoReply)
        │         └── sendAutoReply() → SMTP or Gmail
        │
        └──► n8nTriggerQueue (if active workflows, type ≠ auto_reply)
                  └── triggerWebhook() → n8n
```

---

## Priority Fix List

1. ✅ **Fixed** — Business-type aware auto-reply email
2. ✅ **Fixed** — Double-send bug (n8n + backend)
3. ✅ **Fixed** — Signature included in emails
4. ✅ **Fixed** — EmailLog body stored
5. ✅ **Fixed** — console.log → logger
6. ✅ **Fixed** — Digest prompt caching
7. ⬜ **Do next** — Change default `autoReplyTemplate` text (remove "moving request")
8. ⬜ **Do next** — Increase AI extraction truncation from 800 → 1200 chars
9. ⬜ **Do next** — HTML-escape template variables in `buildAutoReplyPayload`
10. ⬜ **Do next** — Remove or secure the `/api/recieved` endpoint
11. ⬜ **Future** — Gmail Pub/Sub JWT verification
12. ⬜ **Future** — Dead-letter queue for failed BullMQ jobs
