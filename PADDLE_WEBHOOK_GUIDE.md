# Paddle Webhook Integration Guide

This guide explains how to set up and handle Paddle webhooks for subscription management on the RealFlow platform.

---

## Table of Contents

1. [Webhook Overview](#webhook-overview)
2. [Setup Instructions](#setup-instructions)
3. [Webhook Events](#webhook-events)
4. [Request/Response Format](#requestresponse-format)
5. [Integration Flow](#integration-flow)
6. [Database Schema](#database-schema)
7. [Troubleshooting](#troubleshooting)

---

## Webhook Overview

The Paddle webhook system notifies your backend of subscription and transaction events in real-time. This allows automatic synchronization of subscription status, plan changes, cancellations, and payment failures.

**Webhook Endpoint:** `POST /api/billing/webhook`

**Full URL (Production):** `https://your-backend-domain.com/api/billing/webhook`

**Authentication:** Signature-based (Paddle sends `paddle-signature` header)

---

## Setup Instructions

### 1. Configure Paddle Webhook in Dashboard

1. Go to [Paddle Dashboard](https://vendors.paddle.com)
2. Navigate to **Settings → Webhooks**
3. Click **Add Endpoint**
4. Enter your webhook URL: `https://your-realflow-backend.com/api/billing/webhook`
5. In **Event Types**, enable the following events:
   - ✅ `subscription.activated`
   - ✅ `subscription.updated`
   - ✅ `subscription.canceled`
   - ✅ `subscription.past_due`
   - ✅ `transaction.payment_failed`
6. Click **Save**
7. Copy your **Webhook Secret** and add to `.env`:
   ```bash
   PADDLE_WEBHOOK_SECRET=your_webhook_secret_here
   ```

### 2. Environment Variables Required

```bash
# Paddle API Configuration
PADDLE_API_KEY=your_paddle_api_key
PADDLE_ENVIRONMENT=sandbox  # or "production"
PADDLE_WEBHOOK_SECRET=your_webhook_secret

# Plan Price IDs (from Paddle Dashboard → Products → Prices)
PADDLE_ESSENTIALS_MONTHLY_PRICE_ID=pri_xxx_essentials_monthly
PADDLE_ESSENTIALS_YEARLY_PRICE_ID=pri_xxx_essentials_yearly
PADDLE_PRO_MONTHLY_PRICE_ID=pri_xxx_pro_monthly
PADDLE_PRO_YEARLY_PRICE_ID=pri_xxx_pro_yearly
PADDLE_ELITE_MONTHLY_PRICE_ID=pri_xxx_elite_monthly
PADDLE_ELITE_YEARLY_PRICE_ID=pri_xxx_elite_yearly
```

### 3. Server Configuration

The webhook handler in `src/server.ts` is already configured with:

```typescript
// Raw body needed for Paddle webhook signature verification
app.use('/api/billing/webhook', express.raw({ type: 'application/json' }))
```

This middleware ensures the raw request body is available for signature verification.

---

## Webhook Events

### 1. `subscription.activated`

**When:** Triggered when a user's subscription becomes active after payment.

**Payload Example:**
```json
{
  "eventType": "subscription.activated",
  "data": {
    "id": "sub_12345",
    "customerId": "cus_12345",
    "status": "active",
    "items": [
      {
        "price": {
          "id": "pri_essentials_monthly"
        }
      }
    ],
    "currentBillingPeriod": {
      "endsAt": "2026-06-07T10:30:00Z"
    },
    "customData": {
      "userId": "user_mongodb_id"
    }
  }
}
```

**Handler Actions:**
- Updates user plan to resolved plan from price ID
- Sets `paddleSubscriptionId`, `subscriptionStatus: "active"`, `currentPeriodEnd`
- Creates/updates `Subscription` document in MongoDB

---

### 2. `subscription.updated`

**When:** Triggered when subscription details change (e.g., plan upgrade/downgrade, billing period change).

**Payload:** Same structure as `subscription.activated`

**Handler Actions:**
- Same as activation (updates user and subscription records with new plan/dates)

**Note:** When a user upgrades/downgrades plans, Paddle may:
1. Send `subscription.updated` immediately, OR
2. Create a new subscription with `subscription.activated`

Your handler accounts for both via `upsert: true` in the MongoDB update.

---

### 3. `subscription.canceled`

**When:** Triggered when a subscription is canceled (manually or due to payment failure).

**Payload Example:**
```json
{
  "eventType": "subscription.canceled",
  "data": {
    "id": "sub_12345",
    "cancelledAt": "2026-05-07T10:30:00Z"
  }
}
```

**Handler Actions:**
- Sets subscription `status: "cancelled"` and `cancelledAt` timestamp
- Reverts user plan to `"trial"`
- Clears `subscriptionStatus` and `currentPeriodEnd`

---

### 4. `subscription.past_due`

**When:** Triggered when a payment fails and the subscription enters "past due" status (continues for retry period).

**Payload Example:**
```json
{
  "eventType": "subscription.past_due",
  "data": {
    "id": "sub_12345",
    "status": "past_due"
  }
}
```

**Handler Actions:**
- Updates subscription `status: "past_due"`
- Updates user `subscriptionStatus: "past_due"` (does NOT downgrade the plan)

**Frontend Action:** Display warning banner that payment is overdue; prompt user to update payment method.

---

### 5. `transaction.payment_failed`

**When:** Triggered when a one-time transaction payment fails (doesn't apply to recurring subscriptions).

**Payload Example:**
```json
{
  "eventType": "transaction.payment_failed",
  "data": {
    "id": "txn_12345",
    "customer": {
      "email": "user@example.com"
    }
  }
}
```

**Handler Actions:**
- Sends payment failure email via Resend email service
- Email subject: "Payment Failed – Action Required"
- Prompts user to retry payment or update payment method

---

## Request/Response Format

### Incoming Webhook Request

```
POST /api/billing/webhook HTTP/1.1
Host: your-backend.com
Content-Type: application/json
Paddle-Signature: t=<timestamp>,h1=<hmac_signature>
Content-Length: 1234

{
  "eventType": "subscription.activated",
  "eventId": "evt_12345",
  "data": { ... }
}
```

**Headers:**
- `paddle-signature`: HMAC-SHA256 signature for verification
- `content-type`: Always `application/json`

### Webhook Response

**Success (200 OK):**
```json
{
  "received": true
}
```

**Validation Error (400 Bad Request):**
```json
{
  "error": "Invalid signature"
}
```

**Processing Error (500 Internal Server Error):**
```json
{
  "error": "Internal server error"
}
```

---

## Integration Flow

### Complete Purchase Flow

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Frontend: User selects plan & clicks "Upgrade"          │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Frontend: POST /api/billing/checkout                    │
│    Body: { plan: "essentials", interval: "monthly" }       │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Backend: Returns { transactionId: "txn_123" }           │
│    (Paddle creates customer if needed, returns transaction)│
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Frontend: Redirect to Paddle Checkout                   │
│    URL: https://checkout.paddle.com/checkout/txn_123       │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. User: Complete payment on Paddle checkout               │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. Paddle: Sends webhook event (subscription.activated)    │
│    to POST /api/billing/webhook                             │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ 7. Backend: Verifies signature, updates user/subscription  │
│    - Sets plan, paddleSubscriptionId, currentPeriodEnd     │
│    - Creates Subscription document                          │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ 8. Frontend: Polls /api/auth/me or listens for socket      │
│    event → Detects new plan → Refresh UI                   │
└─────────────────────────────────────────────────────────────┘
```

---

## Database Schema

### User Document (Users collection)

Fields updated by webhook:

```typescript
{
  _id: ObjectId,
  firebaseUid: String,
  email: String,
  name: String,
  plan: "trial" | "starter" | "pro" | "brokerage",  // Updated on subscription event
  subscriptionStatus: "active" | "past_due" | "cancelled",  // Updated on status change
  paddleCustomerId: String,  // Paddle customer ID
  paddleSubscriptionId: String,  // Paddle subscription ID (from webhook)
  currentPeriodEnd: Date,  // When current billing period ends (from webhook)
  createdAt: Date,
  updatedAt: Date
}
```

### Subscription Document (Subscriptions collection)

Created/updated by every subscription webhook event:

```typescript
{
  _id: ObjectId,
  userId: ObjectId,  // Reference to User
  paddleSubscriptionId: String,  // Unique, indexed
  paddleCustomerId: String,
  plan: "starter" | "pro" | "brokerage",
  status: "active" | "past_due" | "cancelled" | "paused",
  currentPeriodEnd: Date,
  cancelledAt: Date,  // Set when subscription.canceled fires
  createdAt: Date
}
```

---

## Webhook Handler Code

Located in `src/routes/billing.ts`:

```typescript
router.post("/webhook", async (req, res) => {
  const rawBody = req.body.toString();
  const signature = (req.headers["paddle-signature"] as string) ?? "";

  // 1. Verify webhook signature
  let event: any;
  try {
    event = paddle.webhooks.unmarshal(
      rawBody,
      process.env.PADDLE_WEBHOOK_SECRET!,
      signature
    );
  } catch {
    return res.status(400).json({ error: "Invalid signature" });
  }

  // 2. Process event based on type
  try {
    switch (event.eventType) {
      case EventName.SubscriptionActivated:
      case EventName.SubscriptionUpdated: {
        const sub = event.data;
        const userId = sub.customData?.userId;
        const planName = getPlanFromPriceId(sub.items[0]?.price?.id ?? "");
        const periodEnd = new Date(sub.currentBillingPeriod.endsAt);

        await User.findByIdAndUpdate(userId, {
          plan: planName,
          paddleSubscriptionId: sub.id,
          subscriptionStatus: "active",
          currentPeriodEnd: periodEnd,
        });

        await Subscription.findOneAndUpdate(
          { paddleSubscriptionId: sub.id },
          {
            userId,
            paddleSubscriptionId: sub.id,
            paddleCustomerId: sub.customerId,
            plan: planName,
            status: "active",
            currentPeriodEnd: periodEnd,
          },
          { upsert: true }
        );
        break;
      }

      case EventName.SubscriptionCanceled: {
        const sub = event.data;
        await Subscription.findOneAndUpdate(
          { paddleSubscriptionId: sub.id },
          { status: "cancelled", cancelledAt: new Date() }
        );
        await User.findOneAndUpdate(
          { paddleSubscriptionId: sub.id },
          {
            plan: "trial",
            subscriptionStatus: "cancelled",
            currentPeriodEnd: undefined,
          }
        );
        break;
      }

      case EventName.SubscriptionPastDue: {
        const sub = event.data;
        await User.findOneAndUpdate(
          { paddleSubscriptionId: sub.id },
          { subscriptionStatus: "past_due" }
        );
        await Subscription.findOneAndUpdate(
          { paddleSubscriptionId: sub.id },
          { status: "past_due" }
        );
        break;
      }

      case EventName.TransactionPaymentFailed: {
        const txn = event.data;
        await sendPaymentFailedEmail(txn.customer?.email ?? "");
        break;
      }
    }
  } catch (err) {
    console.error("[Paddle webhook] processing error:", err);
  }

  // 3. Always return success to Paddle (already processed)
  return res.json({ received: true });
});
```

---

## Troubleshooting

### Webhook Not Triggering

**Check:**
1. Webhook endpoint is publicly accessible (not behind VPN/firewall)
2. URL in Paddle dashboard is correct
3. Test event from Paddle dashboard sends data
4. Check server logs for errors

**Test Command (curl):**
```bash
curl -X POST https://your-backend.com/api/billing/webhook \
  -H "Content-Type: application/json" \
  -H "Paddle-Signature: <test-signature>" \
  -d '{"eventType":"subscription.activated","data":{...}}'
```

### Signature Verification Fails

**Issues:**
- `PADDLE_WEBHOOK_SECRET` is incorrect → Copy from Paddle dashboard
- Raw body is modified → Ensure middleware is configured correctly
- Timestamp is too old → Paddle validates within 5-minute window

**Check in code:**
```typescript
const signature = req.headers["paddle-signature"] as string;
console.log("Raw body:", req.body.toString()); // Should be unparsed
console.log("Signature:", signature);
```

### Subscription Not Updating

**Debug Steps:**
1. Check MongoDB logs: Are user/subscription documents being updated?
2. Verify `userId` is in webhook `customData`: Should be passed during checkout
3. Ensure `getPlanFromPriceId()` maps correctly:
   ```typescript
   console.log("Plan from Price ID:", getPlanFromPriceId(priceId));
   ```

### User Receives Wrong Plan

**Cause:** Price ID not matching any configured plans

**Fix:**
```typescript
// Log the mapping in paddle-plans.ts
console.log("Available plans:", {
  essentials_monthly: process.env.PADDLE_ESSENTIALS_MONTHLY_PRICE_ID,
  pro_monthly: process.env.PADDLE_PRO_MONTHLY_PRICE_ID,
  // ...
});
```

### Emails Not Sending on Payment Failure

**Check:**
1. Resend API key is configured: `RESEND_API_KEY=` in `.env`
2. Sender email is verified in Resend dashboard
3. Check `sendPaymentFailedEmail()` in `src/lib/resend.ts`

**Debug:**
```typescript
try {
  await sendPaymentFailedEmail(email);
} catch (err) {
  console.error("Email failed:", err);
}
```

---

## Frontend Integration Example

After receiving a successful checkout transaction ID, redirect to Paddle:

```typescript
// Frontend (React example)
const { transactionId } = await fetch('/api/billing/checkout', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` },
  body: JSON.stringify({ plan: 'essentials', interval: 'monthly' })
}).then(r => r.json());

// Redirect to Paddle checkout
window.location.href = `https://checkout.paddle.com/checkout/${transactionId}`;

// After payment, Paddle redirects to success URL configured in dashboard
// Backend webhook automatically updates subscription
```

---

## Production Checklist

- [ ] Update `.env` with production Paddle API Key and Environment
- [ ] Configure webhook secret in `.env`
- [ ] Add webhook endpoint URL to Paddle dashboard (production)
- [ ] Test webhook with Paddle's test event feature
- [ ] Verify email notifications are sent on payment failure
- [ ] Monitor logs for webhook processing errors
- [ ] Set up alerting for 5xx webhook responses
- [ ] Confirm MongoDB collections are backed up
- [ ] Document custom business logic (e.g., feature unlocks) that depend on plan changes

---

## Related Files

- **Backend:** `/src/routes/billing.ts` — Webhook handler
- **Library:** `/src/lib/paddle.ts` — Paddle SDK initialization
- **Library:** `/src/lib/paddle-plans.ts` — Plan configuration & price ID mapping
- **Models:** `/src/models/User.ts` — User subscription fields
- **Models:** `/src/models/Subscription.ts` — Subscription document schema
- **Email:** `/src/lib/resend.ts` — Email service integration

