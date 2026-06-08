# Backend Guide: Leads Email Inbox & Composer

This document defines the API contracts required to support the full email inbox and send-email experience inside the Leads section.

---

## Summary of Required Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/leads/:id` | Fetch lead + full email thread (already exists, see note) |
| POST | `/api/leads/:id/send-email` | Compose and send an email to the lead |
| GET | `/api/email/provider-status` | Check active email provider (already exists) |

---

## 1. GET `/api/leads/:id` — Lead Detail with Email Thread

**Already exists.** The frontend currently calls this and expects:

```json
{
  "success": true,
  "data": {
    "lead": { ...Lead },
    "emails": [ ...EmailLog[] ]
  }
}
```

### EmailLog shape (must be returned in `emails` array)

```typescript
{
  _id: string;
  userId: string;
  leadId: string;           // must be populated for thread grouping
  type: "incoming" | "outgoing";
  from: string;             // full email address
  to: string;               // full email address
  subject: string;
  body: string;             // plain-text body (always required)
  htmlBody?: string;        // HTML body (optional, from Gmail)
  gmailMessageId: string;   // Gmail thread ID or SMTP message-id
  status: "pending" | "sent" | "failed" | "delivered";
  error?: string;           // populated when status=failed
  sentAt?: string;          // ISO 8601 — when outgoing email was sent
  createdAt: string;        // ISO 8601
  updatedAt: string;        // ISO 8601
}
```

### Ordering

Emails **must** be sorted ascending by `createdAt` (oldest first) so the thread renders chronologically.

### Optional improvements (nice-to-have)

- Add `pagination` support: `GET /api/leads/:id?emailPage=1&emailLimit=50`
- Add `replyToMessageId` on each EmailLog to support proper thread nesting

---

## 2. POST `/api/leads/:id/send-email` — Compose & Send Email

Send an email to the lead's email address using the active email provider (Gmail OAuth or SMTP, selected by the backend based on what is configured).

### Request

```
POST /api/leads/:id/send-email
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "to": "customer@example.com",
  "subject": "Re: Your Insurance Enquiry",
  "body": "Hi Khan, thank you for getting in touch...",
  "htmlBody": "<p>Hi Khan, thank you for getting in touch...</p>",
  "replyToMessageId": "gmail-message-id-of-original-email"
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `to` | string | Yes | Recipient email — should match `lead.customerEmail` |
| `subject` | string | Yes | Email subject |
| `body` | string | Yes | Plain-text body |
| `htmlBody` | string | No | HTML version of body |
| `replyToMessageId` | string | No | Gmail message ID to thread reply correctly |

### Response — success (200)

```json
{
  "success": true,
  "data": {
    "_id": "...",
    "userId": "...",
    "leadId": "...",
    "type": "outgoing",
    "from": "agent@business.com",
    "to": "customer@example.com",
    "subject": "Re: Your Insurance Enquiry",
    "body": "Hi Khan, thank you for getting in touch...",
    "htmlBody": "<p>Hi Khan...</p>",
    "gmailMessageId": "...",
    "status": "sent",
    "sentAt": "2026-06-08T10:30:00Z",
    "createdAt": "2026-06-08T10:30:00Z",
    "updatedAt": "2026-06-08T10:30:00Z"
  }
}
```

### Response — no provider configured (400)

```json
{
  "success": false,
  "message": "No email provider configured. Connect Gmail or SMTP first.",
  "code": "NO_EMAIL_PROVIDER"
}
```

### Response — send failure (500)

```json
{
  "success": false,
  "message": "Failed to send email: authentication error",
  "code": "EMAIL_SEND_FAILED"
}
```

### Backend behaviour

1. Look up the lead by `id` — return 404 if not found or belongs to different user.
2. Determine active provider using the same logic as `/api/email/provider-status` (Gmail first, SMTP fallback).
3. Send the email via the active provider.
4. Create an `EmailLog` document with `type: "outgoing"`, `leadId` set, `status: "sent"`.
5. Return the new `EmailLog` document.

---

## 3. GET `/api/email/provider-status` — Already Exists

Returns the active provider so the composer can show/hide the send form.

```json
{
  "success": true,
  "data": {
    "gmail": {
      "connected": true,
      "email": "agent@gmail.com",
      "watchExpiry": "2026-06-15T00:00:00Z"
    },
    "smtp": {
      "connected": false
    },
    "activeProvider": "gmail"
  }
}
```

`activeProvider` values: `"gmail"` | `"smtp"` | `"none"`

---

## 4. Frontend Assumptions

The following assumptions are built into the frontend and **must** be honoured:

1. `GET /api/leads/:id` returns `emails` as an array of `EmailLog` objects (not IDs, not a count).
2. Emails are sorted ascending by `createdAt`.
3. `emailLog.type` is always `"incoming"` or `"outgoing"` — no other values.
4. `emailLog.body` is always a non-empty string for incoming emails.
5. `POST /api/leads/:id/send-email` returns the saved `EmailLog` directly under `data` (not nested).
6. When `activeProvider === "none"`, the composer shows a "configure email" prompt instead of the form.

---

## 5. Lead List Enhancements (Optional / Future)

For richer email-centric list views the following additions would be ideal but are **not blocking**:

```typescript
// additions to the Lead type returned by GET /api/leads
lastEmailAt?: string;           // ISO 8601 — when the most recent email was sent or received
lastEmailSubject?: string;      // subject of the most recent email in the thread
lastEmailPreview?: string;      // ~120 char plain-text preview of the most recent email body
lastEmailType?: "incoming" | "outgoing";
unreadEmailCount?: number;      // number of unread incoming emails for this lead
```

These can be computed cheaply from the EmailLog collection when building the leads list response.
