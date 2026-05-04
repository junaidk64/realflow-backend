import { Router } from "express";
import { EventName } from "@paddle/paddle-node-sdk";
import { verifyFirebaseToken } from "../middleware/auth";
import { rateLimiter } from "../middleware/rateLimit";
import User from "../models/User";
import Subscription from "../models/Subscription";
import { paddle } from "../lib/paddle";
import { PADDLE_PLANS } from "../lib/paddle-plans";
import { sendPaymentFailedEmail } from "../lib/resend";

const router = Router();

function getPlanFromPriceId(priceId: string): string {
  if (priceId === process.env.PADDLE_STARTER_PRICE_ID) return "starter";
  if (priceId === process.env.PADDLE_PRO_PRICE_ID) return "pro";
  if (priceId === process.env.PADDLE_BROKERAGE_PRICE_ID) return "brokerage";
  return "trial";
}

// POST /api/billing/webhook — raw body, no Firebase auth
router.post("/webhook", async (req, res) => {
  const rawBody = req.body.toString();
  const signature = (req.headers["paddle-signature"] as string) ?? "";

  let event: any;
  try {
    event = paddle.webhooks.unmarshal(rawBody, process.env.PADDLE_WEBHOOK_SECRET!, signature);
  } catch {
    return res.status(400).json({ error: "Invalid signature" });
  }

  try {
    switch (event.eventType) {
      case EventName.SubscriptionActivated:
      case EventName.SubscriptionUpdated: {
        const sub = event.data;
        const userId = sub.customData?.userId;
        const planName = getPlanFromPriceId(sub.items[0].price.id);
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

      case EventName.SubscriptionCanceled: {
        const sub = event.data;
        await Subscription.findOneAndUpdate(
          { paddleSubscriptionId: sub.id },
          { status: "cancelled", cancelledAt: new Date() }
        );
        await User.findOneAndUpdate(
          { paddleSubscriptionId: sub.id },
          { plan: "trial", subscriptionStatus: "cancelled", currentPeriodEnd: undefined }
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

  return res.json({ received: true });
});

// All routes below require auth
router.use(verifyFirebaseToken);
router.use(rateLimiter);

// POST /api/billing/checkout
router.post("/checkout", async (req, res) => {
  try {
    const { plan } = req.body;
    const planConfig = PADDLE_PLANS[plan as keyof typeof PADDLE_PLANS];
    if (!planConfig) return res.status(400).json({ error: "Invalid plan" });

    const dbUser = await User.findOne({ firebaseUid: req.user!.uid });
    if (!dbUser) return res.status(404).json({ error: "User not found" });

    let customerId = dbUser.paddleCustomerId;
    if (!customerId) {
      const customer = await paddle.customers.create({
        email: dbUser.email!,
        name: dbUser.name,
      });
      customerId = customer.id;
      await User.findByIdAndUpdate(dbUser._id, { paddleCustomerId: customerId });
    }

    const transaction = await paddle.transactions.create({
      items: [{ priceId: planConfig.priceId, quantity: 1 }],
      customerId,
      customData: { userId: dbUser._id.toString() },
    });

    return res.json({ transactionId: transaction.id });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/billing/invoices
router.get("/invoices", async (req, res) => {
  try {
    const dbUser = await User.findOne({ firebaseUid: req.user!.uid });
    if (!dbUser || !dbUser.paddleCustomerId) return res.json({ invoices: [] });

    const collection = paddle.transactions.list({
      customerId: [dbUser.paddleCustomerId],
    });

    const invoices = [];
    for await (const txn of collection) {
      invoices.push(txn);
    }

    return res.json({ invoices });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/billing/cancel
router.post("/cancel", async (req, res) => {
  try {
    const dbUser = await User.findOne({ firebaseUid: req.user!.uid });
    if (!dbUser || !dbUser.paddleSubscriptionId) {
      return res.status(400).json({ error: "No active subscription" });
    }

    await paddle.subscriptions.cancel(dbUser.paddleSubscriptionId, {
      effectiveFrom: "next_billing_period",
    });

    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/billing/portal
router.post("/portal", async (req, res) => {
  try {
    const dbUser = await User.findOne({ firebaseUid: req.user!.uid });
    if (!dbUser || !dbUser.paddleCustomerId) {
      return res.status(400).json({ error: "No billing account found" });
    }

    // Generate a short-lived auth token for the Paddle customer portal
    const authToken = await paddle.customers.generateAuthToken(dbUser.paddleCustomerId);
    const portalUrl = `https://customer.paddle.com/login?token=${authToken.customerAuthToken}`;

    return res.json({ url: portalUrl });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
