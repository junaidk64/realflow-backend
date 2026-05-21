# Email Lead Classification Flow

## Overview

When an email arrives in a user's Gmail inbox, the backend automatically determines whether it represents a **lead** (business opportunity) or **not a lead** (spam, newsletter, etc.). This is a **hybrid AI-first, rule-fallback** system with multiple decision gates.

---

## High-Level Architecture

```
Gmail Webhook (incoming notification)
    ↓
Handle Webhook [webhookController.ts]
    ↓
Queue Email Processing Job [queueService.ts]
    ↓
Fetch New Inbox Emails [gmailService.ts]
    ↓
Create Email Log Entry [queueService.ts]
    ↓
Queue Lead Extraction Job [queueService.ts]
    ↓
[DECISION TREE STARTS HERE]
```

---

## Decision Tree: Is It a Lead?

### Gate 1: Workflow Pre-check
**File:** `src/services/queueService.ts:168-180`

- ❓ **Is `lead_extraction` workflow installed AND active?**
  - ✅ YES → Continue to Gate 2
  - ❌ NO → **Skip entire extraction**, log as `skipped: 'lead_extraction_disabled'`

### Gate 2: Spam Filtering (Optional)
**File:** `src/services/queueService.ts:183-191` | `src/services/spamFilter.ts:20-27`

- ❓ **Is `spam_filtering` workflow active?**
  - ✅ YES → Check global spam patterns + business-type-specific keywords
    - **Spam patterns detected** (e.g., "unsubscribe", "newsletter", "noreply@", "delivery failure"):
      - ✅ **Skip lead creation**, return `{ isLead: false, reason: 'spam' }`
    - **Not spam** → Continue to Gate 3
  - ❌ NO → Skip spam check, continue to Gate 3

### Gate 3: AI Classification (Primary Path)
**File:** `src/services/queueService.ts:207-237` | `src/services/aiService.ts:29-97`

Uses **Claude Haiku 4.5** with **Gemini 1.5 Flash** preprocessor.

#### Step 3a: Gemini Pre-classification (Free)
**File:** `src/services/geminiService.ts:15-44`

- **Purpose:** Quick spam screening + email complexity assessment
- **Classification:**
  - `'spam'` → Gemini detected spam signals
    - ✅ Return `null` → **Skip Claude entirely**, log `{ isLead: false, reason: 'spam' }`
  - `'simple'` → Short direct email (<200 words)
    - ✅ Send directly to Claude
  - `'complex'` → Long/multi-part thread (>800 chars)
    - ✅ Summarize to ~200 words before Claude (saves tokens & cost)
  - **Error:** Default to `'simple'` to prevent pipeline breaks

#### Step 3b: Claude Extraction & Scoring
**File:** `src/services/aiService.ts:34-97`

- **Inputs:**
  - Processed email body (original or Gemini-summarized)
  - From email, subject
  - Business type profile (moving, real_estate, insurance, cleaning, legal, general)

- **Claude extracts:**
  - `isLead` (boolean)
  - `customerName`, `customerEmail`, `customerPhone`
  - **Business-specific fields** (e.g., for moving: `fromAddress`, `toAddress`, `movingDate`, `services`)
  - `aiScore` (1–10 scale)
  - `aiScoreReason` (max 100 chars)
  - `sentiment` ('positive' | 'neutral' | 'negative' | 'urgent')

- **Decision:**
  - ✅ `isLead === true` → Proceed to Deduplication (Step 4)
  - ❌ `isLead === false` → **Stop**, return `{ isLead: false, reason: 'not_a_lead' }`

#### Step 3c: AI Error Fallback
**File:** `src/services/queueService.ts:240-248`

- **If Claude call fails (network, timeout, etc.):**
  - Log warning: `"AI extraction failed, using fallback"`
  - Fall back to **Legacy Rule Parser** (see Gate 4)

### Gate 4: Rule-Based Fallback (Legacy)
**File:** `src/services/leadExtractionService.ts:12-68` | `src/utils/emailParser.ts:63-401`

Used when:
1. AI is disabled/unavailable
2. Claude request fails

#### Step 4a: Lead-Type Keyword Matching
**File:** `src/utils/emailParser.ts:402-451`

- **Keyword categories checked:**
  - Moving: "moving", "removal", "relocation", "from address", "to address", "packing", etc.
  - Real Estate: "property", "estate agent", "viewing", "landlord", "freehold", etc.
  - Insurance: "insurance quote", "policy", "coverage", "claim", etc.
  - Cleaning: "cleaning service", "deep clean", "carpet cleaning", etc.
  - Legal: "legal advice", "solicitor", "conveyancing", etc.
  - General: "quote", "enquiry", "estimate", "appointment", "booking", etc.

- **Spam keyword blockers:**
  - "unsubscribe", "newsletter", "marketing", "promotion", "no-reply", "noreply", etc.

- **Score requirement:**
  - Must match ≥ 2 lead keywords
  - If spam keywords present AND < 3 lead keywords → **Reject**

#### Step 4b: Confidence Scoring & Extraction
**File:** `src/utils/emailParser.ts:63-401`

- **Regex patterns extract:**
  - Customer name, email, phone
  - Business-specific fields (moving dates, addresses, services, etc.)
  - Incremental confidence boost for each field found

- **Final confidence = cumulative score**
  - Capped at 100

#### Step 4c: Minimum Confidence Threshold
**File:** `src/services/queueService.ts:165`

```typescript
const minConfidence = settings?.minimumConfidence || 30; // default 30%
```

- ❓ **Does confidence ≥ threshold?**
  - ✅ YES → Lead accepted
  - ❌ NO → **Stop**, return `{ isLead: false, reason: 'low_confidence' }`

---

## Step 5: Deduplication

**File:** `src/services/queueService.ts:250-264`

### Method A: Fingerprint-based Dedup
- **Fingerprint:** SHA256 hash of `(email.toLowerCase() | phone.digits | businessType)`
- ❓ **Fingerprint exists in database for this user?**
  - ✅ YES → Append to `duplicateEmailIds` array**, return `{ isLead: true, duplicate: true }`
  - ❌ NO → Continue to Method B

### Method B: Exact Email ID Match
- ❓ **Email's raw Gmail ID already in DB?**
  - ✅ YES → **Skip**, return `{ isLead: true, duplicate: true }`
  - ❌ NO → **Proceed to lead creation**

---

## Step 6: Lead Creation

**File:** `src/services/queueService.ts:266-278`

```typescript
const lead = await Lead.create({
  userId,
  source: 'email',
  rawEmailId: messageId,
  rawEmailSubject: subject,
  rawEmailFrom: fromEmail,
  customerName,
  customerEmail,
  businessType,
  extraFields: { /* business-specific */ },
  notes: '',
  status: 'new',
  confidence,           // AI: aiScore*10, Fallback: regex score
  aiScore,              // 1-10 (null if fallback used)
  aiScoreReason,        // Claude's explanation (null if fallback used)
  sentiment,            // positive|neutral|negative|urgent (null if fallback used)
  aiProcessed,          // true if Claude was used
  fingerprint: fp,
  createdAt: now,
})
```

---

## Step 7: Post-Lead-Creation Workflows

After a lead is successfully created, the system triggers **optional workflows** based on installed & active configurations:

**File:** `src/services/queueService.ts:280-295`

### 7a. Notification Workflow
- ❓ **Is `notification` workflow active?**
  - ✅ YES → Create in-app notification
    - Message: `"New Lead Detected: [customerName/email] — score [aiScore or confidence]"`

### 7b. Auto-Reply Workflow
- ❓ **Is `auto_reply` workflow active?**
  - ✅ YES → Queue auto-reply job
    - Uses assigned template or default business-type template
    - Email sent to `customerEmail`
    - Marked as `autoReplySent: true` after successful send

### 7c. Custom n8n Webhooks
- ❓ **Any custom workflows with webhook URLs (not backend-managed types)?**
  - ✅ YES → Queue n8n trigger job for each
    - Payload includes: leadId, userId, customerName, email, phone, aiScore, sentiment, status

---

## Decision Confidence Score

| Source | Confidence Formula | Range |
|--------|-------------------|-------|
| **AI (Claude)** | `aiScore * 10` | 10–100 |
| **Fallback (Regex)** | Cumulative regex matches + boost | 0–100 |

### AI Score Breakdown (Claude)
- 1–3: Low quality lead
- 4–6: Moderate lead (needs follow-up)
- 7–8: Strong lead
- 9–10: High-intent lead (urgent, specific details)

### Fallback Confidence Breakdown
- 0–20: Rejected (too low)
- 21–50: Low confidence (saved as lead but flagged)
- 51–75: Medium confidence (good lead)
- 76–100: High confidence (excellent data extraction)

---

## Configuration & Thresholds

**File:** `src/models/Settings.ts:22`

| Setting | Default | Type | Purpose |
|---------|---------|------|---------|
| `businessType` | `'general'` | string | Determines lead profile (keywords, fields) |
| `minimumConfidence` | `30` | number | Minimum fallback regex score to accept lead |
| `autoReplyTemplate` | system default | string | Custom HTML template for auto-replies |
| `autoReplySubject` | "Thank you for your enquiry!" | string | Email subject for auto-replies |
| `emailSignature` | empty | string | Sender signature for auto-replies |

---

## Error Handling & Logging

### Graceful Degradation
- **Gemini fails** → Default to `'simple'` → Claude processes anyway
- **Claude fails** → Fall back to regex parser
- **Regex parser fails** → Log error, reject lead, don't crash

### Webhook Logging
**File:** `src/models/WebhookLog.ts`

All incoming webhooks logged with:
- `type`: 'gmail_push' | 'n8n_callback'
- `status`: 'received' | 'processing' | 'processed' | 'failed'
- `payload`: raw request body
- `error`: error message (if failed)

### Lead Extraction Events
**File:** `src/utils/logger.ts`

Logs include:
- `Lead created: {leadId} from {fromEmail}`
- `Duplicate lead (fingerprint) skipped: {messageId}`
- `Lead extraction skipped — workflow not installed or disabled`
- `Gemini classified email from {fromEmail} as spam — skipped Claude`
- `AI extraction failed, using fallback`

---

## Example Flows

### Scenario 1: AI Accepts Lead
```
Gmail → Webhook → Email Processing Queue
  ↓
Lead Extraction Queue
  ↓
Gate 1: lead_extraction ACTIVE ✅
  ↓
Gate 2: spam_filtering checks → NOT spam ✅
  ↓
Gate 3: AI (Claude)
  ├─ Gemini: classification = 'simple' ✅
  ├─ Claude: { isLead: true, aiScore: 8, sentiment: 'urgent' } ✅
  │
Gate 4: [SKIPPED — AI succeeded]
  ↓
Step 5: Deduplication
  ├─ No fingerprint match ✅
  ├─ No email ID match ✅
  │
Step 6: Lead Created
  ├─ confidence = 80 (8 * 10)
  ├─ source = 'email'
  ├─ aiProcessed = true
  │
Step 7: Post-Workflows
  ├─ notification → create in-app alert ✅
  ├─ auto_reply → queue reply job ✅
  ├─ custom webhooks → trigger n8n ✅
```

### Scenario 2: AI Fails, Fallback Accepts
```
Gmail → Webhook → Email Processing Queue
  ↓
Lead Extraction Queue
  ↓
Gate 1: lead_extraction ACTIVE ✅
  ↓
Gate 2: spam_filtering → NOT spam ✅
  ↓
Gate 3: AI (Claude)
  ├─ Gemini: 'complex' → summarize
  ├─ Claude: Network timeout ❌
  │
Gate 4: Fallback (Regex Parser)
  ├─ Keyword match: "moving" + "quote" ✅
  ├─ Extracted: name, phone, moving date
  ├─ Confidence score = 65 ✅
  ├─ 65 > threshold (30) ✅
  │
Step 5: Deduplication
  ├─ Fingerprint: new ✅
  │
Step 6: Lead Created
  ├─ confidence = 65 (regex score)
  ├─ aiScore = null
  ├─ aiProcessed = false
  ├─ source = 'email'
  │
Step 7: Post-Workflows
  ├─ notification ✅
  ├─ auto_reply ✅
```

### Scenario 3: Spam Rejected
```
Gmail → Webhook → Email Processing Queue
  ↓
Lead Extraction Queue
  ↓
Gate 1: lead_extraction ACTIVE ✅
  ↓
Gate 2: spam_filtering ACTIVE
  ├─ Matches: "unsubscribe" + "noreply@" ❌
  │
REJECTED: { isLead: false, reason: 'spam' }

[No lead created, no workflows triggered]
```

### Scenario 4: Low Confidence Rejection
```
Gmail → Webhook → Email Processing Queue
  ↓
Lead Extraction Queue
  ↓
Gates 1–2: Pass ✅
  ↓
Gate 3: AI Disabled OR Claude: { isLead: false } ❌
  ↓
Gate 4: Fallback Regex
  ├─ Keyword match: only "contact" (1 keyword, need 2) ❌
  │
REJECTED: { isLead: false, reason: 'not_a_lead' }

[No lead created, no workflows triggered]
```

---

## Key Files Referenced

| File | Responsibility |
|------|-----------------|
| `src/routes/webhooks.ts` | HTTP route definitions |
| `src/controllers/webhookController.ts` | Gmail webhook entry point |
| `src/services/queueService.ts` | Job queue workers (email processing, lead extraction, auto-reply, n8n) |
| `src/services/gmailService.ts` | Gmail API calls & message parsing |
| `src/services/aiService.ts` | Claude Haiku lead extraction & scoring |
| `src/services/geminiService.ts` | Gemini Flash spam classification & summarization |
| `src/services/spamFilter.ts` | Rule-based spam detection |
| `src/services/leadExtractionService.ts` | Fallback regex lead parser |
| `src/utils/emailParser.ts` | Email parsing & field extraction logic |
| `src/models/Lead.ts` | Lead schema & database model |
| `src/models/WebhookLog.ts` | Webhook event logging |
| `src/config/leadProfiles.ts` | Business-type profiles (keywords, fields) |
| `src/config/workflowCatalogue.ts` | Available workflow types & metadata |

---

## Performance & Cost

### Token Usage (Claude Haiku 4.5)
- **Input:** $0.80 per 1M tokens
- **Output:** $4.00 per 1M tokens
- **Cache (5-min TTL):** $0.08 per 1M cached tokens

### Optimization Strategies
1. **Gemini pre-classification:** Free spam filtering before Claude sees email
2. **Gemini summarization:** Reduces token count for long emails
3. **Prompt caching:** System prompt cached for 5 minutes
4. **Haiku model:** Cheapest Claude tier for lead extraction

### Typical Cost per Email
- **Spam (Gemini only):** ~$0.00 (free, fast)
- **Lead (AI path):** ~$0.001–$0.005 (depends on email length & complexity)
- **Lead (fallback only):** $0.00 (no API calls, regex-based)

---

## Future Enhancements

- [ ] Support for multi-language email classification
- [ ] Machine learning model retraining based on user feedback loops
- [ ] Custom keyword profiles per organization
- [ ] Webhook rate limiting per user/organization
- [ ] Lead scoring refinement (recency boost, engagement history)
- [ ] Integration with external lead scoring APIs

