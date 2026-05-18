# RealFlow — Email Provider Setup Guide

This guide explains how email sending works and how users connect their email accounts.
No Gmail credentials are needed in n8n. All emails are sent through the backend using credentials stored during user login.

---

## How It Works

```
n8n workflow
  └─ HTTP Request → POST /api/email/send (x-n8n-secret header)
       └─ Backend looks up user's email provider
            ├─ GmailConnection (OAuth) → sends via Gmail API
            └─ SmtpConnection (Titan/Zoho/etc.) → sends via Nodemailer SMTP
```

n8n never touches email credentials. It only calls the backend with `{ userId, to, subject, html }`.
The backend selects the right provider automatically.

---

## Option A — Gmail (Google Workspace / Gmail)

Gmail OAuth is set up automatically when the user signs in with Google.

The backend stores their OAuth tokens in `GmailConnection`. No extra steps needed.

### What gets connected automatically:
- Access token + refresh token (stored encrypted)
- Gmail watch (Pub/Sub subscription for real-time email detection)

### Reconnect / re-authorize:
```
GET /api/gmail/connect   →  returns OAuth URL
POST /api/gmail/callback →  exchange code for tokens
```

---

## Option B — Custom Domain Email (Titan, Zoho, Office365, Outlook SMTP, etc.)

For users with `info@yourbusiness.com`, `hello@company.co.uk`, etc.

### Connect via the dashboard or API:

```
POST /api/smtp/connect
Authorization: Bearer <jwt>

{
  "fromName":  "Your Business Name",
  "fromEmail": "info@yourbusiness.com",
  "host":      "smtp.titan.email",
  "port":      587,
  "secure":    false,
  "user":      "info@yourbusiness.com",
  "password":  "your-smtp-password"
}
```

The backend **tests the connection before saving**. If credentials are wrong, it returns a 422 with the SMTP error.

### Common SMTP settings by provider:

| Provider | Host | Port | Secure |
|----------|------|------|--------|
| Titan Email | `smtp.titan.email` | `587` | `false` |
| Zoho Mail | `smtp.zoho.com` | `587` | `false` |
| Zoho Mail (SSL) | `smtp.zoho.com` | `465` | `true` |
| Google Workspace | `smtp.gmail.com` | `587` | `false` |
| Office 365 | `smtp.office365.com` | `587` | `false` |
| Outlook.com | `smtp-mail.outlook.com` | `587` | `false` |
| Yahoo Mail | `smtp.mail.yahoo.com` | `587` | `false` |
| Amazon SES | `email-smtp.<region>.amazonaws.com` | `587` | `false` |

> **Titan Email note**: Use the App Password if 2FA is enabled. In Titan's dashboard: Settings → Security → App Passwords.

### Other SMTP endpoints:

```
DELETE /api/smtp/disconnect    # remove SMTP credentials
GET    /api/smtp/status        # check connection details
POST   /api/smtp/test          # send a test email
  Body: { "sendTo": "you@example.com" }  (optional, defaults to fromEmail)
```

---

## Provider Priority

If a user has **both** Gmail and SMTP connected:

1. **Gmail OAuth is used first** (more reliable, no credential expiry issues)
2. **SMTP is the fallback** (used if Gmail fails or is disconnected)

This means: if a user with `junaid@gmail.com` also connects `info@junaid.com` via SMTP,
emails will always go from `junaid@gmail.com` unless Gmail is disconnected.

To force SMTP, disconnect Gmail via `POST /api/gmail/disconnect`.

---

## Check Current Provider Status

```
GET /api/email/provider-status
Authorization: Bearer <jwt>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "gmail": {
      "connected": true,
      "email": "user@gmail.com",
      "watchExpiry": "2026-06-01T00:00:00.000Z"
    },
    "smtp": {
      "connected": true,
      "fromEmail": "info@yourbusiness.com",
      "host": "smtp.titan.email",
      "port": 587
    },
    "activeProvider": "gmail"
  }
}
```

---

## n8n Environment Variables

Add these to n8n's environment (Settings → Variables):

| Variable | Value | Notes |
|----------|-------|-------|
| `BACKEND_URL` | `https://your-backend.com` | No trailing slash |
| `N8N_CALLBACK_SECRET` | `<shared secret>` | Must match `N8N_CALLBACK_SECRET` in backend `.env` |
| `BACKEND_SERVICE_TOKEN` | `<jwt>` | From `POST /api/auth/google` — for cron workflows (5, 6) |
| `FALLBACK_NOTIFY_EMAIL` | `admin@yourdomain.com` | Used by workflow 5 if settings email not set |
| `ADMIN_USER_ID` | `<MongoDB ObjectId>` | User whose email sends the watch-renewal failure alert (workflow 6) |
| `ADMIN_EMAIL` | `admin@yourdomain.com` | Recipient of the watch-renewal failure alert |

---

## Backend `.env` additions

```env
# Existing
N8N_BASE_URL=https://n8n.boldme.site
N8N_API_KEY=<your-n8n-api-key>
N8N_CALLBACK_SECRET=<shared-secret-min-32-chars>

# No new env vars needed for SMTP — credentials are stored in the database
# encrypted with ENCRYPTION_KEY
```

---

## What Changed vs. the Old Workflows

| Old | New |
|-----|-----|
| Gmail node in n8n (requires OAuth credential in n8n) | HTTP Request → `POST /api/email/send` |
| One Gmail account for all users | Each user's own Gmail / SMTP is used |
| Credential setup required per n8n instance | Login to the app = email ready |
| Custom domain email not supported | Titan, Zoho, Office365, etc. all work |

---

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| `422 No email provider configured` | User has no Gmail or SMTP connected | Connect Gmail (login) or add SMTP via `/api/smtp/connect` |
| `422 SMTP connection test failed` | Wrong host/port/password | Double-check SMTP settings; use App Password if 2FA enabled |
| Email sent from wrong address | Gmail takes priority over SMTP | Disconnect Gmail if you want SMTP to be used |
| `401 on /api/email/send` | `x-n8n-secret` missing or wrong | Ensure n8n env has `N8N_CALLBACK_SECRET` matching backend `.env` |
| Daily summary fails | `userId` empty in settings | Ensure `BACKEND_SERVICE_TOKEN` is a valid JWT for an active user |
| Watch renewal alert not sending | `ADMIN_USER_ID` not set in n8n env | Set `ADMIN_USER_ID` to the MongoDB ObjectId of the admin user |
