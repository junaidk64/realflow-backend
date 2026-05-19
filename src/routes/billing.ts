// import express, { Request, Response, NextFunction } from 'express'
// import { verifyToken } from '../middlewares/auth'
// import {
//   createCheckoutSession,
//   createCustomerPortalSession,
//   handleWebhook,
//   getMonthlyLeadCount,
// } from '../services/stripeService'
// import { User } from '../models/User'

// const router = express.Router()

// // POST /api/billing/checkout — create Stripe checkout session
// router.post('/checkout', verifyToken, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
//   try {
//     const { priceId } = req.body
//     if (!priceId) {
//       res.status(400).json({ success: false, message: 'priceId required' })
//       return
//     }
//     const user = await User.findById(req.user!.userId)
//     if (!user) {
//       res.status(404).json({ success: false, message: 'User not found' })
//       return
//     }
//     const session = await createCheckoutSession(String(user._id), priceId, user.email)
//     res.json({ success: true, data: { url: session.url } })
//   } catch (err) {
//     next(err)
//   }
// })

// // POST /api/billing/portal — Stripe customer portal
// router.post('/portal', verifyToken, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
//   try {
//     const user = await User.findById(req.user!.userId)
//     if (!user?.stripeCustomerId) {
//       res.status(400).json({ success: false, message: 'No billing account found' })
//       return
//     }
//     const session = await createCustomerPortalSession(user.stripeCustomerId)
//     res.json({ success: true, data: { url: session.url } })
//   } catch (err) {
//     next(err)
//   }
// })

// // GET /api/billing/status — current plan + usage
// router.get('/status', verifyToken, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
//   try {
//     const user = await User.findById(req.user!.userId).lean()
//     if (!user) {
//       res.status(404).json({ success: false, message: 'User not found' })
//       return
//     }
//     const leadsThisMonth = await getMonthlyLeadCount(String(user._id))
//     const limits: Record<string, number> = { free: 30, basic: 500, pro: -1 }
//     const plan = (user as { plan?: string }).plan || 'free'
//     res.json({
//       success: true,
//       data: {
//         plan,
//         leadsThisMonth,
//         limit: limits[plan] ?? 30,
//       },
//     })
//   } catch (err) {
//     next(err)
//   }
// })

// // POST /api/billing/webhook — Stripe webhook (raw body required)
// router.post(
//   '/webhook',
//   express.raw({ type: 'application/json' }),
//   async (req: Request, res: Response, next: NextFunction): Promise<void> => {
//     try {
//       const sig = req.headers['stripe-signature'] as string
//       await handleWebhook(req.body as Buffer, sig)
//       res.json({ received: true })
//     } catch (err) {
//       next(err)
//     }
//   },
// )

// export default router
