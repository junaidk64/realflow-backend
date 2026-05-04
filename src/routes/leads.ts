import { Router } from 'express'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import { generateGeminiContent } from '../lib/gemini'
import { triggerN8nWebhook } from '../lib/n8n'
import { sendEmail } from '../lib/resend'
import { sendSMS } from '../lib/twilio'
import { verifyFirebaseToken } from '../middleware/auth'
import { rateLimiter } from '../middleware/rateLimit'
import Lead from '../models/Lead'
import User from '../models/User'

const router = Router()
router.use(verifyFirebaseToken)
router.use(rateLimiter)

const createLeadSchema = z.object({
	name: z.string().min(1),
	email: z.string().email().optional(),
	phone: z.string().optional(),
	source: z.enum([
		'website',
		'referral',
		'zillow',
		'cold-call',
		'social',
		'other',
	]),
	propertyType: z
		.enum([
			'buy',
			'sell',
			'rent',
			'house',
			'condo',
			'townhouse',
			'land',
			'commercial',
			'other',
		])
		.optional(),
	budget: z.number().optional(),
	preferredAreas: z.array(z.string()).optional(),
	bedrooms: z.number().optional(),
	notes: z.string().optional(),
	tags: z.array(z.string()).optional(),
})

const buildLeadUpdateActivity = (
	currentStatus: string,
	updates: Record<string, unknown>,
) => {
	const changedFields = Object.keys(updates).filter(
		(field) => field !== 'updatedAt',
	)

	if (typeof updates.status === 'string' && updates.status !== currentStatus) {
		return {
			type: 'status-change' as const,
			content: `Status changed from ${currentStatus} to ${updates.status}`,
			createdAt: new Date(),
		}
	}

	if (changedFields.length > 0) {
		return {
			type: 'note' as const,
			content: `Updated lead fields: ${changedFields.join(', ')}`,
			createdAt: new Date(),
		}
	}

	return null
}

// GET /api/leads
router.get('/', async (req, res) => {
	try {
		const dbUser = await User.findOne({ firebaseUid: req.user!.uid })
		if (!dbUser) return res.status(404).json({ error: 'User not found' })

		const { status, source, page = '1', limit = '20' } = req.query
		const filter: Record<string, unknown> = { agentId: dbUser._id }
		if (status) filter.status = status
		if (source) filter.source = source

		const leads = await Lead.find(filter)
			.sort({ createdAt: -1 })
			.skip((+page - 1) * +limit)
			.limit(+limit)
			.lean()

		const total = await Lead.countDocuments(filter)
		return res.json({ leads, total, page: +page })
	} catch (err) {
		return res.status(500).json({ error: 'Internal server error' })
	}
})

// POST /api/leads
router.post('/', async (req, res) => {
	try {
		const parsed = createLeadSchema.safeParse(req.body)
		if (!parsed.success)
			return res.status(400).json({ error: parsed.error.flatten() })

		const dbUser = await User.findOne({ firebaseUid: req.user!.uid })
		if (!dbUser) return res.status(404).json({ error: 'User not found' })

		if (dbUser.plan === 'starter') {
			const count = await Lead.countDocuments({ agentId: dbUser._id })
			if (count >= 100) {
				return res
					.status(403)
					.json({ error: 'Lead limit reached. Upgrade to Pro.', upgrade: true })
			}
		}

		const lead = await Lead.create({
			...parsed.data,
			agentId: dbUser._id,
			portalToken: nanoid(),
		})

		await triggerN8nWebhook('new-lead-created', lead)

		return res.status(201).json({ lead })
	} catch (err) {
		return res.status(500).json({ error: 'Internal server error' })
	}
})

// POST /api/leads/bulk/email
router.post('/bulk/email', async (req, res) => {
	try {
		const { leadIds, subject, html } = req.body
		const dbUser = await User.findOne({ firebaseUid: req.user!.uid })
		if (!dbUser) return res.status(404).json({ error: 'User not found' })

		const leads = await Lead.find({
			_id: { $in: leadIds },
			agentId: dbUser._id,
		}).lean()
		const emails = leads.map((l) => l.email).filter(Boolean) as string[]

		await sendEmail({ to: emails, subject, html })
		return res.json({ ok: true, sent: emails.length })
	} catch (err) {
		return res.status(500).json({ error: 'Internal server error' })
	}
})

// POST /api/leads/bulk/sms
router.post('/bulk/sms', async (req, res) => {
	try {
		const { leadIds, message } = req.body
		const dbUser = await User.findOne({ firebaseUid: req.user!.uid })
		if (!dbUser) return res.status(404).json({ error: 'User not found' })

		const leads = await Lead.find({
			_id: { $in: leadIds },
			agentId: dbUser._id,
		}).lean()
		const phones = leads.map((l) => l.phone).filter(Boolean) as string[]

		await Promise.all(phones.map((phone) => sendSMS(phone, message)))
		return res.json({ ok: true, sent: phones.length })
	} catch (err) {
		return res.status(500).json({ error: 'Internal server error' })
	}
})

// PATCH /api/leads/bulk
router.patch('/bulk', async (req, res) => {
	try {
		const { leadIds, status } = req.body
		const dbUser = await User.findOne({ firebaseUid: req.user!.uid })
		if (!dbUser) return res.status(404).json({ error: 'User not found' })

		await Lead.updateMany(
			{ _id: { $in: leadIds }, agentId: dbUser._id },
			{
				$set: { status, updatedAt: new Date() },
				$push: {
					activities: {
						type: 'status-change',
						content: `Status changed to ${status} via bulk update`,
						createdAt: new Date(),
					},
				},
			},
		)
		return res.json({ ok: true })
	} catch (err) {
		return res.status(500).json({ error: 'Internal server error' })
	}
})

// GET /api/leads/:id
router.get('/:id', async (req, res) => {
	try {
		const dbUser = await User.findOne({ firebaseUid: req.user!.uid })
		if (!dbUser) return res.status(404).json({ error: 'User not found' })

		const lead = await Lead.findOne({ _id: req.params.id, agentId: dbUser._id })
			.populate('assignedListingId')
			.lean()
		if (!lead) return res.status(404).json({ error: 'Lead not found' })
		return res.json({ lead })
	} catch (err) {
		return res.status(500).json({ error: 'Internal server error' })
	}
})

// PATCH /api/leads/:id
router.patch('/:id', async (req, res) => {
	try {
		const dbUser = await User.findOne({ firebaseUid: req.user!.uid })
		if (!dbUser) return res.status(404).json({ error: 'User not found' })

		const currentLead = await Lead.findOne({
			_id: req.params.id,
			agentId: dbUser._id,
		})
		if (!currentLead) return res.status(404).json({ error: 'Lead not found' })

		const updateData = { ...req.body, updatedAt: new Date() }
		const activity = buildLeadUpdateActivity(currentLead.status, updateData)

		const lead = await Lead.findOneAndUpdate(
			{ _id: req.params.id, agentId: dbUser._id },
			activity
				? {
						$set: updateData,
						$push: { activities: activity },
					}
				: { $set: updateData },
			{ new: true },
		)
		return res.json({ lead })
	} catch (err) {
		return res.status(500).json({ error: 'Internal server error' })
	}
})

// DELETE /api/leads/:id
router.delete('/:id', async (req, res) => {
	try {
		const dbUser = await User.findOne({ firebaseUid: req.user!.uid })
		if (!dbUser) return res.status(404).json({ error: 'User not found' })

		await Lead.findOneAndDelete({ _id: req.params.id, agentId: dbUser._id })
		return res.json({ ok: true })
	} catch (err) {
		return res.status(500).json({ error: 'Internal server error' })
	}
})

// POST /api/leads/:id/activity
router.post('/:id/activity', async (req, res) => {
	try {
		const { type, content } = req.body
		const dbUser = await User.findOne({ firebaseUid: req.user!.uid })
		if (!dbUser) return res.status(404).json({ error: 'User not found' })

		const lead = await Lead.findOneAndUpdate(
			{ _id: req.params.id, agentId: dbUser._id },
			{
				$push: { activities: { type, content, createdAt: new Date() } },
				lastContactedAt: new Date(),
				updatedAt: new Date(),
			},
			{ new: true },
		)

		if (!lead) return res.status(404).json({ error: 'Lead not found' })
		return res.json({ lead })
	} catch (err) {
		return res.status(500).json({ error: 'Internal server error' })
	}
})

// GET /api/leads/:id/suggest
router.get('/:id/suggest', async (req, res) => {
	try {
		const dbUser = await User.findOne({ firebaseUid: req.user!.uid })
		if (!dbUser) return res.status(404).json({ error: 'User not found' })

		const lead = await Lead.findOne({
			_id: req.params.id,
			agentId: dbUser._id,
		}).lean()
		if (!lead) return res.status(404).json({ error: 'Lead not found' })

		const prompt = `You are a real estate sales coach. Based on this lead's history,
suggest the single best next action for the agent to take today.
Be specific (e.g., "Send a WhatsApp message asking if they're free for a viewing this weekend").
Keep it under 50 words.

Lead status: ${lead.status}
Last contacted: ${lead.lastContactedAt}
Activity history: ${lead.activities.map((a) => `${a.type}: ${a.content}`).join(' | ')}
Property interest: ${lead.propertyType}, budget $${lead.budget}, areas: ${lead.preferredAreas?.join(', ')}`

		const { result } = await generateGeminiContent(prompt)
		const suggestion = result.response.text()

		return res.json({ suggestion })
	} catch (err) {
		return res.status(500).json({ error: 'Internal server error' })
	}
})

export default router
