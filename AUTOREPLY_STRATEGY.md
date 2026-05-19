# Auto-Reply Strategy Guide

## Two Methods — Which One Wins

The app has two paths that can send auto-reply emails:

### Method A — Backend Direct (KEEP THIS)
```
leadExtractionQueue → autoReplyQueue → sendAutoReply() → SMTP / Gmail
```
- Triggered by: `settings.autoReply = true`
- HTML rendering: `generateAutoReplyHTML()` — runs on backend, zero external dependencies
- Speed: Fast — no n8n round-trip
- Reliability: High — no third party between backend and email provider
- Business-type aware: ✅ (after fix)
- Signature support: ✅ (after fix)

### Method B — N8N Rendered (REMOVE THIS)
```
leadExtractionQueue → n8nTriggerQueue → n8n webhook → /api/email/send
```
- Triggered by: active workflow with `type: 'auto_reply'`
- HTML rendering: n8n builds or receives HTML, then calls back to the backend
- Speed: Slow — two HTTP hops
- Reliability: Low — n8n must be running, webhook must succeed, callback must arrive
- Extra dependencies: n8n instance, workflow must be active, callback secret

**Verdict: Keep Method A. The n8n auto-reply workflow type is removed from the trigger loop.**

Why n8n makes sense for OTHER things but NOT auto-reply:
- Auto-reply is time-critical (leads expect instant acknowledgment)
- Auto-reply content is deterministic (no human-in-the-loop needed)
- Every extra hop is a potential failure point on the most critical action

---

## Business-Type Email Templates

Each business type now gets a tailored auto-reply. The email pulls from:
1. `lead.extraFields` (AI-extracted fields stored as a Map)
2. Lead's top-level fields (movingDate, fromAddress, toAddress, services — moving only)
3. `settings.businessName` (company header)
4. `settings.autoReplyTemplate` (custom message box, shown if non-empty)
5. `settings.emailSignature` (footer, shown if non-empty)

### Moving Company
- **Headline:** "We've Received Your Moving Request!"
- **Details shown:** Moving From, Moving To, Moving Date, Services
- **Next steps:** Review → Quote → Contact within 2 hours
- **Subject line:** "Thank you for your enquiry - We'll be in touch soon!"

### Real Estate
- **Headline:** "We've Received Your Property Enquiry!"
- **Details shown:** Property address, Budget, Viewing date, Bedrooms
- **Next steps:** Review → Match properties → Agent will call
- **Subject line:** "We've received your property enquiry"

### Insurance
- **Headline:** "We've Received Your Insurance Request!"
- **Details shown:** Policy type, Coverage amount, Renewal date, Current provider
- **Next steps:** Review → Compare policies → Advisor presentation
- **Subject line:** "Your insurance request — we're on it"

### Cleaning
- **Headline:** "We've Received Your Cleaning Request!"
- **Details shown:** Service date, Property type, Frequency, Area size
- **Next steps:** Review → Check availability → Confirm booking
- **Subject line:** "Cleaning request received — we'll confirm shortly"

### Legal
- **Headline:** "We've Received Your Legal Enquiry!"
- **Details shown:** Case type, Urgency, Consultation date
- **Next steps:** Review → Schedule consultation → Legal guidance
- **Subject line:** "Your legal enquiry — confidential review in progress"

### General
- **Headline:** "We've Received Your Enquiry!"
- **Details shown:** Service required, Preferred date, Budget
- **Next steps:** Review → Prepare → Contact with best offer
- **Subject line:** "Thank you for your enquiry - We'll be in touch soon!"

---

## Customisation Options (Per User)

| Field in Settings | What It Does |
|------------------|-------------|
| `businessName` | Shown in the company header logo at the top |
| `autoReplySubject` | Email subject line (override the defaults above) |
| `autoReplyTemplate` | Custom message shown in a highlighted box inside the email |
| `emailSignature` | Your name/title/phone shown at the bottom of the email |

**Signature format example:**
```
Best regards,
John Smith — Founder
ABC Moving Co.
📞 +44 7700 900000
```

This gets stored exactly as typed and appears in the footer with line breaks preserved.

---

## AI Token Usage for Auto-Reply

**Auto-reply uses ZERO AI tokens.** It is pure template rendering.

The only AI calls are:
1. **Lead extraction** — Haiku 4.5, ~200 tokens, cached after first call
2. **Daily digest** — Haiku 4.5, ~120 tokens, system prompt cached

Do NOT add AI-generated auto-reply content unless you have a specific upsell/upgrade tier for it. The personalisation from showing the customer's own extracted details back to them (moving date, property interest, etc.) is more powerful than AI-written prose, and costs nothing.

---

## If You Want AI-Personalised Emails (Future)

For a Pro tier, you could generate the body text with AI — but do it efficiently:

```
System (cached): You write professional auto-reply emails for [businessType] businesses.
                 Keep it under 80 words. Match the tone to the lead's sentiment.
                 Always end with the business signature if provided.

User: Lead: {customerName}, sentiment: {sentiment}, key info: {2-3 extracted fields}
      Business: {businessName}. Signature: {signature}
      Write the body paragraph only.
```

Max tokens: 150  
Cost: ~$0.00012/call (96% cached on system prompt)  
Add to plan: Only for Pro subscribers

---

## Subject Lines That Win Leads

The subject line is the first thing the lead sees. Generic subjects get ignored.

| Business Type | Winning Subject Lines |
|--------------|----------------------|
| Moving | "Your quote is being prepared — [Moving Date]" |
| Moving | "We're on it — move confirmed for [fromCity] → [toCity]" |
| Real Estate | "[X] bedrooms in [area] — our agent is on it" |
| Insurance | "Your [policyType] quote is coming — response in 2h" |
| Cleaning | "Booking confirmed for [serviceDate] — details inside" |
| Legal | "Your [caseType] enquiry — confidential review started" |

Implement dynamic subjects by extracting the variable from `lead.extraFields` or `lead.movingDate`:

```typescript
// In Settings, let users pick a subject template with variables:
// "Your move from {{fromAddress}} is being quoted!"
// Replace {{vars}} same way as autoReplyTemplate
```

This is a high-impact, zero-token improvement.
