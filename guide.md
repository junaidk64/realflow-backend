# RealFlow AI — Backend Build Guide
### AI-Powered CRM & Automation Platform for Real Estate Agents

> **Stack:** Express.js · MongoDB + Mongoose · Firebase Admin SDK (JWT) · Paddle · Gemini AI · n8n · Resend · Twilio · Cloudflare R2

---

## Table of Contents

1. [Backend Overview](#1-backend-overview)
2. [Backend Tech Stack](#2-backend-tech-stack)
3. [Project Structure](#3-project-structure)
4. [Server Entry Point](#4-server-entry-point)
5. [Firebase Admin Auth — Token Verification](#5-firebase-admin-auth--token-verification)
6. [Database Schema](#6-database-schema)
7. [Route Map](#7-route-map)
8. [Core Route Patterns](#8-core-route-patterns)
9. [Gemini AI — Listing Generator](#9-gemini-ai--listing-generator)
10. [n8n Automation Integration](#10-n8n-automation-integration)
11. [Paddle Subscription](#11-paddle-subscription)
12. [File Upload — Cloudflare R2](#12-file-upload--cloudflare-r2)
13. [Rate Limiting](#13-rate-limiting)
14. [Backend Dependencies](#14-backend-dependencies)
15. [Environment Variables](#15-environment-variables)
16. [Build Order — Backend Phases](#16-build-order--backend-phases)

---

## 1. Backend Overview

The backend is a **standalone Express.js server** (Node.js). It is completely separate from the Next.js frontend.

Every protected route:
1. Reads the `Authorization: Bearer <firebaseIdToken>` header
2. Verifies the token with **Firebase Admin SDK** (`verifyIdToken`)
3. Connects to MongoDB via a singleton Mongoose connection
4. Validates request body with **Zod**
5. Executes business logic
6. Returns JSON

External services:
- **Firebase Admin SDK** — ID token verification (no session cookies, no NextAuth)
- **Gemini (Google AI)** — AI listing description + lead suggestions
- **Paddle** — subscription billing
- **n8n** — automation engine (self-hosted Docker)
- **Resend** — transactional email
- **Twilio** — WhatsApp + SMS
- **Cloudflare R2** — file/image storage
- **Upstash Redis** — rate limiting

---

## 2. Backend Tech Stack

```
Backend
├── Express.js v4 (Node.js HTTP server)
├── Mongoose v8 (MongoDB ODM)
├── Firebase Admin SDK v12 (Bearer token verification)
├── @google/generative-ai (Gemini — AI listing writer)
├── @paddle/paddle-node-sdk (subscriptions, webhooks, invoices)
├── Resend (transactional email)
├── Twilio (SMS + WhatsApp Business)
├── @aws-sdk/client-s3 + presigner (Cloudflare R2 via S3-compatible API)
├── @upstash/ratelimit + @upstash/redis (rate limiting)
└── Zod (request validation)

Infrastructure
├── MongoDB Atlas (database)
├── Railway / Render (Express server deployment)
├── Railway (n8n Docker — n8nio/n8n image)
├── Cloudflare R2 (file storage)
└── Upstash Redis (rate limiting)
```

---

## 3. Project Structure

```
backend/
├── src/
│   ├── server.ts                   # Express app entry point
│   ├── lib/
│   │   ├── firebase-admin.ts       # Firebase Admin SDK init
│   │   ├── db.ts                   # Mongoose singleton connection
│   │   ├── gemini.ts               # Gemini AI client
│   │   ├── paddle.ts               # Paddle SDK client
│   │   ├── paddle-plans.ts         # Plan → priceId map
│   │   ├── r2.ts                   # Cloudflare R2 (S3 client)
│   │   ├── n8n.ts                  # n8n webhook helper
│   │   ├── resend.ts               # Resend email helper
│   │   ├── twilio.ts               # Twilio SMS/WhatsApp helper
│   │   └── redis.ts                # Upstash Redis + rate limiter
│   ├── middleware/
│   │   ├── auth.ts                 # verifyFirebaseToken middleware
│   │   └── rateLimit.ts            # rate limit middleware
│   ├── models/
│   │   ├── User.ts
│   │   ├── Lead.ts
│   │   ├── Listing.ts
│   │   ├── Appointment.ts
│   │   ├── Automation.ts
│   │   └── Subscription.ts
│   └── routes/
│       ├── auth.ts                 # POST /auth/register, /auth/me
│       ├── leads.ts                # CRUD + activity + suggest
│       ├── listings.ts             # CRUD + ai-generate + notify
│       ├── automations.ts          # toggle + manual trigger + n8n callback
│       ├── appointments.ts
│       ├── documents.ts
│       ├── upload.ts               # presigned R2 URL
│       ├── billing.ts              # checkout, webhook, invoices, cancel
│       ├── analytics.ts
│       └── portal.ts               # public client portal (no auth)
├── .env
├── package.json
└── tsconfig.json
```

---

## 4. Server Entry Point

```ts
// src/server.ts
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { connectDB } from "./lib/db";

import authRoutes from "./routes/auth";
import leadsRoutes from "./routes/leads";
import listingsRoutes from "./routes/listings";
import automationsRoutes from "./routes/automations";
import appointmentsRoutes from "./routes/appointments";
import documentsRoutes from "./routes/documents";
import uploadRoutes from "./routes/upload";
import billingRoutes from "./routes/billing";
import analyticsRoutes from "./routes/analytics";
import portalRoutes from "./routes/portal";

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL, credentials: true }));

// Raw body needed for Paddle webhook signature verification
app.use("/api/billing/webhook", express.raw({ type: "application/json" }));

// JSON body parser for all other routes
app.use(express.json());

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/leads", leadsRoutes);
app.use("/api/listings", listingsRoutes);
app.use("/api/automations", automationsRoutes);
app.use("/api/appointments", appointmentsRoutes);
app.use("/api/documents", documentsRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/billing", billingRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/portal", portalRoutes);   // public — no auth middleware

const PORT = process.env.PORT || 4000;

connectDB().then(() => {
  app.listen(PORT, () => console.log(`API running on port ${PORT}`));
});
```

---

## 5. Firebase Admin Auth — Token Verification

### 5.1 Firebase Admin Setup

```ts
// src/lib/firebase-admin.ts
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const app = getApps().length === 0
  ? initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      }),
    })
  : getApps()[0];

export const adminAuth = getAuth(app);
```

### 5.2 Auth Middleware

This middleware attaches the decoded Firebase token to `req.user` on every protected route. No session cookies are used — the frontend sends a fresh Firebase ID token on every request.

```ts
// src/middleware/auth.ts
import { Request, Response, NextFunction } from "express";
import { adminAuth } from "../lib/firebase-admin";

// Extend Express Request to include decoded Firebase user
declare global {
  namespace Express {
    interface Request {
      user?: import("firebase-admin/auth").DecodedIdToken;
    }
  }
}

export async function verifyFirebaseToken(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid Authorization header" });
  }

  const idToken = authHeader.slice(7);

  try {
    const decoded = await adminAuth.verifyIdToken(idToken);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired Firebase token" });
  }
}
```

### 5.3 Register Route

```ts
// src/routes/auth.ts
import { Router } from "express";
import { verifyFirebaseToken } from "../middleware/auth";
import User from "../models/User";

const router = Router();

// POST /api/auth/register
// Called by frontend after createUserWithEmailAndPassword
// Creates the MongoDB user document linked to Firebase UID
router.post("/register", verifyFirebaseToken, async (req, res) => {
  const { name } = req.body;
  const { uid, email } = req.user!;

  const existing = await User.findOne({ firebaseUid: uid });
  if (existing) return res.json({ user: existing });

  const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

  const user = await User.create({
    firebaseUid: uid,
    email,
    name,
    plan: "trial",
    trialEndsAt,
  });

  return res.status(201).json({ user });
});

// GET /api/auth/me
// Returns the logged-in user's MongoDB document + trial status
router.get("/me", verifyFirebaseToken, async (req, res) => {
  const user = await User.findOne({ firebaseUid: req.user!.uid }).lean();
  if (!user) return res.status(404).json({ error: "User not found" });

  const trialDaysRemaining = user.trialEndsAt
    ? Math.max(0, Math.ceil((user.trialEndsAt.getTime() - Date.now()) / 86400000))
    : 0;

  return res.json({ user: { ...user, trialDaysRemaining } });
});

export default router;
```

---

## 6. Database Schema

```ts
// src/models/User.ts
const UserSchema = new Schema({
  firebaseUid: { type: String, unique: true, required: true }, // Firebase ↔ MongoDB link
  name: String,
  email: { type: String, unique: true },
  image: String,
  plan: { type: String, enum: ["trial", "starter", "pro", "brokerage"], default: "trial" },
  paddleCustomerId: String,
  paddleSubscriptionId: String,
  trialEndsAt: Date,
  agencyName: String,
  phone: String,
  timezone: { type: String, default: "America/New_York" },
  n8nWorkflowsEnabled: [String],
  createdAt: { type: Date, default: Date.now },
});

// src/models/Lead.ts
const LeadSchema = new Schema({
  agentId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  name: { type: String, required: true },
  email: String,
  phone: String,
  source: { type: String, enum: ["website", "referral", "zillow", "cold-call", "social", "other"] },
  status: {
    type: String,
    enum: ["new", "contacted", "viewing-scheduled", "offer-made", "closed-won", "closed-lost", "nurture"],
    default: "new",
  },
  propertyType: { type: String, enum: ["buy", "sell", "rent"] },
  budget: Number,
  preferredAreas: [String],
  bedrooms: Number,
  notes: String,
  tags: [String],
  assignedListingId: { type: Schema.Types.ObjectId, ref: "Listing" },
  lastContactedAt: Date,
  nextFollowUpAt: Date,
  portalToken: { type: String, unique: true, sparse: true },
  activities: [{
    type: { type: String, enum: ["email", "sms", "whatsapp", "call", "note", "status-change", "viewing"] },
    content: String,
    createdAt: { type: Date, default: Date.now },
  }],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// src/models/Listing.ts
const ListingSchema = new Schema({
  agentId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  title: String,
  address: {
    street: String,
    city: String,
    state: String,
    zip: String,
    country: { type: String, default: "US" },
  },
  price: Number,
  bedrooms: Number,
  bathrooms: Number,
  sqft: Number,
  propertyType: { type: String, enum: ["house", "condo", "townhouse", "land", "commercial"] },
  listingType: { type: String, enum: ["sale", "rent"] },
  features: [String],
  description: String,
  images: [String],               // Cloudflare R2 public URLs
  status: { type: String, enum: ["draft", "active", "under-contract", "sold"], default: "draft" },
  mlsNumber: String,
  createdAt: { type: Date, default: Date.now },
});

// src/models/Appointment.ts
const AppointmentSchema = new Schema({
  agentId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  leadId: { type: Schema.Types.ObjectId, ref: "Lead" },
  listingId: { type: Schema.Types.ObjectId, ref: "Listing" },
  title: String,
  scheduledAt: { type: Date, required: true },
  duration: { type: Number, default: 60 },
  location: String,
  notes: String,
  status: { type: String, enum: ["scheduled", "completed", "cancelled", "no-show"], default: "scheduled" },
  reminderSent: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

// src/models/Automation.ts
const AutomationSchema = new Schema({
  agentId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  name: String,
  description: String,
  trigger: { type: String, enum: ["lead-created", "status-changed", "appointment-set", "listing-published", "manual"] },
  n8nWorkflowId: String,
  isActive: { type: Boolean, default: true },
  runCount: { type: Number, default: 0 },
  lastRunAt: Date,
  createdAt: { type: Date, default: Date.now },
});

// src/models/Subscription.ts
const SubscriptionSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  paddleSubscriptionId: { type: String, unique: true },
  paddleCustomerId: String,
  plan: { type: String, enum: ["starter", "pro", "brokerage"] },
  status: { type: String, enum: ["active", "past_due", "cancelled", "paused"] },
  currentPeriodEnd: Date,
  cancelledAt: Date,
  createdAt: { type: Date, default: Date.now },
});
```

---

## 7. Route Map

```
POST   /api/auth/register            Create MongoDB user after Firebase sign-up
GET    /api/auth/me                  Return logged-in user doc + trial days

GET    /api/leads                    List all leads for agent (paginated)
POST   /api/leads                    Create lead + trigger n8n
GET    /api/leads/:id                Single lead detail
PATCH  /api/leads/:id                Update lead fields
DELETE /api/leads/:id                Delete lead
POST   /api/leads/:id/activity       Log activity (call, note, email, etc.)
GET    /api/leads/:id/suggest        Gemini: suggest next action for lead
POST   /api/leads/bulk/email         Send Resend email to multiple leads
POST   /api/leads/bulk/sms           Send Twilio SMS to multiple leads
PATCH  /api/leads/bulk               Update status for selected lead IDs

GET    /api/listings                 List all listings for agent
POST   /api/listings                 Create listing
GET    /api/listings/:id             Single listing
PATCH  /api/listings/:id             Update listing
DELETE /api/listings/:id             Delete listing
POST   /api/listings/ai-generate     Gemini streaming listing description
GET    /api/listings/:id/matched-leads  Leads matching budget + property type
POST   /api/listings/:id/notify      Trigger n8n: notify matched leads

GET    /api/automations              List agent workflows
PATCH  /api/automations/:id          Toggle active/inactive
POST   /api/automations/:id/run      Manual trigger
POST   /api/automations/n8n-callback Receives n8n webhook callbacks (secret only)

GET    /api/appointments             List appointments
POST   /api/appointments             Create appointment
PATCH  /api/appointments/:id         Update appointment
DELETE /api/appointments/:id         Delete appointment

GET    /api/documents                List documents
POST   /api/documents                Create document record
PATCH  /api/documents/:id            Update signing status
DELETE /api/documents/:id            Delete document

POST   /api/upload                   Return presigned R2 URL for client upload

POST   /api/billing/checkout         Create Paddle transaction (overlay checkout)
GET    /api/billing/invoices         List invoices from Paddle
POST   /api/billing/cancel           Cancel Paddle subscription
POST   /api/billing/portal           Paddle customer portal URL
POST   /api/billing/webhook          Paddle webhook handler (no auth — secret verified)

GET    /api/analytics/summary        Leads/conversion stats (last N days)
GET    /api/analytics/agents         Per-agent stats (Brokerage plan only)

GET    /api/portal/:token            Public: fetch deal data by portal token (no auth)
```

---

## 8. Core Route Patterns

### 8.1 MongoDB Connection Singleton

```ts
// src/lib/db.ts
import mongoose from "mongoose";

let cached = (global as any).__mongoose ?? { conn: null, promise: null };

export async function connectDB() {
  if (cached.conn) return cached.conn;
  if (!cached.promise) {
    cached.promise = mongoose.connect(process.env.MONGODB_URI!, { bufferCommands: false });
  }
  cached.conn = await cached.promise;
  (global as any).__mongoose = cached;
  return cached.conn;
}
```

### 8.2 Leads Router (Full Example)

```ts
// src/routes/leads.ts
import { Router } from "express";
import { z } from "zod";
import { verifyFirebaseToken } from "../middleware/auth";
import { rateLimiter } from "../middleware/rateLimit";
import User from "../models/User";
import Lead from "../models/Lead";
import { triggerN8nWebhook } from "../lib/n8n";

const router = Router();

// Apply Firebase token verification to all leads routes
router.use(verifyFirebaseToken);
router.use(rateLimiter);

const createLeadSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  source: z.enum(["website", "referral", "zillow", "cold-call", "social", "other"]),
  propertyType: z.enum(["buy", "sell", "rent"]),
  budget: z.number().optional(),
  notes: z.string().optional(),
});

// GET /api/leads
router.get("/", async (req, res) => {
  const dbUser = await User.findOne({ firebaseUid: req.user!.uid });
  if (!dbUser) return res.status(404).json({ error: "User not found" });

  const { status, source, page = "1", limit = "20" } = req.query;
  const filter: any = { agentId: dbUser._id };
  if (status) filter.status = status;
  if (source) filter.source = source;

  const leads = await Lead.find(filter)
    .sort({ createdAt: -1 })
    .skip((+page - 1) * +limit)
    .limit(+limit)
    .lean();

  const total = await Lead.countDocuments(filter);
  return res.json({ leads, total, page: +page });
});

// POST /api/leads
router.post("/", async (req, res) => {
  const parsed = createLeadSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const dbUser = await User.findOne({ firebaseUid: req.user!.uid });

  // Plan gate: Starter capped at 100 leads
  if (dbUser.plan === "starter") {
    const count = await Lead.countDocuments({ agentId: dbUser._id });
    if (count >= 100) {
      return res.status(403).json({ error: "Lead limit reached. Upgrade to Pro.", upgrade: true });
    }
  }

  const lead = await Lead.create({ ...parsed.data, agentId: dbUser._id });

  await triggerN8nWebhook("new-lead-created", { leadId: lead._id, agentId: dbUser._id });

  return res.status(201).json({ lead });
});

// GET /api/leads/:id
router.get("/:id", async (req, res) => {
  const dbUser = await User.findOne({ firebaseUid: req.user!.uid });
  const lead = await Lead.findOne({ _id: req.params.id, agentId: dbUser._id })
    .populate("assignedListingId")
    .lean();
  if (!lead) return res.status(404).json({ error: "Lead not found" });
  return res.json({ lead });
});

// PATCH /api/leads/:id
router.patch("/:id", async (req, res) => {
  const dbUser = await User.findOne({ firebaseUid: req.user!.uid });
  const lead = await Lead.findOneAndUpdate(
    { _id: req.params.id, agentId: dbUser._id },
    { ...req.body, updatedAt: new Date() },
    { new: true }
  );
  if (!lead) return res.status(404).json({ error: "Lead not found" });
  return res.json({ lead });
});

// DELETE /api/leads/:id
router.delete("/:id", async (req, res) => {
  const dbUser = await User.findOne({ firebaseUid: req.user!.uid });
  await Lead.findOneAndDelete({ _id: req.params.id, agentId: dbUser._id });
  return res.json({ ok: true });
});

// POST /api/leads/:id/activity
router.post("/:id/activity", async (req, res) => {
  const { type, content } = req.body;
  const dbUser = await User.findOne({ firebaseUid: req.user!.uid });

  const lead = await Lead.findOneAndUpdate(
    { _id: req.params.id, agentId: dbUser._id },
    {
      $push: { activities: { type, content, createdAt: new Date() } },
      lastContactedAt: new Date(),
      updatedAt: new Date(),
    },
    { new: true }
  );

  if (!lead) return res.status(404).json({ error: "Lead not found" });
  return res.json({ lead });
});

export default router;
```

---

## 9. Gemini AI — Listing Generator

### 9.1 Gemini Client Setup

```ts
// src/lib/gemini.ts
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
export const geminiModel = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });
```

### 9.2 AI Listing Generation — Streaming

```ts
// src/routes/listings.ts  (POST /api/listings/ai-generate)
import { geminiModel } from "../lib/gemini";

router.post("/ai-generate", async (req, res) => {
  const { bedrooms, bathrooms, sqft, location, features, tone } = req.body;

  const toneMap: Record<string, string> = {
    formal: "professional and formal",
    casual: "friendly and conversational",
    luxury: "premium, aspirational, and luxurious",
  };

  const prompt = `You are a professional real estate copywriter.
Write 3 different property listing descriptions for the property below.
Each description must be ${toneMap[tone ?? "formal"]}, under 150 words, and highlight key selling points.
Return a JSON object with keys "variant1", "variant2", "variant3".

Property:
- Bedrooms: ${bedrooms}
- Bathrooms: ${bathrooms}
- Square footage: ${sqft} sqft
- Location: ${location}
- Key features: ${features.join(", ")}`;

  // Stream Gemini response directly to client
  res.set0Header("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.flushHeaders();

  const result = await geminiModel.generateContentStream(prompt);

  for await (const chunk of result.stream) {
    const text = chunk.text();
    if (text) res.write(text);
  }

  res.end();
});
```

### 9.3 Lead Next-Action Suggestion

```ts
// GET /api/leads/:id/suggest
import { geminiModel } from "../lib/gemini";

router.get("/:id/suggest", async (req, res) => {
  const dbUser = await User.findOne({ firebaseUid: req.user!.uid });
  const lead = await Lead.findOne({ _id: req.params.id, agentId: dbUser._id }).lean();
  if (!lead) return res.status(404).json({ error: "Lead not found" });

  const prompt = `You are a real estate sales coach. Based on this lead's history,
suggest the single best next action for the agent to take today.
Be specific (e.g., "Send a WhatsApp message asking if they're free for a viewing this weekend").
Keep it under 50 words.

Lead status: ${lead.status}
Last contacted: ${lead.lastContactedAt}
Activity history: ${lead.activities.map((a: any) => `${a.type}: ${a.content}`).join(" | ")}
Property interest: ${lead.propertyType}, budget $${lead.budget}, areas: ${lead.preferredAreas?.join(", ")}`;

  const result = await geminiModel.generateContent(prompt);
  const suggestion = result.response.text();

  return res.json({ suggestion });
});
```

---

## 10. n8n Automation Integration

### 10.1 n8n Webhook Helper

```ts
// src/lib/n8n.ts
const N8N_BASE_URL = process.env.N8N_BASE_URL;
const N8N_WEBHOOK_SECRET = process.env.N8N_WEBHOOK_SECRET;

export async function triggerN8nWebhook(event: string, payload: object) {
  await fetch(`${N8N_BASE_URL}/webhook/${event}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Webhook-Secret": N8N_WEBHOOK_SECRET!,
    },
    body: JSON.stringify(payload),
  });
}
```

### 10.2 n8n Callback Route

```ts
// src/routes/automations.ts  (POST /api/automations/n8n-callback)
// n8n calls this after each workflow step — updates lead activity + automation stats
// No Firebase auth — verified by shared secret header

router.post("/n8n-callback", async (req, res) => {
  const secret = req.headers["x-webhook-secret"];
  if (secret !== process.env.N8N_WEBHOOK_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { event, leadId, automationId, result } = req.body;

  if (leadId) {
    await Lead.findByIdAndUpdate(leadId, {
      $push: {
        activities: { type: event, content: result.message, createdAt: new Date() },
      },
      lastContactedAt: new Date(),
    });
  }

  if (automationId) {
    await Automation.findByIdAndUpdate(automationId, {
      $inc: { runCount: 1 },
      lastRunAt: new Date(),
    });
  }

  return res.json({ ok: true });
});
```

### 10.3 Pre-Built n8n Workflows

```
Workflow 1: New Lead Follow-Up Sequence
  Trigger: Webhook (POST from /api/leads on lead created)
  Step 1: Wait 1 hour
  Step 2: Send WhatsApp via Twilio → callback POST /api/automations/n8n-callback
  Step 3: Wait 1 day → send email via Resend
  Step 4: Wait 3 days → if no reply → send SMS reminder
  Step 5: Wait 1 week → PATCH /api/leads/:id → status: "nurture"

Workflow 2: Appointment Reminder
  Trigger: Schedule (30 min before scheduledAt)
  Step 1: GET /api/appointments/:id
  Step 2: Send WhatsApp reminder to client
  Step 3: Send email reminder to agent

Workflow 3: Listing Published Alert
  Trigger: Webhook (when listing → "active")
  Step 1: GET /api/listings/:id/matched-leads
  Step 2: Send WhatsApp to each matched lead with listing link

Workflow 4: Monthly Performance Report
  Trigger: Cron (1st of each month, 8am)
  Step 1: GET /api/analytics/summary
  Step 2: Build report HTML → send via Resend to agent
```

---

## 11. Paddle Subscription

### 11.1 Paddle Client Setup

```ts
// src/lib/paddle.ts
import { Paddle, Environment } from "@paddle/paddle-node-sdk";

export const paddle = new Paddle(process.env.PADDLE_API_KEY!, {
  environment: process.env.PADDLE_ENVIRONMENT === "production"
    ? Environment.Production
    : Environment.Sandbox,
});
```

### 11.2 Pricing Plans

```ts
// src/lib/paddle-plans.ts
export const PADDLE_PLANS = {
  starter: {
    priceId: process.env.PADDLE_STARTER_PRICE_ID!,  // $49/month
    name: "Starter",
    limits: { leads: 100, automations: 2, agents: 1 },
  },
  pro: {
    priceId: process.env.PADDLE_PRO_PRICE_ID!,      // $99/month
    name: "Pro",
    limits: { leads: Infinity, automations: Infinity, agents: 1 },
  },
  brokerage: {
    priceId: process.env.PADDLE_BROKERAGE_PRICE_ID!, // $249/month
    name: "Brokerage",
    limits: { leads: Infinity, automations: Infinity, agents: 10 },
  },
};
```

### 11.3 Checkout Route

```ts
// src/routes/billing.ts  (POST /api/billing/checkout)
import { paddle } from "../lib/paddle";
import { PADDLE_PLANS } from "../lib/paddle-plans";

router.post("/checkout", verifyFirebaseToken, async (req, res) => {
  const { plan } = req.body;
  const planConfig = PADDLE_PLANS[plan as keyof typeof PADDLE_PLANS];
  if (!planConfig) return res.status(400).json({ error: "Invalid plan" });

  const dbUser = await User.findOne({ firebaseUid: req.user!.uid });

  let customerId = dbUser.paddleCustomerId;
  if (!customerId) {
    const customer = await paddle.customers.create({
      email: dbUser.email,
      name: dbUser.name,
    });
    customerId = customer.id;
    await User.findByIdAndUpdate(dbUser._id, { paddleCustomerId: customerId });
  }

  // Returns a transactionId — frontend uses it with Paddle.js overlay checkout
  const transaction = await paddle.transactions.create({
    items: [{ priceId: planConfig.priceId, quantity: 1 }],
    customerId,
    customData: { userId: dbUser._id.toString() },
  });

  return res.json({ transactionId: transaction.id });
});
```

### 11.4 Paddle Webhook Handler

```ts
// src/routes/billing.ts  (POST /api/billing/webhook)
// Raw body is required for signature verification — see server.ts setup
import { EventName } from "@paddle/paddle-node-sdk";

router.post("/webhook", async (req, res) => {
  const rawBody = req.body.toString();
  const signature = (req.headers["paddle-signature"] as string) ?? "";

  let event: any;
  try {
    event = paddle.webhooks.unmarshal(rawBody, process.env.PADDLE_WEBHOOK_SECRET!, signature);
  } catch {
    return res.status(400).json({ error: "Invalid signature" });
  }

  switch (event.eventType) {
    case EventName.SubscriptionActivated:
    case EventName.SubscriptionUpdated: {
      const sub = event.data;
      const userId = sub.customData?.userId;
      const planName = getPlanFromPriceId(sub.items[0].price.id);

      await User.findByIdAndUpdate(userId, { plan: planName, paddleSubscriptionId: sub.id });
      await Subscription.findOneAndUpdate(
        { paddleSubscriptionId: sub.id },
        {
          userId,
          paddleSubscriptionId: sub.id,
          paddleCustomerId: sub.customerId,
          plan: planName,
          status: "active",
          currentPeriodEnd: new Date(sub.currentBillingPeriod.endsAt),
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
      await User.findOneAndUpdate({ paddleSubscriptionId: sub.id }, { plan: "trial" });
      break;
    }

    case EventName.TransactionPaymentFailed: {
      const txn = event.data;
      await sendPaymentFailedEmail(txn.customer?.email ?? "");
      break;
    }
  }

  return res.json({ received: true });
});

function getPlanFromPriceId(priceId: string): string {
  if (priceId === process.env.PADDLE_STARTER_PRICE_ID) return "starter";
  if (priceId === process.env.PADDLE_PRO_PRICE_ID) return "pro";
  if (priceId === process.env.PADDLE_BROKERAGE_PRICE_ID) return "brokerage";
  return "trial";
}
```

---

## 12. File Upload — Cloudflare R2

```ts
// src/lib/r2.ts
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const r2 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

// src/routes/upload.ts  (POST /api/upload)
// Client requests a presigned URL, then PUTs the file directly to R2

router.post("/", verifyFirebaseToken, async (req, res) => {
  const { filename, contentType } = req.body;
  const key = `uploads/${req.user!.uid}/${Date.now()}-${filename}`;

  const command = new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
    ContentType: contentType,
  });

  const presignedUrl = await getSignedUrl(r2, command, { expiresIn: 300 });
  const publicUrl = `${process.env.R2_PUBLIC_URL}/${key}`;

  return res.json({ presignedUrl, publicUrl, key });
});
```

---

## 13. Rate Limiting

```ts
// src/lib/redis.ts
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_URL!,
  token: process.env.UPSTASH_REDIS_TOKEN!,
});

export const ratelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "1 s"),  // 10 req/sec per user
});

// src/middleware/rateLimit.ts
import { Request, Response, NextFunction } from "express";
import { ratelimit } from "../lib/redis";

export async function rateLimiter(req: Request, res: Response, next: NextFunction) {
  const identifier = req.user?.uid ?? req.ip;
  const { success } = await ratelimit.limit(identifier);

  if (!success) {
    return res.status(429).json({ error: "Too many requests. Slow down." });
  }

  next();
}
```

---

## 14. Backend Dependencies

```json
{
  "dependencies": {
    "express": "^4.18.0",
    "cors": "^2.8.5",
    "helmet": "^7.0.0",

    "firebase-admin": "^12.0.0",

    "mongoose": "^8.0.0",

    "@google/generative-ai": "^0.21.0",

    "@paddle/paddle-node-sdk": "^1.0.0",

    "resend": "^3.0.0",
    "twilio": "^5.0.0",

    "@aws-sdk/client-s3": "^3.0.0",
    "@aws-sdk/s3-request-presigner": "^3.0.0",

    "@upstash/ratelimit": "^2.0.0",
    "@upstash/redis": "^1.0.0",

    "zod": "^3.22.0",
    "nanoid": "^5.0.0",
    "date-fns": "^3.0.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "@types/express": "^4.17.0",
    "@types/cors": "^2.8.0",
    "@types/node": "^20.0.0",
    "ts-node-dev": "^2.0.0",
    "eslint": "^8.0.0",
    "prettier": "^3.0.0",
    "jest": "^29.0.0",
    "@types/jest": "^29.0.0"
  },
  "scripts": {
    "dev": "ts-node-dev --respawn src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js"
  }
}
```

---

## 15. Environment Variables

```bash
# App
PORT=4000
FRONTEND_URL=http://localhost:3000      # CORS allowed origin

# MongoDB
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/realflow

# Firebase Admin (server-side only)
FIREBASE_PROJECT_ID=realflow-ai
FIREBASE_CLIENT_EMAIL=firebase-adminsdk@realflow-ai.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

# Gemini (Google AI)
GEMINI_API_KEY=AIza...

# Paddle
PADDLE_API_KEY=pdl_live_...
PADDLE_WEBHOOK_SECRET=pdl_ntfset_...
PADDLE_ENVIRONMENT=sandbox          # or "production"
PADDLE_STARTER_PRICE_ID=pri_...
PADDLE_PRO_PRICE_ID=pri_...
PADDLE_BROKERAGE_PRICE_ID=pri_...

# Resend (transactional email)
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=noreply@realflowai.com

# Twilio (SMS + WhatsApp)
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=+1...
TWILIO_WHATSAPP_NUMBER=whatsapp:+1...

# Cloudflare R2 (file storage)
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=realflow-files
R2_ENDPOINT=https://xxx.r2.cloudflarestorage.com
R2_PUBLIC_URL=https://files.realflowai.com

# n8n
N8N_BASE_URL=https://n8n.realflowai.com
N8N_WEBHOOK_SECRET=...

# Upstash Redis (rate limiting)
UPSTASH_REDIS_URL=...
UPSTASH_REDIS_TOKEN=...
```

---

## 16. Build Order — Backend Phases

### PHASE 1 — Foundation (Days 1–5)

```
Day 1: Project Bootstrap
├── mkdir backend && cd backend
├── npm init -y && npm i express cors helmet typescript ts-node-dev @types/express @types/node
├── Write tsconfig.json (target: ES2020, module: commonjs, outDir: dist)
├── Write src/server.ts (Express app shell — no routes yet)
└── npm run dev → "API running on port 4000"

Day 2: Firebase Admin + Auth Middleware
├── Create Firebase project (console.firebase.google.com)
├── Enable Email/Password auth provider
├── Generate service account key → save as JSON
├── npm i firebase-admin
├── Write src/lib/firebase-admin.ts
├── Write src/middleware/auth.ts (verifyFirebaseToken)
└── Test: POST /api/auth/register with a real Firebase ID token

Day 3: MongoDB + Core Models
├── Create MongoDB Atlas cluster (free tier M0)
├── npm i mongoose
├── Write src/lib/db.ts (singleton connection)
├── Write User model (firebaseUid — no password field)
├── Write GET /api/auth/me → returns user doc
└── Test: register via Firebase → user doc appears in Atlas

Day 4: Remaining Models
├── Write Lead, Listing, Appointment, Automation, Subscription models
├── Write TypeScript interfaces for each schema
└── Add MongoDB indexes: agentId + createdAt on Lead and Listing

Day 5: Rate Limiting
├── Set up Upstash Redis (upstash.com — free tier)
├── npm i @upstash/ratelimit @upstash/redis
├── Write src/lib/redis.ts
├── Write src/middleware/rateLimit.ts
└── Apply rateLimiter to all protected routes
```

### PHASE 2 — Lead API (Days 6–10)

```
Day 6: Lead CRUD
├── GET /api/leads — paginated, filterable by status/source
├── POST /api/leads — Zod validation + plan limit check (100 for Starter)
├── GET /api/leads/:id — populate assignedListingId
├── PATCH /api/leads/:id — partial update
└── DELETE /api/leads/:id

Day 7: Lead Activity
├── POST /api/leads/:id/activity — log call, note, email, etc.
├── Auto-update lastContactedAt on activity log
└── Test timeline

Day 8: Lead Suggest (Gemini)
├── npm i @google/generative-ai
├── Write src/lib/gemini.ts
├── Write GET /api/leads/:id/suggest using Gemini generateContent()
└── Test: lead with history → Gemini returns actionable suggestion

Day 9: Client Portal
├── Auto-generate nanoid token on lead creation
├── Build GET /api/portal/:token (no auth required)
│   Returns: lead name, deal stage, appointments, documents
└── Test with public browser tab (no Authorization header)

Day 10: Lead Bulk Actions
├── POST /api/leads/bulk/email → Resend email to multiple leads
├── POST /api/leads/bulk/sms → Twilio SMS to multiple leads
└── PATCH /api/leads/bulk → update status for selected lead IDs
```

### PHASE 3 — Listings + Gemini Streaming (Days 11–15)

```
Day 11: Listing CRUD
├── GET/POST /api/listings
├── GET/PATCH/DELETE /api/listings/:id
└── Test with Thunder Client / Postman

Day 12: Gemini Streaming Route
├── POST /api/listings/ai-generate
│   Uses generateContentStream() → SSE stream back to client
├── Test: curl with property JSON → streamed text response
└── Tune prompt for 3 variants (formal / casual / luxury)

Day 13: Lead Matching + Notify
├── GET /api/listings/:id/matched-leads
│   Filter: propertyType matches + budget ≥ listing.price × 0.8
└── POST /api/listings/:id/notify → triggerN8nWebhook("listing-published", ...)

Day 14: File Upload (R2)
├── npm i @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
├── Write src/lib/r2.ts
├── Write POST /api/upload → returns presignedUrl + publicUrl
└── Test: frontend PUTs image → verify in R2 dashboard

Day 15: Listing Status Transitions
├── Add status flow: draft → active → under-contract → sold
├── On "active": fire n8n "listing-published" webhook
└── Test full flow
```

### PHASE 4 — Automations + n8n (Days 16–20)

```
Day 16: n8n Deployment
├── Deploy n8n on Railway: image n8nio/n8n
│   ENV: N8N_BASIC_AUTH_ACTIVE=true, N8N_BASIC_AUTH_USER, PASS
├── Set public URL → add N8N_BASE_URL to .env
└── Test: POST from your app → n8n webhook receives it

Day 17: n8n Workflows (build in n8n UI)
├── Workflow 1: New Lead Follow-Up Sequence
├── Workflow 2: Appointment Reminder
├── Workflow 3: Listing Published Alert
├── Workflow 4: Monthly Report Cron
├── Export all as JSON → commit to /n8n-workflows/ folder
└── Configure n8n callback to POST /api/automations/n8n-callback

Day 18: Automation API
├── GET /api/automations — list MongoDB automation records
├── PATCH /api/automations/:id — toggle + call n8n activate/deactivate API
├── POST /api/automations/:id/run — manual trigger
└── POST /api/automations/n8n-callback — update activity + run stats

Day 19: Resend Email
├── npm i resend
├── Write src/lib/resend.ts (sendEmail helper)
├── Create templates: welcome, lead-followup, appointment-reminder, trial-ending
└── Test with Resend dashboard preview

Day 20: Twilio WhatsApp + SMS
├── npm i twilio
├── Write src/lib/twilio.ts (sendWhatsApp + sendSMS helpers)
├── Set up Twilio WhatsApp Sandbox
└── Test: n8n workflow fires → WhatsApp received on test phone
```

### PHASE 5 — Paddle Billing (Days 21–25)

```
Day 21: Paddle Setup
├── Create Paddle account (developer.paddle.com)
├── Create 3 products (Starter $49, Pro $99, Brokerage $249)
├── npm i @paddle/paddle-node-sdk
├── Write src/lib/paddle.ts + src/lib/paddle-plans.ts
└── Add all Paddle env vars

Day 22: Billing Routes
├── POST /api/billing/checkout — create Paddle transaction → return transactionId
├── GET /api/billing/invoices — list from Paddle API
├── POST /api/billing/cancel — cancel Paddle subscription
└── POST /api/billing/portal — customer portal URL

Day 23: Paddle Webhook
├── POST /api/billing/webhook (raw body — see server.ts)
├── Verify signature with paddle.webhooks.unmarshal()
├── SubscriptionActivated → update user.plan
├── SubscriptionCanceled → downgrade to trial
├── TransactionPaymentFailed → send Resend warning email
└── Test with Paddle sandbox events

Day 24: Plan Gating
├── 100 lead cap for Starter in POST /api/leads
├── 2 automation cap for Starter in PATCH /api/automations/:id
└── Return { error: "...", upgrade: true } on limit hit (403)

Day 25: Trial System
├── trialEndsAt = now + 14 days set on register
├── Schedule Resend email 3 days before expiry (n8n Cron)
└── Return trialDaysRemaining in GET /api/auth/me
```

### PHASE 6 — Analytics + Security (Days 26–30)

```
Day 26: Analytics API
├── GET /api/analytics/summary?days=30
│   Returns: leads by stage, leads by source, weekly new leads, conversion rate
└── GET /api/analytics/agents (Brokerage plan only)

Day 27: Appointments API
├── GET/POST /api/appointments
├── PATCH/DELETE /api/appointments/:id
└── On create: triggerN8nWebhook("appointment-set", ...) → schedules reminder

Day 28: Documents API
├── GET/POST /api/documents (metadata in MongoDB, file in R2)
├── PATCH /api/documents/:id → update signing status
└── Associate document with leadId

Day 29: Security Hardening
├── Confirm verifyFirebaseToken is applied to every protected router
├── Confirm Paddle webhook uses raw body + signature verification
├── Add Zod validation to every POST/PATCH route
├── Verify no secrets are in CORS-exposed responses
└── Test NoSQL injection (Mongoose parameterized queries are safe by default)

Day 30: Performance + Monitoring
├── Add MongoDB indexes: agentId, status, createdAt on Lead and Listing
├── Use .lean() on all GET queries
├── Add /health endpoint for Railway uptime checks
└── Set up Railway log forwarding or Axiom for error monitoring
```

---

*Backend for: RealFlow AI | Stack: Express.js + Firebase Admin (JWT) + MongoDB + Gemini + Paddle + n8n*
*Total backend build time: ~5 weeks full-time (overlaps with frontend)*
