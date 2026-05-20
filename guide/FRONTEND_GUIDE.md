# Frontend Update Guide

Based on the backend audit and fixes, here is everything the frontend needs to change or add.

---

## 1. Settings Page — Auto-Reply Section

### 1a. Business Type Selector (CRITICAL)

The auto-reply email now changes completely based on business type. Show users what fields the AI will extract per type so they understand what their customers will see in the email.

**Current issue:** Frontend probably shows a generic settings form with no explanation of what each business type does differently.

**What to add:** Below the business type dropdown, show a preview card:

```
Business Type: [Real Estate ▼]

─────────────────────────────────
Fields AI will extract and show in auto-reply:
  🏡 Property Address
  💰 Budget
  📅 Viewing Date
  🛏️ Bedrooms

Auto-reply headline: "We've Received Your Property Enquiry!"
─────────────────────────────────
```

**Business type → extracted fields mapping (use this exactly):**

| Business Type | Extracted Fields Shown in Email |
|--------------|--------------------------------|
| moving | Moving From, Moving To, Moving Date, Services |
| real_estate | Property, Budget, Viewing Date, Bedrooms |
| insurance | Policy Type, Coverage Amount, Renewal Date, Current Provider |
| cleaning | Service Date, Property Type, Frequency, Area Size |
| legal | Case Type, Urgency, Consultation Date |
| general | Service Required, Preferred Date, Budget |

---

### 1b. Email Signature Field (NEW — not shown on frontend before)

The backend stores `emailSignature` and now includes it in every auto-reply. The frontend needs a proper editor for this.

**Where:** Settings → Auto-Reply section, below the custom message field.

**UI spec:**
```
Email Signature
──────────────────────────────────────
| Best regards,                      |
| Sarah Johnson — Founder            |
| ABC Moving Co.                     |
| 📞 +44 7700 900000                 |
──────────────────────────────────────
ℹ️ This appears at the bottom of every auto-reply email.
   Leave blank to hide.
```

- `<textarea>` with monospace-friendly font, ~5 rows
- Plain text only — no rich text editor needed (backend preserves line breaks with `white-space: pre-line`)
- Save via `PATCH /api/settings` with `{ emailSignature: "..." }` OR the dedicated `PATCH /api/settings/signature` with `{ signature: "..." }`
- Character limit: 500 chars is reasonable

---

### 1c. Auto-Reply Subject Line — Add Variable Hints

The backend already supports a custom `autoReplySubject`. The frontend likely shows a plain text input. Improve it by showing what variables are available (future-proofing for when you add dynamic subjects):

```
Email Subject
──────────────────────────────────────────────────────────
| Thank you for your enquiry - We'll be in touch soon!  |
──────────────────────────────────────────────────────────
Tip: You can use {{businessName}} in the subject line.
```

**API:** `PATCH /api/settings` with `{ autoReplySubject: "..." }`

---

### 1d. Auto-Reply Template — Fix Default Text

The default template text said "your moving request" even for non-moving businesses. The backend now defaults to a generic message. **Existing users who signed up before this fix still have the old text stored.** Consider a one-time migration notice:

```
⚠️ Your current auto-reply message mentions "moving request" but your 
   business type is set to "Insurance". Update your message to match.
   [Update Message]
```

Detection logic: if `settings.businessType !== 'moving'` and `settings.autoReplyTemplate.includes('moving')` → show the warning.

---

### 1e. Auto-Reply Email Preview — Now Business-Type Aware

The `POST /api/settings/test-template` endpoint generates a preview HTML. But the current backend uses hardcoded moving sample data:

```typescript
// Current backend sample data (settingsController.ts:48)
const sampleLead = {
  customerName: 'John Smith',
  movingDate: '15th June 2025',
  fromAddress: '123 High Street, London',
  toAddress: '456 New Road, Manchester',
  services: ['Full Packing', 'Storage'],
}
```

**Problem:** This sample will always render a moving-style email even if the user is an insurance broker.

**Fix needed on backend too** (see below), but on the frontend:
- Pass the user's `businessType` in the test-template request body
- Show a note: "Preview uses sample data for your business type"

**Interim workaround (frontend only):** Read `settings.businessType` from the existing settings and add a label on the preview: "This is a preview for a [Business Type] business."

**Backend fix to request:** Update `testEmailTemplate` in `settingsController.ts` to use business-type-specific sample data based on `settings.businessType`.

---

## 2. Workflows Page

### 2a. Remove "Auto Reply Workflow" Template

The `GET /api/workflows/templates` endpoint returns 6 workflow templates. **Do not show** the "Auto Reply Workflow" template (`id: 'auto-reply'`) to users anymore.

**Why:** Auto-reply is now handled entirely by the backend. If a user creates an `auto_reply` workflow, it will be silently skipped by the trigger loop (the bug fix). Showing it confuses users into thinking they need to set it up.

**Frontend filter:**
```javascript
const templates = await fetch('/api/workflows/templates')
const visibleTemplates = templates.filter(t => t.id !== 'auto-reply')
```

**What to show instead:** Add an info box on the workflows page:
```
ℹ️ Auto-reply emails are sent automatically by RealFlow — no workflow needed.
   Configure them in Settings → Auto-Reply.
   Use workflows for external integrations like CRM sync and Slack alerts.
```

### 2b. Workflow Templates — Better Descriptions

The templates currently have generic descriptions. Update the display copy:

| Template | Better Description to Show |
|---------|---------------------------|
| Gmail Lead Trigger | "Notify n8n when a new lead is captured. The extraction happens automatically — use this to trigger your own n8n automations." |
| CRM Sync | "Push new leads to HubSpot, Salesforce, Pipedrive, or any CRM via HTTP webhook." |
| Slack Lead Alert | "Post a Slack message instantly when a high-scoring lead arrives." |
| Google Sheets Logger | "Log every lead to a Google Sheet for tracking and reporting." |
| Follow-up Sequence | "Send a follow-up email 24 hours after the auto-reply to leads who haven't responded." |

### 2c. Active Workflow Conflict Warning

If a user somehow has an existing `auto_reply` workflow that's still active, show a warning:
```
⚠️ You have an "Auto Reply" workflow active. This is no longer needed — 
   RealFlow handles auto-replies automatically. Deactivate or delete it 
   to avoid confusion.
   [Deactivate] [Delete]
```

Detection: any workflow where `workflow.type === 'auto_reply' && workflow.isActive === true`.

---

## 3. Lead Detail Page

### 3a. Show `extraFields` Per Business Type

Leads now store business-specific data in `extraFields` (a key-value map). The lead detail page should display these with readable labels based on the business type.

**API response includes:**
```json
{
  "businessType": "real_estate",
  "extraFields": {
    "propertyAddress": "14 Oak Lane, Bristol",
    "budget": "£350,000–£400,000",
    "viewingDate": "Saturday 22nd June",
    "bedrooms": "3"
  }
}
```

**Label mapping for display:**

```javascript
const FIELD_LABELS = {
  // real_estate
  propertyAddress: 'Property',
  budget: 'Budget',
  viewingDate: 'Viewing Date',
  buyerOrSeller: 'Buyer or Seller',
  bedrooms: 'Bedrooms',
  timeline: 'Timeline',
  // insurance
  policyType: 'Policy Type',
  coverageAmount: 'Coverage Amount',
  renewalDate: 'Renewal Date',
  currentProvider: 'Current Provider',
  vehicleCount: 'Vehicle Count',
  // cleaning
  serviceDate: 'Service Date',
  propertyType: 'Property Type',
  rooms: 'Rooms',
  frequency: 'Frequency',
  squareFeet: 'Area (sq ft)',
  // legal
  caseType: 'Case Type',
  urgency: 'Urgency',
  consultationDate: 'Consultation Date',
  jurisdiction: 'Jurisdiction',
  hasRetainer: 'Has Retainer',
  // general
  serviceRequired: 'Service Required',
  preferredDate: 'Preferred Date',
}
```

Iterate `Object.entries(lead.extraFields)` and show any non-empty values with their label.

### 3b. Show Signature Info Was Sent

Add a small indicator on leads where auto-reply was sent, showing which email provider was used (already in EmailLog). This helps users debug delivery issues:

```
Auto-reply sent ✅  via SMTP · 19 May 2026, 14:32
```

The `emailLogId` on the lead links to the EmailLog record which has `status` and `gmailMessageId`.

---

## 4. New Fields in API Responses (Verify Frontend Handles These)

These fields now exist on the backend. Confirm the frontend doesn't break if they're non-null.

| Model | Field | Type | Notes |
|-------|-------|------|-------|
| Lead | `businessType` | string enum | May not have been displayed before |
| Lead | `extraFields` | `Record<string, string>` | New — display per business type |
| Lead | `aiScoreReason` | string or null | Show as tooltip next to AI score |
| Lead | `sentiment` | 'positive'/'neutral'/'negative'/'urgent' or null | Show as badge |
| Settings | `emailSignature` | string | Now used in emails — needs UI |
| Settings | `businessName` | string | Used as company header in emails |
| EmailLog | `body` | string (HTML) | Now populated — can show preview |

---

## 5. Sentiment & AI Score Display

The AI returns `sentiment` and `aiScore` (1–10) for every lead. These should be visible in the lead list and lead detail.

**Lead list badges:**
```
[Score: 8/10] [Urgent]   ← high priority, show in red/orange
[Score: 3/10] [Neutral]  ← low priority, show greyed out
```

**Sentiment colour mapping:**
- `urgent` → red badge, show at top of list
- `positive` → green badge
- `neutral` → grey badge
- `negative` → amber badge (worth a callback, but lower intent)

**AI Score:**
- 8–10 → Hot lead 🔥
- 5–7 → Warm lead
- 1–4 → Cold lead ❄️

**Sort default:** Sort leads by `aiScore DESC` by default (highest scoring first). Currently the API supports sorting — pass `?sortBy=aiScore&order=desc` if the endpoint supports it, otherwise sort client-side.

---

## 6. Settings Page — Complete Field Checklist

Cross-check your settings form sends all of these fields to `PATCH /api/settings`:

```typescript
{
  businessType: 'moving' | 'real_estate' | 'insurance' | 'cleaning' | 'legal' | 'general'
  businessName: string           // shown as company name in email header
  autoReply: boolean             // master toggle
  autoReplySubject: string       // email subject line
  autoReplyTemplate: string      // custom message shown inside the email
  emailSignature: string         // NEW — footer signature block
  minimumConfidence: number      // 0–100, leads below this score are skipped
  notifications: {
    newLead: boolean
    autoReplySent: boolean
    workflowTriggered: boolean
    dailySummary: boolean
    emailAddress: string         // where to send digest and notifications
  }
}
```

**Commonly missing:** `emailSignature`, `minimumConfidence`, `notifications.emailAddress` (needed for daily digest to work).

---

## 7. Priority Order for Frontend Changes

| Priority | Change | Impact |
|----------|--------|--------|
| 🔴 High | Add email signature field to settings | Users can't set signature without it |
| 🔴 High | Remove "Auto Reply Workflow" from templates list | Prevents user confusion and wrong setup |
| 🔴 High | Show `extraFields` on lead detail page | Without this, data extracted by AI is invisible |
| 🟡 Medium | Business type info card (what fields get extracted) | Helps users understand what they're getting |
| 🟡 Medium | Fix auto-reply preview to use correct business type sample data | Current preview always shows moving content |
| 🟡 Medium | Sentiment + AI score badges on lead list | Core value prop — leads should be prioritised visually |
| 🟢 Low | Warn if auto-reply template still says "moving request" | Cosmetic, but removes confusion for non-moving businesses |
| 🟢 Low | Show active auto_reply workflow conflict warning | Edge case — only affects users who set this up before the fix |
| 🟢 Low | Show email provider used (SMTP vs Gmail) on sent auto-replies | Debugging aid |
