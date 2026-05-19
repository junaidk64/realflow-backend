# RealFlow — Backend Integration Guide
**Purpose:** What the backend must confirm, fix, or add to support the current frontend. Organised by priority.

---

## Quick Reference: New/Changed API Contracts

| Endpoint | Change | Priority |
|----------|--------|----------|
| `PATCH /api/settings` | Must accept `autoReplySubject`, `autoReplyTemplate` | Critical |
| `GET /api/settings` response | Must return `autoReplySubject`, `autoReplyTemplate`, `emailSignature` | Critical |
| `POST /api/settings/test-template` | Must use business-type sample data | High |
| `POST /api/email/send` | Must set `From` header to `"businessName" <email>` | High |
| `GET /api/leads` | `aiScore`, `sentiment`, `extraFields`, `businessType` in response | High |
| `GET /api/leads?sortBy=aiScore` | Must support aiScore as sort field | Medium |
| `PATCH /api/workflows/:id` | Already exists — confirm `isActive` patch works | Medium |

---

## 1. Settings Model — Confirm These Fields Exist

The frontend now sends and reads these fields. Confirm they are in the Settings Mongoose schema:

```typescript
// Confirm your Settings schema includes ALL of these:
{
  businessType:       { type: String, enum: ['moving','real_estate','insurance','cleaning','legal','general'], default: 'general' },
  businessName:       { type: String, default: '' },
  autoReply:          { type: Boolean, default: true },
  autoReplySubject:   { type: String, default: '' },   // ← confirm this exists
  autoReplyTemplate:  { type: String, default: '' },   // ← confirm this exists
  emailSignature:     { type: String, default: '', maxlength: 500 }, // ← confirm + add maxlength
  n8nWebhookUrl:      { type: String, default: '' },
  minimumConfidence:  { type: Number, default: 40, min: 0, max: 100 },
  notifications: {
    newLead:          { type: Boolean, default: true },
    autoReplySent:    { type: Boolean, default: true },
    workflowTriggered:{ type: Boolean, default: false },
    dailySummary:     { type: Boolean, default: true },
    emailAddress:     { type: String, default: '' },
  },
}
```

**If `autoReplySubject` or `autoReplyTemplate` are missing from the schema**, the PATCH will silently drop them and the user's saved subject/template will be lost.

---

## 2. `PATCH /api/settings` — Accept All Fields

The frontend `PATCH /api/settings` now sends this full payload:

```json
{
  "businessType": "insurance",
  "businessName": "Smith Insurance Ltd",
  "autoReply": true,
  "autoReplySubject": "Re: Your insurance quote request",
  "autoReplyTemplate": "Hello {{customerName}},\n\nThank you for contacting {{businessName}}...\n\n{{emailSignature}}",
  "emailSignature": "Best regards,\nJohn Smith\nSmith Insurance Ltd\n+44 7700 900000",
  "n8nWebhookUrl": "",
  "minimumConfidence": 40,
  "notifications": {
    "newLead": true,
    "autoReplySent": true,
    "workflowTriggered": false,
    "dailySummary": true,
    "emailAddress": "alerts@smithinsurance.co.uk"
  }
}
```

Ensure the controller uses a whitelist (not `Object.assign(settings, req.body)`) — only update allowed fields.

---

## 3. Auto-Reply Rendering — Wire `emailSignature` and `autoReplySubject`

**Current issue (from audit):** `emailSignature` is stored in Settings but likely NOT injected into the auto-reply template when it renders. Users set a signature but it never appears in emails.

**Fix in `settingsService.ts` / `queueService.ts` / wherever template rendering happens:**

```typescript
// When building the variables object for template rendering:
const variables = {
  customerName:   lead.customerName     || 'there',
  customerEmail:  lead.customerEmail    || '',
  customerPhone:  lead.customerPhone    || '',
  businessName:   settings.businessName || 'Our Team',
  emailSignature: settings.emailSignature
    ? settings.emailSignature.replace(/\n/g, '<br>') // preserve line breaks in HTML
    : '',
  // business-type specific fields
  ...(lead.businessType === 'moving' ? {
    fromAddress: lead.fromAddress || '',
    toAddress:   lead.toAddress   || '',
    movingDate:  lead.movingDate  || '',
    services:    lead.services?.join(', ') || '',
  } : {}),
  // any extraFields from AI extraction
  ...(lead.extraFields || {}),
};

// Subject line:
const subject = settings.autoReplySubject
  || defaultSubjectForBusinessType(settings.businessType)
  || 'Thank you for your enquiry';

const renderedSubject = subject.replace(/\{\{businessName\}\}/g, settings.businessName);
```

---

## 4. Email From Header — Set Business Name

**Current issue:** Emails likely send as `From: user@gmail.com`. This looks impersonal and reduces open rates.

**Fix in your email service (`emailService.ts`):**

```typescript
// When calling Gmail API or Nodemailer:
const fromHeader = settings.businessName
  ? `"${settings.businessName}" <${senderEmail}>`
  : senderEmail;

// Gmail API (via googleapis):
await gmail.users.messages.send({
  userId: 'me',
  requestBody: {
    raw: createMimeMessage({
      from: fromHeader,   // ← set this
      to: lead.customerEmail,
      subject: renderedSubject,
      html: renderedHtml,
    }),
  },
});

// Or Nodemailer:
await transporter.sendMail({
  from: fromHeader,    // ← set this
  to: lead.customerEmail,
  subject: renderedSubject,
  html: renderedHtml,
});
```

This is a 5-minute fix that improves open rates significantly.

---

## 5. Fix `POST /api/settings/test-template` — Business-Type Sample Data

**Current issue (line 48 of settingsController.ts):** The test preview always uses moving sample data even when the user's business type is `insurance`, `legal`, etc.

```typescript
// CURRENT (wrong for non-moving businesses):
const sampleLead = {
  customerName: 'John Smith',
  movingDate: '15th June 2025',
  fromAddress: '123 High Street, London',
  toAddress: '456 New Road, Manchester',
  services: ['Full Packing', 'Storage'],
};

// FIX — use business-type-specific sample data:
const SAMPLE_LEADS: Record<string, object> = {
  moving: {
    customerName: 'John Smith', fromAddress: '123 High St, London',
    toAddress: '456 Oak Ave, Manchester', movingDate: '15 June 2026',
    services: ['Full Packing', 'Storage'],
  },
  real_estate: {
    customerName: 'Sarah Johnson', propertyAddress: '14 Oak Lane, Bristol',
    budget: '£350,000–£400,000', viewingDate: 'Saturday 22 June', bedrooms: '3',
  },
  insurance: {
    customerName: 'Mike Davies', policyType: 'Car Insurance',
    coverageAmount: '£30,000', renewalDate: 'August 2026', currentProvider: 'Admiral',
  },
  cleaning: {
    customerName: 'Emma Wilson', serviceDate: '25 June 2026',
    propertyType: 'End of tenancy', rooms: '4', frequency: 'One-off',
  },
  legal: {
    customerName: 'Robert Chen', caseType: 'Conveyancing',
    urgency: 'Medium', consultationDate: 'Next week',
  },
  general: {
    customerName: 'Alex Turner', serviceRequired: 'General enquiry',
    preferredDate: 'This week', budget: '£500',
  },
};

// In the controller:
const settings = await Settings.findOne({ userId: req.user._id });
const sampleLead = SAMPLE_LEADS[settings.businessType] || SAMPLE_LEADS.general;
const variables = {
  ...sampleLead,
  businessName:   settings.businessName   || 'Your Business',
  emailSignature: settings.emailSignature || 'Best regards,\nYour Team',
};
```

---

## 6. Lead API Response — Confirm These Fields Are Returned

The frontend lead table and detail page now display `aiScore`, `sentiment`, `extraFields`, `businessType`. Confirm the `GET /api/leads` and `GET /api/leads/:id` responses include them.

**If they're not being returned**, add them to the lean/select projection:

```typescript
// In leadsController.ts — GET /api/leads:
const leads = await Lead.find(query)
  .select('customerName customerEmail customerPhone fromAddress toAddress movingDate services status autoReplySent autoReplySentAt n8nTriggered confidence rawEmailSubject rawEmailFrom source businessType extraFields aiScore aiScoreReason sentiment aiProcessed emailLogId createdAt updatedAt')
  .sort({ [sortBy]: sortOrder === 'desc' ? -1 : 1 })
  .skip(skip)
  .limit(limit)
  .lean();
```

**Important:** `aiScore` sorting — confirm `sortBy=aiScore` is handled in the query builder. If it falls through to a default, leads won't sort correctly when the user selects "AI Score" in the table toolbar.

---

## 7. Workflow `isActive` PATCH — Confirm It Works

The workflows page now calls:
```
PATCH /api/workflows/:id  { "isActive": false }
```

This is used to deactivate stale `auto_reply` workflows. Confirm the workflow controller accepts `isActive` as a patchable field (not just `config`, `name`, `webhookUrl`).

If the route only patches `config`, add:
```typescript
const allowed = ['name', 'description', 'webhookUrl', 'isActive', 'config'];
const update = _.pick(req.body, allowed);
await Workflow.findByIdAndUpdate(workflowId, update);
```

---

## 8. Gmail Watch Renewal — Move to Backend Cron (SAFETY CRITICAL)

**Current situation:** Gmail watch renewal runs as an n8n cron every 6 days. If n8n is down on renewal day, Gmail push notifications stop working for ALL users — they stop receiving leads silently.

**Fix:** Add a backend cron (see `N8N_MIGRATION_GUIDE.md` for full code).

```typescript
// Run daily at 6 AM UTC
cron.schedule('0 6 * * *', async () => {
  const twoDaysFromNow = new Date(Date.now() + 48 * 60 * 60 * 1000);
  const expiring = await GmailConnection.find({
    watchExpiry: { $lt: twoDaysFromNow },
    isActive: true,
  });
  for (const conn of expiring) {
    try {
      await gmailService.renewWatch(conn.userId.toString());
    } catch {
      // notify the user, not just the admin
      await notificationService.create({
        userId: conn.userId,
        type: 'new_lead', // or add 'system_alert' type
        title: 'Gmail connection needs renewal',
        message: 'Your Gmail watch expired. Please reconnect Gmail to keep receiving leads.',
      });
    }
  }
});
```

Deactivate `6-gmail-watch-renewal.json` in n8n after this is live.

---

## 9. `emailLogId` on Lead — Populate Email Provider Info

The lead detail page shows whether auto-reply was sent via Gmail or SMTP. It detects this by checking if the outgoing `EmailLog` has a `gmailMessageId` set.

**Confirm:** When auto-reply is sent via SMTP (not Gmail API), `EmailLog.gmailMessageId` should be empty/null. When sent via Gmail API, it should be the Gmail message ID string.

This lets the frontend display:
- `via Gmail` — when `gmailMessageId` is set
- `via SMTP` — when `gmailMessageId` is empty

No backend change needed if this is already the case. Just verify the `emailLogId` is populated on Lead documents after auto-reply sends.

---

## 10. Template Rendering — Remove Approval Gate for Basic Tier

**Current issue:** Templates require `status: "approved"` before they can be used in auto-reply. But there's no admin panel to approve them, so templates are stuck in `"pending"` forever.

**Quick fix options:**

**Option A (recommended for now):** Allow users to use their own templates regardless of status — approval only matters for a public template marketplace that doesn't exist yet.

```typescript
// In template render endpoint or auto-reply resolution:
// Instead of: template.status === 'approved'
// Use:
const canRender = template.status === 'approved' || template.userId.toString() === userId;
```

**Option B:** Auto-approve templates created by the template owner:
```typescript
// In template creation:
const template = await Template.create({
  ...templateData,
  userId: req.user._id,
  status: 'approved', // auto-approve user's own templates
});
```

---

## 11. Duplicate `autoReplyTemplate` Field — Clarify

The Settings model appears to have `autoReplyTemplate` (a plain text/HTML string) AND the Workflow/Template system with full template documents. These serve different purposes:

| Field | Purpose | Used When |
|-------|---------|-----------|
| `Settings.autoReplyTemplate` | Simple fallback message | No workflow template assigned |
| `Template` document | Full HTML template with variables | Assigned to auto_reply workflow |

**Confirm the priority order in your auto-reply resolver:**
1. Workflow has `config.templateId` → use that Template document
2. Workflow has no template → use `Settings.autoReplyTemplate` as body
3. `Settings.autoReplyTemplate` is empty → use business-type default template

Document this in a comment in your `queueService.ts` so it's clear to future you.

---

## Summary Checklist

- [ ] `autoReplySubject` in Settings schema
- [ ] `autoReplyTemplate` in Settings schema (confirm it exists, may already be there)
- [ ] `emailSignature` injected into template rendering variables
- [ ] `autoReplySubject` used as email subject (not hardcoded)
- [ ] Email `From` header set to `"businessName" <email>`
- [ ] `test-template` endpoint uses business-type sample data
- [ ] `GET /api/leads` returns `aiScore`, `sentiment`, `extraFields`, `businessType`
- [ ] `sortBy=aiScore` supported in leads query
- [ ] `PATCH /api/workflows/:id` accepts `isActive`
- [ ] Gmail watch renewal moved to backend cron
- [ ] Template approval gate removed for user's own templates
