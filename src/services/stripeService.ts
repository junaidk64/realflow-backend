// import Stripe from 'stripe'
// import { User } from '../models/User'
// import { Lead } from '../models/Lead'
// import logger from '../utils/logger'

// // eslint-disable-next-line @typescript-eslint/no-explicit-any
// const stripe = new (Stripe as any)(process.env.STRIPE_SECRET_KEY || '') as {
//   checkout: {
//     sessions: {
//       create(params: Record<string, unknown>): Promise<{ url: string | null }>
//     }
//   }
//   billingPortal: {
//     sessions: {
//       create(params: Record<string, unknown>): Promise<{ url: string | null }>
//     }
//   }
//   webhooks: {
//     constructEvent(body: Buffer, sig: string, secret: string): { type: string; data: { object: Record<string, unknown> } }
//   }
// }

// export async function createCheckoutSession(
//   userId: string,
//   priceId: string,
//   email: string,
// ): Promise<{ url: string | null }> {
//   return stripe.checkout.sessions.create({
//     payment_method_types: ['card'],
//     customer_email: email,
//     line_items: [{ price: priceId, quantity: 1 }],
//     mode: 'subscription',
//     success_url: `${process.env.FRONTEND_URL}/settings?upgraded=true`,
//     cancel_url: `${process.env.FRONTEND_URL}/settings`,
//     metadata: { userId },
//   })
// }

// export async function createCustomerPortalSession(
//   customerId: string,
// ): Promise<{ url: string | null }> {
//   return stripe.billingPortal.sessions.create({
//     customer: customerId,
//     return_url: `${process.env.FRONTEND_URL}/settings`,
//   })
// }

// export async function handleWebhook(rawBody: Buffer, signature: string): Promise<void> {
//   const secret = process.env.STRIPE_WEBHOOK_SECRET || ''
//   let event: { type: string; data: { object: Record<string, unknown> } }

//   try {
//     event = stripe.webhooks.constructEvent(rawBody, signature, secret)
//   } catch (err) {
//     throw new Error(`Webhook signature verification failed: ${(err as Error).message}`)
//   }

//   const obj = event.data.object

//   switch (event.type) {
//     case 'checkout.session.completed': {
//       const userId = (obj.metadata as Record<string, string>)?.userId
//       if (!userId || !obj.customer || !obj.subscription) break
//       await User.findByIdAndUpdate(userId, {
//         stripeCustomerId: String(obj.customer),
//         stripeSubscriptionId: String(obj.subscription),
//         plan: 'basic',
//       })
//       logger.info(`Stripe: user ${userId} upgraded to basic`)
//       break
//     }

//     case 'customer.subscription.updated': {
//       const subId = String(obj.id)
//       const user = await User.findOne({ stripeSubscriptionId: subId })
//       if (!user) break
//       const items = obj.items as { data: Array<{ price: { id: string } }> }
//       const priceId = items?.data[0]?.price?.id || ''
//       const plan = priceId === process.env.STRIPE_PRO_PRICE_ID ? 'pro' : 'basic'
//       await User.findByIdAndUpdate(user._id, { plan })
//       logger.info(`Stripe: subscription updated for user ${user._id} → ${plan}`)
//       break
//     }

//     case 'customer.subscription.deleted': {
//       const subId = String(obj.id)
//       await User.findOneAndUpdate({ stripeSubscriptionId: subId }, { plan: 'free', stripeSubscriptionId: null })
//       logger.info(`Stripe: subscription cancelled for sub ${subId}`)
//       break
//     }

//     case 'invoice.payment_failed': {
//       logger.warn(`Stripe: payment failed for customer ${obj.customer}`)
//       break
//     }
//   }
// }

// export async function getMonthlyLeadCount(userId: string): Promise<number> {
//   const monthStart = new Date()
//   monthStart.setDate(1)
//   monthStart.setHours(0, 0, 0, 0)
//   return Lead.countDocuments({ userId, createdAt: { $gte: monthStart } })
// }
