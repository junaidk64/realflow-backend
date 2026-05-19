# RealFlow Backend — Production Roadmap & Code Flow

**Date:** 2026-05-19 | **Stack:** Node.js + TypeScript + MongoDB + BullMQ + Redis

---

## Architecture Overview

```
Gmail Push Notification (Pub/Sub)
        │
        ▼
POST /webhooks/gmail
        │
        ▼
 emailQueueService  ──► BullMQ Queue: "email-processing"
        │
        ▼
 Worker: processEmail()
   ├── 1. Fetch raw email via Gmail API
   ├── 2. Spam filter (fast regex, no AI cost)
   ├── 3. AI Lead Extraction  ◄─── Claude Haiku API (ONLY here)
   ├── 4. Save Lead to MongoDB
   ├── 5. AI Lead Scoring     ◄─── Same Claude call (bundled)
   └── 6. Trigger auto-reply + notifications
```

---

## Business Type Onboarding Flow

### How it works (frontend + backend contract)

The frontend shows a full-screen setup modal on first login. It collects:
- `businessName` (string, required)
- `businessType` (one of: `moving`, `real_estate`, `insurance`, `cleaning`, `legal`, `general`)

It then calls `PATCH /api/settings` with those two fields. The modal only dismisses once that call succeeds. After that, `localStorage` records the setup as complete for that user ID — the modal never shows again.

**What this means for the backend:**
1. The `/settings` endpoint must already exist and accept `PATCH` with at minimum `{ businessName, businessType }` — it does.
2. The settings document is created automatically when the user first logs in (if not already done — verify this in `authController.ts`).
3. The `businessType` field flows into ALL downstream logic: email parsing, AI extraction, auto-reply templates, lead field extraction.

### Ensure settings are created on first login

File: `src/controllers/authController.ts` — in your Google OAuth callback handler:

```typescript
// After saving/updating the User document, ensure a Settings document exists
const existingSettings = await Settings.findOne({ userId: user._id });
if (!existingSettings) {
  await Settings.create({
    userId: user._id,
    businessType: 'general',   // default — frontend modal will ask them to set this
    businessName: '',
    autoReply: true,
    minimumConfidence: 40,
    notifications: {
      newLead: true,
      autoReplySent: true,
      workflowTriggered: false,
      dailySummary: true,
      emailAddress: user.email,
    },
  });
}
```

### Business type must flow into all processing

When a new email arrives, the worker must read the user's `businessType` from Settings and pass it to the AI extractor. This is already shown in the `processEmail` worker code above.

**Critical:** If a user changes their business type in Settings, only NEW emails processed after the change use the new type. Old leads keep their original `businessType` field. This is correct behavior.

### Settings PATCH endpoint — ensure these fields are accepted

```typescript
// src/controllers/settingsController.ts
const ALLOWED_PATCH_FIELDS = [
  'businessType', 'businessName', 'autoReply', 'autoReplyTemplate',
  'autoReplySubject', 'minimumConfidence', 'n8nWebhookUrl',
  'emailSignature', 'notifications',
];

export async function updateSettings(req: Request, res: Response) {
  const userId = req.user._id;
  const patch: Record<string, unknown> = {};
  
  for (const field of ALLOWED_PATCH_FIELDS) {
    if (field in req.body) patch[field] = req.body[field];
  }

  const settings = await Settings.findOneAndUpdate(
    { userId },
    { $set: patch },
    { new: true, upsert: true }
  );

  res.json({ success: true, data: { settings } });
}
```

---

## Phase 1 — Stabilization (do first)

### Fix 1: Replace hardcoded branding

File: `src/services/emailService.ts` (or wherever auto-reply template is built)

```typescript
// BEFORE (broken)
const html = `<p>Thank you from MovePro Solutions...</p>`;

// AFTER
const settings = await Settings.findOne({ userId });
const businessName = settings?.businessName || 'Our Team';
const html = template.replace(/\{\{businessName\}\}/g, businessName);
```

---

### Fix 2: Gmail watch renewal cron

File: `src/crons/watchRenewal.ts` (create this file)

```typescript
import cron from 'node-cron';
import { GmailConnection } from '../models/GmailConnection';
import { gmailService } from '../services/gmailService';

// Runs every day at 6 AM
cron.schedule('0 6 * * *', async () => {
  const cutoff = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48h from now
  const expiring = await GmailConnection.find({
    isActive: true,
    watchExpiry: { $lte: cutoff },
  });

  for (const conn of expiring) {
    try {
      await gmailService.renewWatch(conn.userId);
      console.log(`Renewed watch for user ${conn.userId}`);
    } catch (err) {
      console.error(`Watch renewal failed for ${conn.userId}:`, err);
    }
  }
});
```

Register in `src/app.ts`:
```typescript
import './crons/watchRenewal';
```

---

### Fix 3: Per-user rate limiting (Redis)

File: `src/middleware/rateLimiter.ts`

```typescript
import { Redis } from 'ioredis';
import { Request, Response, NextFunction } from 'express';

const redis = new Redis(process.env.REDIS_URL!);

export function perUserRateLimit(maxRequests: number, windowSec: number) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const userId = (req as any).user?._id;
    if (!userId) return next();

    const key = `rl:${userId}:${req.path}`;
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, windowSec);

    if (count > maxRequests) {
      return res.status(429).json({ success: false, message: 'Rate limit exceeded' });
    }
    next();
  };
}

// Usage in routes:
// router.post('/leads', authenticate, perUserRateLimit(100, 60), leadController.create);
```

---

### Fix 4: Duplicate lead detection

File: `src/services/leadService.ts`

```typescript
import crypto from 'crypto';

function leadFingerprint(email: string, phone: string, businessType: string): string {
  const raw = `${email.toLowerCase()}|${phone.replace(/\D/g, '')}|${businessType}`;
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

export async function findOrCreateLead(data: LeadInput, userId: string) {
  const fp = leadFingerprint(data.customerEmail, data.customerPhone, data.businessType);
  
  const existing = await Lead.findOne({ userId, fingerprint: fp });
  if (existing) {
    // Mark new email as duplicate, don't create new lead
    await Lead.updateOne({ _id: existing._id }, { $push: { duplicateEmailIds: data.rawEmailId } });
    return { lead: existing, isDuplicate: true };
  }

  const lead = await Lead.create({ ...data, userId, fingerprint: fp });
  return { lead, isDuplicate: false };
}
```

Add `fingerprint` and `duplicateEmailIds` fields to Lead schema.

---

## Phase 2 — Claude AI Integration (token-efficient)

### Strategy: Minimum tokens, maximum value

**Model:** `claude-haiku-4-5-20251001`  
**Cost:** ~$0.0004 per email (input + output)  
**At 1000 emails/user/month:** ~$0.40 — safely covered by $20 subscription

**Token savings techniques:**
1. System prompt cached with `cache_control` — paid once per 5 minutes, not per call
2. Email body truncated to 800 chars before sending — most signal is in first paragraph
3. Extraction + scoring bundled into ONE API call — not two separate calls
4. Hard `max_tokens: 400` limit — prevents runaway costs
5. Spam pre-filter runs BEFORE AI — junk emails never reach Claude

---

### Install the SDK

```bash
npm install @anthropic-ai/sdk
```

```env
# .env
ANTHROPIC_API_KEY=sk-ant-...
```

---

### Business type profiles

File: `src/config/leadProfiles.ts`

```typescript
export type BusinessType = 'moving' | 'real_estate' | 'insurance' | 'cleaning' | 'legal' | 'general';

export interface LeadProfile {
  fields: string[];        // what to extract
  spamKeywords: string[];  // fast pre-filter (no AI cost)
  description: string;     // injected into AI prompt
}

export const LEAD_PROFILES: Record<BusinessType, LeadProfile> = {
  moving: {
    description: 'Moving/relocation company',
    fields: ['movingDate', 'fromAddress', 'toAddress', 'moveSize', 'services'],
    spamKeywords: ['unsubscribe', 'invoice #', 'order confirmation', 'receipt', 'newsletter'],
  },
  real_estate: {
    description: 'Real estate agency',
    fields: ['propertyAddress', 'budget', 'viewingDate', 'buyerOrSeller', 'bedrooms', 'timeline'],
    spamKeywords: ['unsubscribe', 'invoice', 'newsletter', 'receipt'],
  },
  insurance: {
    description: 'Insurance broker or provider',
    fields: ['policyType', 'coverageAmount', 'renewalDate', 'currentProvider', 'vehicleCount'],
    spamKeywords: ['unsubscribe', 'invoice', 'newsletter'],
  },
  cleaning: {
    description: 'Cleaning services company',
    fields: ['serviceDate', 'propertyType', 'rooms', 'frequency', 'squareFeet'],
    spamKeywords: ['unsubscribe', 'invoice', 'newsletter'],
  },
  legal: {
    description: 'Law firm or legal services',
    fields: ['caseType', 'consultationDate', 'urgency', 'jurisdiction', 'hasRetainer'],
    spamKeywords: ['unsubscribe', 'newsletter', 'promotion'],
  },
  general: {
    description: 'General service business',
    fields: ['serviceRequired', 'preferredDate', 'budget', 'urgency'],
    spamKeywords: ['unsubscribe', 'newsletter'],
  },
};
```

---

### The AI service (one call, bundled extraction + scoring)

File: `src/services/aiService.ts`

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { LEAD_PROFILES, BusinessType } from '../config/leadProfiles';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// This system prompt is CACHED — only billed on first call per 5 minutes.
// Keep it stable across calls to maximize cache hits.
const SYSTEM_PROMPT = `You are a lead extraction AI for a CRM system.
Extract lead information from emails and score lead quality.
Always respond with valid JSON only. No explanation text.
If a field cannot be determined, use null.`;

export interface AiLeadResult {
  isLead: boolean;           // false = not a lead (spam/unrelated)
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  extractedFields: Record<string, string | null>;  // business-type-specific
  notes: string | null;
  aiScore: number;           // 1–10
  aiScoreReason: string;     // short reason (max 100 chars)
  sentiment: 'positive' | 'neutral' | 'negative' | 'urgent';
}

export async function extractLeadFromEmail(
  emailBody: string,
  emailFrom: string,
  businessType: BusinessType,
): Promise<AiLeadResult> {
  const profile = LEAD_PROFILES[businessType];
  
  // Truncate email to save tokens — signal is in the first 800 chars
  const truncatedBody = emailBody.slice(0, 800);
  const fieldsJson = JSON.stringify(profile.fields.reduce((acc, f) => ({ ...acc, [f]: null }), {}));

  const userPrompt = `Business: ${profile.description}
From: ${emailFrom}
Email body:
${truncatedBody}

Extract and return JSON with this exact structure:
{
  "isLead": boolean,
  "customerName": string|null,
  "customerEmail": string|null,
  "customerPhone": string|null,
  "extractedFields": ${fieldsJson},
  "notes": string|null,
  "aiScore": number 1-10,
  "aiScoreReason": string max 100 chars,
  "sentiment": "positive"|"neutral"|"negative"|"urgent"
}`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 400,           // hard cap — prevents runaway costs
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },  // cache the system prompt
      },
    ],
    messages: [{ role: 'user', content: userPrompt }],
  });

  const raw = (response.content[0] as { type: string; text: string }).text.trim();
  
  // Strip markdown code fences if present
  const jsonStr = raw.replace(/^```json?\n?/, '').replace(/\n?```$/, '');
  return JSON.parse(jsonStr) as AiLeadResult;
}
```

---

### Spam pre-filter (runs BEFORE Claude — zero AI cost for junk)

File: `src/services/spamFilter.ts`

```typescript
import { LEAD_PROFILES, BusinessType } from '../config/leadProfiles';

const GLOBAL_SPAM_PATTERNS = [
  /unsubscribe/i, /newsletter/i, /invoice #\d/i, /order confirmation/i,
  /do not reply/i, /noreply@/i, /no-reply@/i, /mailer-daemon/i,
  /delivery failure/i, /out of office/i, /automatic reply/i,
];

export function isSpam(emailBody: string, emailFrom: string, businessType: BusinessType): boolean {
  const text = `${emailFrom} ${emailBody}`.toLowerCase();
  
  if (GLOBAL_SPAM_PATTERNS.some(re => re.test(text))) return true;
  
  const profile = LEAD_PROFILES[businessType];
  if (profile.spamKeywords.some(kw => text.includes(kw))) return true;
  
  return false;
}
```

---

### Updated email processing worker

File: `src/workers/emailWorker.ts` (update processEmail function)

```typescript
import { isSpam } from '../services/spamFilter';
import { extractLeadFromEmail } from '../services/aiService';
import { findOrCreateLead } from '../services/leadService';

async function processEmail(job: Job) {
  const { emailId, userId } = job.data;
  
  // 1. Fetch email from Gmail API
  const email = await gmailService.getMessage(userId, emailId);
  const body = email.body || email.snippet;
  const from = email.from;
  
  // 2. Get user's business type
  const settings = await Settings.findOne({ userId });
  const businessType = settings?.businessType || 'general';
  
  // 3. Spam pre-filter — NO AI cost if spam
  if (isSpam(body, from, businessType)) {
    await WebhookLog.create({ type: 'gmail_push', userId, status: 'processed', payload: { skipped: 'spam' } });
    return;
  }
  
  // 4. AI extraction (one call: extract + score + sentiment)
  let aiResult;
  try {
    aiResult = await extractLeadFromEmail(body, from, businessType);
  } catch (err) {
    // Fallback to regex parser if AI fails — never lose a lead
    console.error('AI extraction failed, using fallback:', err);
    aiResult = fallbackRegexExtract(body, from, businessType);
  }
  
  // 5. Not a lead? Stop here.
  if (!aiResult.isLead) return;
  
  // 6. Save lead with AI data
  const { lead, isDuplicate } = await findOrCreateLead({
    userId,
    rawEmailId: emailId,
    rawEmailFrom: from,
    rawEmailSubject: email.subject,
    customerName: aiResult.customerName || '',
    customerEmail: aiResult.customerEmail || from,
    customerPhone: aiResult.customerPhone || '',
    businessType,
    extraFields: aiResult.extractedFields,
    notes: aiResult.notes || '',
    confidence: aiResult.aiScore * 10,  // convert 1-10 to 0-100%
    aiScore: aiResult.aiScore,
    aiScoreReason: aiResult.aiScoreReason,
    sentiment: aiResult.sentiment,
    aiProcessed: true,
    source: 'email',
    status: 'new',
  }, userId);
  
  if (isDuplicate) return;  // Don't send auto-reply for duplicates
  
  // 7. Auto-reply + notifications (existing logic)
  if (settings?.autoReply) {
    await autoReplyQueue.add('send-reply', { leadId: lead._id, userId });
  }
  await notificationService.notifyNewLead(userId, lead._id);
}
```

---

### Lead schema additions

File: `src/models/Lead.ts` — add these fields:

```typescript
// Add to Mongoose schema
businessType: { type: String, enum: ['moving','real_estate','insurance','cleaning','legal','general'], default: 'moving' },
extraFields:  { type: Map, of: mongoose.Schema.Types.Mixed, default: {} },
aiScore:      { type: Number, min: 1, max: 10 },
aiScoreReason: { type: String, maxlength: 200 },
sentiment:    { type: String, enum: ['positive','neutral','negative','urgent'] },
aiProcessed:  { type: Boolean, default: false },
fingerprint:  { type: String, index: true },
duplicateEmailIds: [{ type: String }],
```

---

## Phase 3 — Admin Endpoints

File: `src/routes/admin.ts` (new file, protect with admin middleware)

```typescript
// GET  /api/admin/templates?status=pending  — list templates for review
// POST /api/admin/templates/:id/approve     — approve template
// POST /api/admin/templates/:id/reject      — reject with reason
// GET  /api/admin/users                     — list all users with plan info
// GET  /api/admin/stats                     — system-wide metrics

router.use(authenticate, requireAdmin);  // requireAdmin checks user.role === 'admin'
```

---

## Phase 4 — Stripe Billing

Install: `npm install stripe`

**Stripe products to create in dashboard:**
- Free: price_free (no charge, enforce limits in code)
- Basic: price_basic_monthly ($20/mo)
- Pro: price_pro_monthly ($49/mo)

File: `src/services/stripeService.ts`

```typescript
import Stripe from 'stripe';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function createCheckoutSession(userId: string, priceId: string, email: string) {
  return stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    customer_email: email,
    line_items: [{ price: priceId, quantity: 1 }],
    mode: 'subscription',
    success_url: `${process.env.FRONTEND_URL}/settings?upgraded=true`,
    cancel_url:  `${process.env.FRONTEND_URL}/settings`,
    metadata: { userId },
  });
}

// Webhook handler: POST /api/stripe/webhook
// Events to handle:
//   checkout.session.completed  → set user.plan, user.stripeCustomerId
//   customer.subscription.deleted → downgrade to free
//   invoice.payment_failed      → send warning email
```

Plan enforcement (add to lead creation):

```typescript
const PLAN_LIMITS = { free: 30, basic: 500, pro: Infinity };

export async function checkLeadLimit(userId: string): Promise<boolean> {
  const user = await User.findById(userId);
  const plan = user?.plan || 'free';
  const limit = PLAN_LIMITS[plan as keyof typeof PLAN_LIMITS];
  
  const thisMonth = new Date();
  thisMonth.setDate(1); thisMonth.setHours(0, 0, 0, 0);
  
  const count = await Lead.countDocuments({ userId, createdAt: { $gte: thisMonth } });
  return count < limit;
}
```

---

## Phase 5 — Health Check Endpoint

File: `src/routes/health.ts`

```typescript
router.get('/health', async (req, res) => {
  const checks = await Promise.allSettled([
    mongoose.connection.db.admin().ping(),                    // MongoDB
    redis.ping(),                                              // Redis
    client.messages.create({ model: 'claude-haiku-4-5-20251001', max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),  // Claude API
  ]);

  const [mongo, redisCheck, claude] = checks;
  res.json({
    status: checks.every(c => c.status === 'fulfilled') ? 'ok' : 'degraded',
    mongo:  mongo.status === 'fulfilled' ? 'ok' : 'down',
    redis:  redisCheck.status === 'fulfilled' ? 'ok' : 'down',
    claude: claude.status === 'fulfilled' ? 'ok' : 'down',
    uptime: process.uptime(),
  });
});
```

---

## Environment Variables Required

```env
# Existing
MONGODB_URI=
REDIS_URL=
GMAIL_CLIENT_ID=
GMAIL_CLIENT_SECRET=
GMAIL_REDIRECT_URI=
GOOGLE_PUBSUB_TOPIC=
JWT_SECRET=
JWT_REFRESH_SECRET=

# Add these
ANTHROPIC_API_KEY=sk-ant-...       # Claude API (backend only — never expose to frontend)
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
FRONTEND_URL=https://your-app.com
ADMIN_EMAILS=you@example.com       # comma-separated, grants admin role on login
```

---

## Security Hardening

### Migrate crypto from CryptoJS to native Node.js

```typescript
// BEFORE (CryptoJS — not recommended)
import CryptoJS from 'crypto-js';
const encrypted = CryptoJS.AES.encrypt(secret, key).toString();

// AFTER (Node.js native AES-256-GCM)
import { randomBytes, createCipheriv, createDecipheriv } from 'crypto';

export function encrypt(text: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

export function decrypt(encoded: string, key: Buffer): string {
  const buf = Buffer.from(encoded, 'base64');
  const iv  = buf.slice(0, 12);
  const tag = buf.slice(12, 28);
  const data = buf.slice(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(data) + decipher.final('utf8');
}
```

### Per-user API keys (replace shared n8n secret)

```typescript
// User model additions
apiKey: { type: String, unique: true, sparse: true },  // SHA-256 hashed
apiKeyPrefix: { type: String },  // first 8 chars for display (e.g. "rf_live_")

// Generate
const raw = `rf_live_${randomBytes(32).toString('hex')}`;
const hashed = createHash('sha256').update(raw).digest('hex');
// Store hashed in DB, return raw to user once
```

---

## Testing — Critical Paths (start here)

```typescript
// tests/leadExtraction.test.ts
describe('AI lead extraction', () => {
  it('extracts moving lead correctly', async () => {
    const result = await extractLeadFromEmail(
      'Hi, I need to move from London to Manchester on June 15th for a 3-bed house.',
      'customer@example.com',
      'moving'
    );
    expect(result.isLead).toBe(true);
    expect(result.extractedFields.fromAddress).toContain('London');
    expect(result.aiScore).toBeGreaterThanOrEqual(5);
  });

  it('rejects spam', async () => {
    const isSpamResult = isSpam('Unsubscribe from our newsletter here', 'noreply@marketing.com', 'moving');
    expect(isSpamResult).toBe(true);
  });
});
```

---

## Cost Monitoring

Add a usage log to track AI costs:

```typescript
// After each Claude API call, log token usage
const inputTokens  = response.usage.input_tokens;
const outputTokens = response.usage.output_tokens;
const cachedTokens = response.usage.cache_read_input_tokens || 0;

// Haiku pricing (as of 2025): $0.80/M input, $4.00/M output, $0.08/M cached
const cost = (inputTokens - cachedTokens) * 0.0000008
           + cachedTokens * 0.00000008
           + outputTokens * 0.000004;

await UsageLog.create({ userId, model: 'claude-haiku', inputTokens, outputTokens, cachedTokens, costUsd: cost });
```

Check monthly spend per user with:
```typescript
// GET /api/admin/usage
const monthlySpend = await UsageLog.aggregate([
  { $group: { _id: '$userId', totalCost: { $sum: '$costUsd' }, calls: { $sum: 1 } } },
  { $sort: { totalCost: -1 } },
]);
```

---

## Daily AI Digest (high value, low effort)

File: `src/crons/dailyDigest.ts`

```typescript
// Runs every day at 7 AM
cron.schedule('0 7 * * *', async () => {
  const users = await User.find({ isActive: true, 'settings.notifications.dailySummary': true });
  
  for (const user of users) {
    const yesterday = new Date(Date.now() - 86_400_000);
    const leads = await Lead.find({ userId: user._id, createdAt: { $gte: yesterday } });
    if (leads.length === 0) continue;
    
    const hot  = leads.filter(l => (l.aiScore || 0) >= 7).length;
    const cold = leads.filter(l => (l.aiScore || 0) < 4).length;
    
    // One cheap Claude call to write the digest summary
    const summary = await generateDigestSummary(leads.length, hot, cold, user.settings.businessType);
    
    await emailService.sendDigest(user.email, summary);
  }
});

async function generateDigestSummary(total: number, hot: number, cold: number, businessType: string) {
  const res = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 150,
    messages: [{
      role: 'user',
      content: `Write a 2-sentence morning email digest for a ${businessType} business.
Stats: ${total} new leads, ${hot} hot (score 7+), ${cold} cold (score <4).
Tone: professional, motivating. No emojis. Plain text only.`
    }]
  });
  return (res.content[0] as { text: string }).text;
}
```

---

## Deployment Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Set `ANTHROPIC_API_KEY` in production env (never commit to git)
- [ ] Enable MongoDB Atlas IP allowlist for production server IP only
- [ ] Set up Redis with password (`requirepass` in redis.conf)
- [ ] Register Stripe webhook endpoint in Stripe dashboard
- [ ] Register Gmail Pub/Sub push subscription pointing to production URL
- [ ] Set up process manager (PM2 or Docker) with auto-restart
- [ ] Add Sentry or similar for error tracking (free tier is enough)
- [ ] Enable MongoDB indexes: `{ userId: 1, createdAt: -1 }` on leads
- [ ] Set BullMQ concurrency to 3-5 workers (avoid Gmail API rate limits)
