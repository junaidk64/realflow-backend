# Paddle Webhook Integration — Quick Start Checklist

## Status: ✅ Backend Implementation Complete

The webhook handler is fully implemented and ready to accept events from Paddle.

---

## Setup Checklist

### 1. Backend Configuration ✅
- [x] Webhook handler implemented at `POST /api/billing/webhook`
- [x] Raw body middleware configured in `src/server.ts`
- [x] All event types handled (activated, updated, past_due, canceled, payment_failed)
- [x] Signature verification enabled
- [x] MongoDB synchronization (User + Subscription models)
- [x] Error handling & logging

### 2. Environment Variables ⚙️
Add to `.env`:
```bash
# Required for webhook signature verification
PADDLE_WEBHOOK_SECRET=<copy-from-paddle-dashboard>

# Already likely configured
PADDLE_API_KEY=<your-api-key>
PADDLE_ENVIRONMENT=sandbox  # or production
```

### 3. Paddle Dashboard Setup 📋

**Step 1:** Go to [Paddle Vendor Dashboard](https://vendors.paddle.com)

**Step 2:** Navigate to **Settings → Webhooks**

**Step 3:** Click **Add Endpoint**

**Step 4:** Enter webhook URL:
```
https://your-realflow-backend.com/api/billing/webhook
```

**Step 5:** Select Event Types to enable:
- ✅ `subscription.activated`
- ✅ `subscription.updated`
- ✅ `subscription.canceled`
- ✅ `subscription.past_due`
- ✅ `transaction.payment_failed`

**Step 6:** Click **Save**

**Step 7:** Copy the **Webhook Secret** and add to `.env`:
```
PADDLE_WEBHOOK_SECRET=<secret_from_dashboard>
```

### 4. Test the Webhook ✅

**Option A: Paddle Dashboard Test**
1. In Paddle dashboard, find your webhook
2. Click **Test Event**
3. Select event type: `subscription.activated`
4. Check backend logs for successful processing

**Option B: Local Testing**
```bash
# Test webhook signature verification
curl -X POST http://localhost:4000/api/billing/webhook \
  -H "Content-Type: application/json" \
  -H "Paddle-Signature: <test-signature>" \
  -d '{"eventType":"subscription.activated","data":{}}'
```

### 5. Verify Database Sync ✅

After webhook succeeds:
1. Check user record has `plan` field updated
2. Check subscription record created/updated
3. Verify `paddleSubscriptionId` is stored

```bash
# MongoDB query to check user subscription
db.users.findOne({ paddleSubscriptionId: { $exists: true } })
```

---

## How It Works: Purchase Flow

```
1. User selects plan on frontend
   ↓
2. Frontend: POST /api/billing/checkout
   { plan: "essentials", interval: "monthly" }
   ↓
3. Backend: Returns transactionId
   ↓
4. Frontend: Redirects to Paddle checkout
   https://checkout.paddle.com/checkout/txn_xxx
   ↓
5. User completes payment on Paddle
   ↓
6. Paddle sends webhook: subscription.activated
   POST https://your-backend.com/api/billing/webhook
   ↓
7. Backend: Verifies signature → Updates user & subscription in MongoDB
   ↓
8. Frontend: Polls /api/auth/me → Detects new plan → Refreshes UI
```

---

## Event Handlers Summary

| Event | Action |
|-------|--------|
| `subscription.activated` | Create/update subscription; set plan, status=active |
| `subscription.updated` | Update plan/period if changed |
| `subscription.past_due` | Flag account; user can still use service; prompt payment |
| `subscription.canceled` | Set status=cancelled; downgrade to trial plan |
| `transaction.payment_failed` | Send payment failure email to user |

---

## API Endpoints

### Public (No Auth Required)
- `GET /api/billing/plans` — Returns all plan details

### Webhook (Signature Auth Only)
- `POST /api/billing/webhook` — Paddle webhook handler

### Authenticated (Firebase + Rate Limited)
- `POST /api/billing/checkout` — Create transaction for checkout
- `GET /api/billing/invoices` — List user's past invoices
- `POST /api/billing/cancel` — Cancel user's subscription
- `POST /api/billing/portal` — Get Paddle customer portal link

---

## Troubleshooting

### "Invalid signature" error
- ✅ Webhook secret in `.env` must match Paddle dashboard
- ✅ Verify server is receiving raw body (not parsed JSON)
- ✅ Signature timestamp must be within 5 minutes

### Webhook not called
- ✅ Backend URL must be publicly accessible
- ✅ Firewall/security must allow inbound POST requests
- ✅ Check Paddle dashboard → Webhooks → View delivery logs
- ✅ Try "Test Event" button in Paddle dashboard

### User plan not updating
- ✅ Database connection must be working
- ✅ MongoDB collections must exist
- ✅ `userId` in webhook customData must match MongoDB user._id

### Email not sent on payment failure
- ✅ Resend API key configured: `RESEND_API_KEY=`
- ✅ Sender email verified in Resend dashboard
- ✅ Check `src/lib/resend.ts` — `sendPaymentFailedEmail()` implementation

---

## Files Modified/Created

| File | Purpose |
|------|---------|
| `src/routes/billing.ts` | Webhook handler + checkout endpoints |
| `src/lib/paddle.ts` | Paddle SDK initialization |
| `src/lib/paddle-plans.ts` | Plan configuration & price ID mapping |
| `src/server.ts` | Raw body middleware for webhook |
| `PADDLE_WEBHOOK_GUIDE.md` | **NEW** — Full webhook documentation |

---

## Production Deployment Checklist

- [ ] Update `.env` with production Paddle API Key
- [ ] Set `PADDLE_ENVIRONMENT=production` in production
- [ ] Configure webhook URL with production domain in Paddle dashboard
- [ ] Webhook secret copied to production `.env`
- [ ] Test with real production payment (use sandbox card if available)
- [ ] Monitor logs for webhook processing errors
- [ ] Set up monitoring for webhook failures (failed signatures, timeouts)
- [ ] Email notifications working for payment failures
- [ ] Backup MongoDB before going live
- [ ] Document team on webhook flow and troubleshooting

---

## Need Help?

1. **Paddle Docs:** https://developer.paddle.com/webhooks
2. **Full Guide:** See `PADDLE_WEBHOOK_GUIDE.md` in this repo
3. **Code:** Check `src/routes/billing.ts` for implementation details
4. **Models:** See `src/models/User.ts` and `src/models/Subscription.ts` for schema

