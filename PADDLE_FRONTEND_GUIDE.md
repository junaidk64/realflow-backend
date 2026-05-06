# Paddle Billing — Frontend Integration Guide

This guide covers everything needed to implement subscription purchasing, management, and cancellation in the frontend using the RealFlow backend billing APIs.

---

## Plans & Pricing

| Plan Key | Display Name | Monthly | Yearly | Internal DB Value |
|----------|-------------|---------|--------|-------------------|
| `essentials` | Essentials | $9/mo | $99/yr | `starter` |
| `professional` | Professional | $19/mo | $190/yr | `pro` |
| `elite` | Elite | $29/mo | $290/yr | `brokerage` |

**Note:** The `plan` field returned on the user object (`/api/auth/me`) uses the **internal DB values** (`trial`, `starter`, `pro`, `brokerage`). The API checkout endpoint accepts the **plan keys** (`essentials`, `professional`, `elite`).

---

## API Reference

All authenticated endpoints require a Firebase ID token in the `Authorization` header:
```
Authorization: Bearer <firebase-id-token>
```

---

### GET `/api/billing/plans`
**Auth:** None (public)

Returns plan metadata for building the pricing UI.

**Response:**
```json
{
  "plans": [
    {
      "key": "essentials",
      "name": "Essentials",
      "internalPlan": "starter",
      "price": { "monthly": 9, "yearly": 99 },
      "limits": { "leads": 100, "agents": 1 },
      "features": [
        "Up to 100 leads",
        "1 agent seat",
        "New Lead Follow-Up automation",
        "Lead & listing management",
        "Basic analytics"
      ]
    },
    {
      "key": "professional",
      "name": "Professional",
      "internalPlan": "pro",
      "price": { "monthly": 19, "yearly": 190 },
      "limits": { "leads": null, "agents": 1 },
      "features": ["..."]
    },
    {
      "key": "elite",
      "name": "Elite",
      "internalPlan": "brokerage",
      "price": { "monthly": 29, "yearly": 290 },
      "limits": { "leads": null, "agents": 10 },
      "features": ["..."]
    }
  ]
}
```
`limits.leads: null` means unlimited.

---

### POST `/api/billing/checkout`
**Auth:** Required

Initiates a checkout session. Returns a Paddle transaction ID that you pass to the Paddle.js overlay.

**Request body:**
```json
{
  "plan": "essentials" | "professional" | "elite",
  "interval": "monthly" | "yearly"
}
```

**Response:**
```json
{ "transactionId": "txn_01k..." }
```

**Error responses:**
- `400 { "error": "Invalid plan" }` — unknown plan key
- `400 { "error": "interval must be 'monthly' or 'yearly'" }`
- `404 { "error": "User not found" }`

---

### POST `/api/billing/cancel`
**Auth:** Required

Cancels the active subscription effective at the end of the current billing period. The user keeps access until then.

**Request body:** none

**Response:**
```json
{ "ok": true }
```

**Error responses:**
- `400 { "error": "No active subscription" }` — user has no paddle subscription ID on file

---

### GET `/api/billing/invoices`
**Auth:** Required

Returns the user's Paddle transaction history.

**Response:**
```json
{
  "invoices": [
    {
      "id": "txn_01k...",
      "status": "completed",
      "createdAt": "2025-07-31T...",
      "items": [{ "price": { "description": "..." }, "quantity": 1 }],
      "details": { "totals": { "total": "900", "currencyCode": "USD" } }
    }
  ]
}
```

---

### POST `/api/billing/portal`
**Auth:** Required

Generates a short-lived Paddle customer portal URL where users can update their payment method, view billing history, and manage their subscription directly.

**Request body:** none

**Response:**
```json
{ "url": "https://customer.paddle.com/login?token=..." }
```

Open this URL in a new tab: `window.open(data.url, '_blank')`.

---

## Setup — Paddle.js

Install the Paddle.js client-side SDK:

```bash
npm install @paddle/paddle-js
```

Initialize once at the app root (e.g., `App.tsx` or a `BillingProvider`):

```typescript
import { initializePaddle, Paddle } from '@paddle/paddle-js'
import { useEffect, useState } from 'react'

export function usePaddle() {
  const [paddle, setPaddle] = useState<Paddle | undefined>()

  useEffect(() => {
    initializePaddle({
      environment: 'sandbox', // change to 'production' for live
      token: 'YOUR_PADDLE_CLIENT_TOKEN', // from Paddle dashboard → Developer Tools → Authentication
    }).then(setPaddle)
  }, [])

  return paddle
}
```

> **Paddle Client Token** is different from the API key. Find it in Paddle Dashboard → Developer Tools → Authentication. It starts with `live_` or `test_`.

---

## Implementing the Pricing Page

### 1. Fetch Plans

```typescript
async function fetchPlans() {
  const res = await fetch('/api/billing/plans')
  const { plans } = await res.json()
  return plans
}
```

### 2. Billing Interval Toggle

```tsx
const [interval, setInterval] = useState<'monthly' | 'yearly'>('monthly')

<div>
  <button onClick={() => setInterval('monthly')}>Monthly</button>
  <button onClick={() => setInterval('yearly')}>Yearly (save ~15%)</button>
</div>

{plans.map(plan => (
  <PlanCard
    key={plan.key}
    plan={plan}
    interval={interval}
    price={plan.price[interval]}
  />
))}
```

### 3. Subscribe Button Flow

```typescript
async function handleSubscribe(planKey: string, interval: 'monthly' | 'yearly') {
  // 1. Get Firebase token
  const token = await firebaseUser.getIdToken()

  // 2. Create transaction on backend
  const res = await fetch('/api/billing/checkout', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ plan: planKey, interval }),
  })

  if (!res.ok) {
    const { error } = await res.json()
    throw new Error(error)
  }

  const { transactionId } = await res.json()

  // 3. Open Paddle checkout overlay
  paddle?.Checkout.open({
    transactionId,
    settings: {
      displayMode: 'overlay',
      theme: 'light',
      locale: 'en',
    },
    // Optional: handle completion
    // successUrl: `${window.location.origin}/dashboard?upgraded=true`,
  })
}
```

### 4. Handling Checkout Events (Optional)

```typescript
paddle?.Setup({
  eventCallback(event) {
    if (event.name === 'checkout.completed') {
      // Payment succeeded — webhook will update user plan async
      // Redirect or show success UI
      router.push('/dashboard?upgraded=true')
    }
    if (event.name === 'checkout.closed') {
      // User closed overlay without completing
    }
  }
})
```

> **Important:** Do not rely on the `checkout.completed` event to confirm the plan upgrade. The user's `plan` field is updated **asynchronously** via the Paddle webhook. Poll `/api/auth/me` or show a "processing" state.

---

## Cancel Subscription

```typescript
async function handleCancel() {
  const confirmed = confirm(
    'Your subscription will be cancelled at the end of the current billing period. Continue?'
  )
  if (!confirmed) return

  const token = await firebaseUser.getIdToken()
  const res = await fetch('/api/billing/cancel', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
  })

  if (!res.ok) {
    const { error } = await res.json()
    alert(error)
    return
  }

  // Refresh user data — plan stays active until period ends
  await refreshUser()
  alert('Subscription cancelled. You keep access until the end of your billing period.')
}
```

---

## Customer Portal (Update Payment Method)

```typescript
async function openBillingPortal() {
  const token = await firebaseUser.getIdToken()
  const res = await fetch('/api/billing/portal', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
  })

  if (!res.ok) return

  const { url } = await res.json()
  window.open(url, '_blank')
}
```

---

## User Subscription State (`/api/auth/me`)

The user object returned by `/api/auth/me` contains:

```typescript
{
  plan: 'trial' | 'starter' | 'pro' | 'brokerage',
  subscriptionStatus: 'trialing' | 'active' | 'past_due' | 'cancelled' | 'paused',
  currentPeriodEnd: string | null,  // ISO date
  trialDaysRemaining: number | null, // only during trial
  trialEndsAt: string | null,
}
```

### UI Decision Matrix

| `plan` | `subscriptionStatus` | Show |
|--------|---------------------|------|
| `trial` | `trialing` | Trial banner with countdown |
| `starter` / `pro` / `brokerage` | `active` | Current plan badge + cancel button |
| any | `past_due` | Payment failed banner + update payment CTA |
| any | `cancelled` | Resubscribe CTA (plan access ends at `currentPeriodEnd`) |

### Internal Plan → Display Name

```typescript
const PLAN_DISPLAY: Record<string, string> = {
  trial: 'Free Trial',
  starter: 'Essentials',
  pro: 'Professional',
  brokerage: 'Elite',
}
```

---

## Upgrade Gate UI

The backend returns `upgrade: true` on feature-limit errors. Use this to trigger an upgrade modal:

```typescript
// Example: POST /api/leads returns this when starter plan hits 100 leads
// { "error": "Lead limit reached. Upgrade to Pro.", "upgrade": true }

const res = await fetch('/api/leads', { method: 'POST', body: JSON.stringify(lead), ... })
const data = await res.json()

if (res.status === 403 && data.upgrade) {
  openUpgradeModal()  // show pricing page / upgrade prompt
}
```

Affected endpoints that return `upgrade: true`:
- `POST /api/leads` — when starter plan exceeds 100 leads
- `PATCH /api/automations/:id` — when enabling a workflow above the user's plan
- `GET /api/analytics/agents` — brokerage-only feature

---

## Environment Notes

- **Sandbox**: Set `environment: 'sandbox'` in `initializePaddle`. Use test card `4242 4242 4242 4242`.
- **Production**: Change to `environment: 'production'` and update the client token.
- The backend `PADDLE_ENVIRONMENT=sandbox` controls which Paddle API environment the server uses.

---

## Webhook Flow (Backend Reference)

The backend handles these Paddle webhook events automatically — no frontend action needed:

| Event | Effect |
|-------|--------|
| `subscription.activated` | Sets `plan`, `subscriptionStatus: active`, `currentPeriodEnd` |
| `subscription.updated` | Updates plan and billing period (handles upgrades/downgrades) |
| `subscription.past_due` | Sets `subscriptionStatus: past_due` |
| `subscription.canceled` | Resets `plan: trial`, clears `currentPeriodEnd` |
| `transaction.payment_failed` | Sends payment failure email to user |

After a successful checkout, the webhook fires within seconds. Poll `/api/auth/me` every 2 seconds for up to 30 seconds to detect the plan upgrade, then stop polling.

```typescript
async function pollForPlanUpgrade(expectedPlan: string, maxAttempts = 15) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 2000))
    const user = await fetchCurrentUser()  // GET /api/auth/me
    if (user.plan === expectedPlan) return user
  }
  return null  // timed out — webhook may be delayed
}
```

---

## Endpoint Summary

| Method | Endpoint | Auth | Purpose |
|--------|----------|------|---------|
| `GET` | `/api/billing/plans` | None | Fetch plan metadata for pricing UI |
| `POST` | `/api/billing/checkout` | Required | Create Paddle transaction → open overlay |
| `POST` | `/api/billing/cancel` | Required | Cancel subscription (end of period) |
| `GET` | `/api/billing/invoices` | Required | List billing history |
| `POST` | `/api/billing/portal` | Required | Open Paddle customer portal |
