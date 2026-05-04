import { Router } from 'express'
import { z } from 'zod'
import GeocodeService from '../lib/geocodes'
import { verifyFirebaseToken } from '../middleware/auth'
import { rateLimiter } from '../middleware/rateLimit'

const router = Router()
router.use(verifyFirebaseToken)
router.use(rateLimiter)

const predictionSchema = z.object({
	input: z.string().min(1, 'Input is required'),
	latitude: z.number().optional(),
	longitude: z.number().optional(),
	radius: z.number().default(1000).default(1000), //.refine((val) => val > 0, {
})

const detailsSchema = z.object({
	placeId: z.string().min(1, 'Place ID is required'),
})

const addressFromCoordsSchema = z.object({
	latitude: z.number(),
	longitude: z.number(),
})

const directionSchema = z.object({
	from: z.object({
		latitude: z.number(),
		longitude: z.number(),
	}),
	to: z.object({
		latitude: z.number(),
		longitude: z.number(),
	}),
})

// POST /api/geocodes/prediction
router.post('/prediction', async (req, res) => {
	try {
		const parsed = predictionSchema.safeParse(req.body)
		if (!parsed.success)
			return res.status(400).json({ error: parsed.error.flatten() })

		const { input, latitude, longitude, radius } = parsed.data

		const predictions = await GeocodeService.prediction(
			input,
			radius,
			latitude,
			longitude,
		)

		return res.json({ predictions })
	} catch (err) {
		const maybeErr = err as { message?: string }
		return res.status(500).json({
			error: 'Failed to get predictions',
			details: maybeErr?.message ?? 'Unknown error',
		})
	}
})

// POST /api/geocodes/details
router.post('/details', async (req, res) => {
	try {
		const parsed = detailsSchema.safeParse(req.body)
		if (!parsed.success)
			return res.status(400).json({ error: parsed.error.flatten() })

		const { placeId } = parsed.data

		const address = await GeocodeService.autocompleteDetails(placeId)

		return res.json({ address })
	} catch (err) {
		const maybeErr = err as { message?: string }
		return res.status(500).json({
			error: 'Failed to get place details',
			details: maybeErr?.message ?? 'Unknown error',
		})
	}
})

// POST /api/geocodes/address-from-coords
router.post('/address-from-coords', async (req, res) => {
	try {
		const parsed = addressFromCoordsSchema.safeParse(req.body)
		if (!parsed.success)
			return res.status(400).json({ error: parsed.error.flatten() })

		const { latitude, longitude } = parsed.data

		const address = await GeocodeService.addressFromCoords(latitude, longitude)

		return res.json({ address })
	} catch (err) {
		const maybeErr = err as { message?: string }
		return res.status(500).json({
			error: 'Failed to get address from coordinates',
			details: maybeErr?.message ?? 'Unknown error',
		})
	}
})

// POST /api/geocodes/direction
router.post('/direction', async (req, res) => {
	try {
		const parsed = directionSchema.safeParse(req.body)
		if (!parsed.success)
			return res.status(400).json({ error: parsed.error.flatten() })

		const { from, to } = parsed.data

		const direction = await GeocodeService.direction(from, to)

		return res.json({ direction })
	} catch (err) {
		const maybeErr = err as { message?: string }
		return res.status(500).json({
			error: 'Failed to get direction',
			details: maybeErr?.message ?? 'Unknown error',
		})
	}
})

export default router
