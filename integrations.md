# Integrations — Frontend Functionality

## Overview

The integrations page lives at `/settings/integrations`. It lets agents connect third-party services to RealFlow AI. Connection state is always fetched from the backend — the frontend holds no persistent state for integrations.

---

## Supported Integrations

| ID | Name | Category | Auth Method |
|---|---|---|---|
| `google-calendar` | Google Calendar | Calendar | OAuth 2.0 |
| `zillow` | Zillow | Lead Source | API Key |
| `whatsapp` | WhatsApp Business | Messaging | Phone Number ID + Access Token + Webhook Verify Token |
| `docusign` | DocuSign | Documents | Account ID + Integration Key + Secret Key |
| `mailchimp` | Mailchimp | Email | API Key |
| `zapier` | Zapier | Automation | Webhook URL |

---

## User Flows

### Connecting an API-key integration (Zillow, WhatsApp, DocuSign, Mailchimp, Zapier)

1. User clicks **Connect** on the card.
2. A modal opens with the required credential fields.
3. Fields marked `password` type are masked with a show/hide toggle.
4. Each field has a help hint and a "Where do I find these?" link to official docs.
5. On submit, `POST /api/integrations/:id/connect` is called with `{ config: { ...fields } }`.
6. On success: toast + the card updates to **Connected** state (green border, green status text, Disconnect button).
7. On error: the backend error message is shown in a toast and the modal stays open.

### Connecting Google Calendar (OAuth)

1. User clicks **Connect** on the Google Calendar card.
2. Browser navigates to the Next.js route `/api/integrations/google-calendar/oauth`.
3. That route (server-side) reads `BACKEND_URL` from the environment and redirects to `{BACKEND_URL}/api/integrations/google-calendar/oauth/redirect`, forwarding the session cookie.
4. Backend completes the OAuth flow with Google, stores tokens, then redirects back to `{FRONTEND_URL}/settings/integrations?connected=google-calendar`.
5. The page reads the `connected` query param, shows a success toast, and clears the param from the URL.
6. On failure the backend redirects back with `?error=<message>` instead.

### Disconnecting any integration

1. User clicks **Disconnect**.
2. A confirmation modal appears explaining that automations relying on this integration may stop working.
3. On confirm, `DELETE /api/integrations/:id` is called.
4. On success: toast + card reverts to **Not connected** state.

---

## Loading & Error States

- While `GET /api/integrations` is in-flight, each card logo shows a spinner and buttons are disabled.
- If the fetch fails, a red banner is shown at the top and the cards still render (using defaults — all disconnected).
- While connect/disconnect is in-flight for a specific card, its button shows a spinner and is disabled.

---

## Files

| File | Purpose |
|---|---|
| `app/(dashboard)/settings/integrations/page.tsx` | Main page — card list, modals, OAuth callback handling |
| `hooks/useIntegrations.ts` | React Query hook — fetch, connect, disconnect |
| `app/api/integrations/google-calendar/oauth/route.ts` | Server route — reads `BACKEND_URL`, redirects to backend OAuth endpoint |
| `types/api.ts` | `Integration`, `IntegrationId`, `ConnectIntegrationPayload` types |

---

## Environment Variables Required (Frontend)

No new frontend env vars are needed. The OAuth route uses the existing `BACKEND_URL` server-side variable.

---

# Integrations — Backend Implementation

## Architecture

- One `Integration` document per agent per integration ID in MongoDB.
- Credentials (API keys, tokens) are **AES-256-GCM encrypted** before storage using `ENCRYPTION_KEY`.
- Google OAuth tokens are stored in the same document inside the `config` field (encrypted).
- All routes require `verifyFirebaseToken` + `rateLimiter` middleware (same pattern as all other routes).
- Multi-tenant isolation: every query filters by `agentId` (the authenticated user's `_id`).

---

## MongoDB Model — `src/models/Integration.ts`

```typescript
export interface IIntegration extends Document {
  agentId: Types.ObjectId;          // ref: User
  integrationId: string;            // e.g. 'google-calendar'
  status: 'connected' | 'disconnected';
  config: string;                   // JSON stringified + AES-256-GCM encrypted
  connectedAt: Date;
  updatedAt: Date;
}

const IntegrationSchema = new Schema<IIntegration>(
  {
    agentId:       { type: Schema.Types.ObjectId, ref: 'User', required: true },
    integrationId: { type: String, required: true },
    status:        { type: String, enum: ['connected', 'disconnected'], default: 'disconnected' },
    config:        { type: String, default: '' },   // encrypted blob
    connectedAt:   { type: Date },
  },
  { timestamps: true }
);

IntegrationSchema.index({ agentId: 1, integrationId: 1 }, { unique: true });
```

---

## Credential Encryption — `src/lib/crypto.ts`

```typescript
// AES-256-GCM encrypt/decrypt helpers
// Key: Buffer.from(process.env.ENCRYPTION_KEY, 'hex')  (32-byte hex string)

export function encrypt(plaintext: string): string
export function decrypt(ciphertext: string): string
```

---

## API Routes — `src/routes/integrations.ts`

All routes: `router.use(verifyFirebaseToken, rateLimiter)`

### `GET /api/integrations`

Returns the static list of all 6 supported integrations merged with the agent's live connection state.

**Response `200`**
```json
[
  {
    "id": "google-calendar",
    "name": "Google Calendar",
    "category": "Calendar",
    "authMethod": "oauth",
    "status": "connected",          // or "disconnected"
    "connectedAt": "2025-03-01T10:00:00.000Z"   // null if disconnected
  },
  { "id": "zillow", "status": "disconnected", "connectedAt": null, ... },
  ...
]
```

**Logic**
1. `const dbUser = await User.findOne({ firebaseUid: req.user.uid })`
2. `const docs = await Integration.find({ agentId: dbUser._id })`
3. Merge static catalogue with live docs — any integration without a doc defaults to `disconnected`.
4. **Never** return decrypted config to the client.

---

### `POST /api/integrations/:id/connect`

Stores (or updates) credentials for API-key integrations.

**Request body**
```json
{ "config": { "apiKey": "...", "accountId": "..." } }
```

**Validation (Zod)** — schema differs per `:id`:

| ID | Required fields |
|---|---|
| `zillow` | `apiKey` |
| `whatsapp` | `phoneNumberId`, `accessToken`, `webhookVerifyToken` |
| `docusign` | `accountId`, `integrationKey`, `secretKey` |
| `mailchimp` | `apiKey` |
| `zapier` | `webhookUrl` |

**Logic**
1. Validate `:id` is in the supported set (reject `google-calendar` — that uses OAuth).
2. Run per-integration Zod schema against `req.body.config`.
3. `encrypt(JSON.stringify(config))` → store as `Integration.config`.
4. Upsert: `Integration.findOneAndUpdate({ agentId, integrationId }, { status: 'connected', config: encrypted, connectedAt: new Date() }, { upsert: true, new: true })`

**Response `200`**
```json
{ "id": "zillow", "status": "connected", "connectedAt": "..." }
```

**Response `400`** — Zod validation error message.

---

### `DELETE /api/integrations/:id`

Disconnects an integration (clears config, sets status = disconnected).

**Logic**
```typescript
await Integration.findOneAndUpdate(
  { agentId: dbUser._id, integrationId: req.params.id },
  { status: 'disconnected', config: '', connectedAt: null }
);
```

**Response `200`**
```json
{ "id": "zillow", "status": "disconnected" }
```

**Response `404`** — integration was never connected.

---

## Google Calendar OAuth — Two routes inside `integrations.ts`

### `GET /api/integrations/google-calendar/oauth/redirect`

Initiates the OAuth flow. The frontend simply navigates here (server-side redirect, no AJAX).

**Logic**
1. Extract and verify Firebase token from the forwarded session cookie (`req.cookies.firebaseToken`) **or** fall back to `Authorization` header. Either works; the frontend forwards the cookie.
2. Build the Google OAuth URL:
   ```
   https://accounts.google.com/o/oauth2/v2/auth
     ?client_id=GOOGLE_CLIENT_ID
     &redirect_uri={BACKEND_URL}/api/integrations/google-calendar/oauth/callback
     &response_type=code
     &scope=https://www.googleapis.com/auth/calendar.events
     &access_type=offline
     &prompt=consent
     &state={signed-JWT containing firebaseUid, expiry}
   ```
3. `res.redirect(authUrl)`

**State parameter** — sign a short-lived JWT (5 min, `ENCRYPTION_KEY`) containing `{ uid: firebaseUid }` so the callback can identify the user without a session cookie.

---

### `GET /api/integrations/google-calendar/oauth/callback`

Google redirects here after user grants access.

**Query params:** `code`, `state`, `error` (on denial)

**On error:**
```
res.redirect(`${FRONTEND_URL}/settings/integrations?error=<message>`)
```

**On success:**
1. Verify and decode `state` JWT → extract `firebaseUid`.
2. Exchange `code` for tokens:
   ```
   POST https://oauth2.googleapis.com/token
     { code, client_id, client_secret, redirect_uri, grant_type: 'authorization_code' }
   ```
3. Store `{ access_token, refresh_token, expiry_date }` encrypted in Integration doc.
4. Upsert: `Integration.findOneAndUpdate({ agentId, integrationId: 'google-calendar' }, { status: 'connected', config: encrypted, connectedAt: new Date() }, { upsert: true })`
5. `res.redirect(`${FRONTEND_URL}/settings/integrations?connected=google-calendar`)`

---

## Register route in `src/server.ts`

```typescript
import integrationRoutes from './routes/integrations';
// ...
app.use('/api/integrations', integrationRoutes);
```

Add **before** all other routes so the OAuth callback (no auth header) is not accidentally blocked by global middleware.

---

## Environment Variables Required (Backend)

| Variable | Description |
|---|---|
| `GOOGLE_CLIENT_ID` | Google OAuth 2.0 client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth 2.0 client secret |
| `ENCRYPTION_KEY` | 32-byte hex string for AES-256-GCM credential encryption |

Add to `.env` and `.env.example`.

---

## Files to Create / Modify

| Action | File |
|---|---|
| **Create** | `src/models/Integration.ts` |
| **Create** | `src/lib/crypto.ts` |
| **Create** | `src/routes/integrations.ts` |
| **Modify** | `src/server.ts` — register `/api/integrations` route |
| **Modify** | `.env` / `.env.example` — add 3 new vars above |
