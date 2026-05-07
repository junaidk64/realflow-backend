# Paddle Webhook Signature Verification Fix

## Problem
```
Error: [Paddle] Webhook signature verification failed
```

## Root Causes & Solutions

### ✅ Issue 1: Middleware Order (FIXED)
**Problem:** Raw body middleware was applied AFTER `express.json()`, so the body was already parsed into an object instead of staying as raw bytes.

**Solution Applied:** Moved raw body middleware to **before** `express.json()` in `src/server.ts`

```typescript
// ✅ CORRECT ORDER:
app.use('/api/billing/webhook', express.raw({ type: 'application/json' }))  // First
app.use(express.urlencoded({ extended: true }))
app.use(express.json())  // After
```

---

### ✅ Issue 2: Body Type Handling (FIXED)
**Problem:** Converting Buffer to string with `.toString()` can lose encoding or modify the body.

**Solution Applied:** Properly detect if body is Buffer or string, and ensure it's a Buffer for verification:

```typescript
const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body ?? '')
```

---

### ✅ Issue 3: Missing Secret Check (FIXED)
**Problem:** If `PADDLE_WEBHOOK_SECRET` wasn't set, the error message was unclear.

**Solution Applied:** Added explicit check and clear error message:

```typescript
if (!webhookSecret) {
  console.error('[Webhook] PADDLE_WEBHOOK_SECRET not set in .env')
  return res.status(400).json({ error: 'Webhook secret not configured' })
}
```

**Verify in `.env`:**
```bash
PADDLE_WEBHOOK_SECRET=pdl_ntfset_01kr1kcmcp20m1sbr15y5nef3r_YpJljQ+OT3NTHq66caBicDie5xz+W8Hy
```
✅ **Confirmed:** Secret is in your `.env` file.

---

## Additional Checks

### 1. Webhook URL in Paddle Dashboard
**What to verify:**
- Go to Paddle Dashboard → Settings → Webhooks
- Find your webhook for this URL: `https://your-backend.com/api/billing/webhook`
- Confirm it's **ENABLED**

**Current URL from error logs:**
```
https://realflow-frontend-iota.vercel.app/paddle/webhook
```
❌ **This is wrong** — It should be:
```
https://your-realflow-backend.com/api/billing/webhook
```

**ACTION REQUIRED:** Update Paddle webhook URL

---

### 2. Check Server is Running
```bash
# Verify server is listening
curl http://localhost:4005/health
# Should return: { "status": "ok" }
```

---

### 3. Test with Curl
```bash
# Get a test signature from Paddle dashboard by clicking "Test Event"
# Then copy the exact payload and signature

curl -X POST http://localhost:4005/api/billing/webhook \
  -H "Content-Type: application/json" \
  -H "Paddle-Signature: ts=1778170814;h1=908c6063..." \
  -d '{...payload...}'
```

Expected response:
```json
{ "received": true }
```

---

## Debug Checklist

### ✅ Changes Made
- [x] Fixed middleware order in `src/server.ts`
- [x] Improved raw body handling in `src/routes/billing.ts`
- [x] Added comprehensive logging
- [x] Added secret existence check

### ⚠️ Still Need to Do
- [ ] **UPDATE WEBHOOK URL IN PADDLE DASHBOARD**
  - Current (wrong): `https://realflow-frontend-iota.vercel.app/paddle/webhook`
  - Should be: `https://your-backend-domain.com/api/billing/webhook`
  
- [ ] Restart your backend server to load the fixed code
- [ ] Test with Paddle's "Test Event" feature
- [ ] Check backend logs for detailed error messages

---

## Expected Log Output (After Fix)

When a webhook is received, you should see:

```
[Webhook] Received Paddle webhook
[Webhook] Signature: ts=1778170814;h1=908c6063...
[Webhook] Secret exists: true
[Webhook] Body is Buffer, converting to string
[Webhook] ✅ Signature verified, event type: subscription.activated
[Webhook] Processing event: subscription.activated
[Webhook] Subscription activated/updated
[Webhook] Details: {
  subscriptionId: 'sub_123',
  userId: 'user_mongodb_id',
  priceId: 'pri_...',
  planName: 'starter',
  periodEnd: '2026-06-07T...'
}
[Webhook] ✅ User and subscription updated
```

If you see `❌ Signature verification failed`, the issue is:
1. Wrong webhook secret in `.env`
2. Wrong webhook secret in Paddle dashboard
3. Webhook URL not matching what Paddle is sending to

---

## Next Steps

1. **Restart your backend**
   ```bash
   npm run dev
   # or whatever your dev command is
   ```

2. **Update Paddle Dashboard URL**
   - Get your actual backend URL
   - Update webhook endpoint in Paddle Dashboard
   - Save the webhook

3. **Test the webhook**
   - Use Paddle Dashboard → Test Event
   - Or trigger a real payment in sandbox mode
   - Check backend logs for `✅` messages

4. **Verify database updates**
   ```bash
   # MongoDB query to check user record
   db.users.findOne({ paddleCustomerId: { $exists: true } })
   # Should have plan, paddleSubscriptionId, subscriptionStatus fields
   ```

---

## Common Issues

### "Webhook secret not configured"
```
❌ PADDLE_WEBHOOK_SECRET not set in .env
```
**Fix:** Add to `.env`:
```bash
PADDLE_WEBHOOK_SECRET=pdl_ntfset_01kr1kcmcp20m1sbr15y5nef3r_...
```

### "Invalid signature" keeps appearing
**Possible causes:**
1. Secret doesn't match between `.env` and Paddle dashboard
2. Webhook URL in Paddle is different from actual backend URL
3. Paddle is sending to a different endpoint
4. Body modification before signature verification

**Debug:** Check log output for:
```
[Webhook] Secret exists: true   → Secret is configured
[Webhook] Signature: ts=...      → Signature is being received
```

### Webhook not being called at all
**Check:**
1. Is backend publicly accessible? (not localhost)
2. Is Paddle webhook enabled?
3. Is webhook URL exactly matching: `https://your-backend.com/api/billing/webhook`?
4. Is POST request being made (not GET)?

---

## References

- **Paddle Docs:** https://developer.paddle.com/webhooks
- **Webhook Handler:** [src/routes/billing.ts](src/routes/billing.ts)
- **Server Config:** [src/server.ts](src/server.ts)
- **Updated Guide:** [PADDLE_WEBHOOK_GUIDE.md](PADDLE_WEBHOOK_GUIDE.md)

