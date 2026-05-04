import { Router } from 'express'
import { z } from 'zod'
import { generateGeminiContent } from '../lib/gemini'
import { triggerN8nWebhook } from '../lib/n8n'
import { verifyFirebaseToken } from '../middleware/auth'
import { rateLimiter } from '../middleware/rateLimit'
import Lead from '../models/Lead'
import Listing from '../models/Listing'
import User from '../models/User'

const router = Router()
router.use(verifyFirebaseToken)
router.use(rateLimiter)

const createListingSchema = z.object({
	title: z.string().optional(),
	address: z
		.object({
			street: z.string().optional(),
			city: z.string().optional(),
			state: z.string().optional(),
			zip: z.string().optional(),
			country: z.string().optional(),
			latitude: z.number().optional(),
			longitude: z.number().optional(),
			coordinates: z.tuple([z.number(), z.number()]).optional(), // [longitude, latitude]
			type: z.enum(['Point']).optional(),
		})
		.optional(),
	price: z.number().optional(),
	bedrooms: z.number().optional(),
	bathrooms: z.number().optional(),
	sqft: z.number().optional(),
	propertyType: z
		.enum(['house', 'condo', 'townhouse', 'land', 'commercial'])
		.optional(),
	listingType: z.enum(['sale', 'rent']).optional(),
	features: z.array(z.string()).optional(),
	description: z.string().optional(),
	images: z.array(z.string()).optional(),
	mlsNumber: z.string().optional(),
})

const aiGenerateSchema = z.object({
	bedrooms: z.number().optional(),
	bathrooms: z.number().optional(),
	sqft: z.number().optional(),
	location: z.string().optional(),
	features: z.array(z.string()).default([]),
	tone: z.enum(['formal', 'casual', 'luxury']).default('formal'),
})

// POST /api/listings/ai-generate  (must be before /:id)
router.post('/ai-generate', async (req, res) => {
	try {
		const parsed = aiGenerateSchema.safeParse(req.body)
		if (!parsed.success)
			return res.status(400).json({ error: parsed.error.flatten() })

		const { bedrooms, bathrooms, sqft, location, features, tone } = parsed.data

		const toneMap: Record<string, string> = {
			formal: 'professional and formal',
			casual: 'friendly and conversational',
			luxury: 'premium, aspirational, and luxurious',
		}

		const prompt = `You are a professional real estate copywriter.
Write 3 different property listing descriptions for the property below.
Each description must be ${toneMap[tone ?? 'formal']}, under 150 words, and highlight key selling points.
Return a JSON object with keys "variant1", "variant2", "variant3".
Return only JSON. Do not include markdown fences.

Property:
- Bedrooms: ${bedrooms}
- Bathrooms: ${bathrooms}
- Square footage: ${sqft} sqft
- Location: ${location}

- Key features: ${features.join(', ')}`

		const { result, model } = await generateGeminiContent(prompt)

		const rawText = result.response.text()?.trim() ?? ''
		const cleanedText = rawText
			.replace(/^```json\s*/i, '')
			.replace(/^```\s*/i, '')
			.replace(/\s*```$/, '')
			.trim()

		try {
			const variants = JSON.parse(cleanedText)
			return res.json({ variants, model })
		} catch (error) {
			return res.status(502).json({
				error: 'AI returned an invalid response format',
				rawText,
				model,
			})
		}
	} catch (err) {
		const maybeErr = err as {
			status?: number
			statusText?: string
			message?: string
		}

		if (maybeErr?.status === 404) {
			return res.status(502).json({
				error: 'Gemini model endpoint not found',
				configuredModels: [process.env.GEMINI_MODEL ?? 'gemini-2.0-flash'],
				details: maybeErr.message ?? maybeErr.statusText,
			})
		}

		return res.status(500).json({
			error: 'Internal server error',
			details: maybeErr?.message ?? 'Unknown error',
		})
	}
})

// GET /api/listings
router.get('/', async (req, res) => {
	try {
		const dbUser = await User.findOne({ firebaseUid: req.user!.uid })
		if (!dbUser) return res.status(404).json({ error: 'User not found' })

		const listings = await Listing.find({ agentId: dbUser._id })
			.sort({ createdAt: -1 })
			.lean()
		return res.json({ listings })
	} catch (err) {
		return res.status(500).json({ error: 'Internal server error' })
	}
})

// POST /api/listings
router.post('/', async (req, res) => {
	try {
		const parsed = createListingSchema.safeParse(req.body)
		if (!parsed.success)
			return res.status(400).json({ error: parsed.error.flatten() })

		const dbUser = await User.findOne({ firebaseUid: req.user!.uid })
		if (!dbUser) return res.status(404).json({ error: 'User not found' })

		const listing = await Listing.create({
			...parsed.data,
			agentId: dbUser._id,
		})
		return res.status(201).json({ listing })
	} catch (err) {
		return res.status(500).json({ error: 'Internal server error' })
	}
})

// GET /api/listings/:id
router.get('/:id', async (req, res) => {
	try {
		const dbUser = await User.findOne({ firebaseUid: req.user!.uid })
		if (!dbUser) return res.status(404).json({ error: 'User not found' })

		const listing = await Listing.findOne({
			_id: req.params.id,
			agentId: dbUser._id,
		}).lean()
		if (!listing) return res.status(404).json({ error: 'Listing not found' })
		return res.json({ listing })
	} catch (err) {
		return res.status(500).json({ error: 'Internal server error' })
	}
})

// PATCH /api/listings/:id
router.patch('/:id', async (req, res) => {
	try {
		const dbUser = await User.findOne({ firebaseUid: req.user!.uid })
		if (!dbUser) return res.status(404).json({ error: 'User not found' })

		const prev = await Listing.findOne({
			_id: req.params.id,
			agentId: dbUser._id,
		})
		if (!prev) return res.status(404).json({ error: 'Listing not found' })

		const listing = await Listing.findOneAndUpdate(
			{ _id: req.params.id, agentId: dbUser._id },
			req.body,
			{ new: true },
		)

		// Trigger n8n when status changes to active
		if (req.body.status === 'active' && prev.status !== 'active') {
			await triggerN8nWebhook('listing-published', {
				listingId: listing!._id,
				agentId: dbUser._id,
			})
		}

		return res.json({ listing })
	} catch (err) {
		return res.status(500).json({ error: 'Internal server error' })
	}
})

// DELETE /api/listings/:id
router.delete('/:id', async (req, res) => {
	try {
		const dbUser = await User.findOne({ firebaseUid: req.user!.uid })
		if (!dbUser) return res.status(404).json({ error: 'User not found' })

		await Listing.findOneAndDelete({ _id: req.params.id, agentId: dbUser._id })
		return res.json({ ok: true })
	} catch (err) {
		return res.status(500).json({ error: 'Internal server error' })
	}
})

// GET /api/listings/:id/matched-leads
router.get('/:id/matched-leads', async (req, res) => {
	try {
		const dbUser = await User.findOne({ firebaseUid: req.user!.uid })
		if (!dbUser) return res.status(404).json({ error: 'User not found' })

		const listing = await Listing.findOne({
			_id: req.params.id,
			agentId: dbUser._id,
		}).lean()
		if (!listing) return res.status(404).json({ error: 'Listing not found' })

		const filter: Record<string, unknown> = { agentId: dbUser._id }
		if (listing.propertyType) {
			const typeMap: Record<string, string> = {
				house: 'buy',
				condo: 'buy',
				townhouse: 'buy',
				land: 'buy',
				commercial: 'buy',
			}
			filter.propertyType = typeMap[listing.propertyType] ?? 'buy'
		}
		if (listing.price) {
			filter.budget = { $gte: listing.price * 0.8 }
		}

		const leads = await Lead.find(filter).lean()
		return res.json({ leads })
	} catch (err) {
		return res.status(500).json({ error: 'Internal server error' })
	}
})

// POST /api/listings/:id/notify
router.post('/:id/notify', async (req, res) => {
	try {
		const dbUser = await User.findOne({ firebaseUid: req.user!.uid })
		if (!dbUser) return res.status(404).json({ error: 'User not found' })

		const listing = await Listing.findOne({
			_id: req.params.id,
			agentId: dbUser._id,
		}).lean()
		if (!listing) return res.status(404).json({ error: 'Listing not found' })

		await triggerN8nWebhook('listing-published', {
			listingId: listing._id,
			agentId: dbUser._id,
		})

		return res.json({ ok: true })
	} catch (err) {
		return res.status(500).json({ error: 'Internal server error' })
	}
})

export default router
