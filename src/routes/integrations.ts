import { Router } from 'express'
import { z } from 'zod'
import { adminAuth } from '../lib/firebase-admin'
import { verifyFirebaseToken } from '../middleware/auth'
import { rateLimiter } from '../middleware/rateLimit'
import Integration from '../models/Integration'
import User from '../models/User'
import { encrypt, signState, verifyState } from '../lib/crypto'

const router = Router()

// ─── Static catalogue ────────────────────────────────────────────────────────

const CATALOGUE = [
	{ id: 'google-calendar', name: 'Google Calendar', category: 'Calendar', authMethod: 'oauth' },
	{ id: 'zillow', name: 'Zillow', category: 'Lead Source', authMethod: 'apiKey' },
	{ id: 'whatsapp', name: 'WhatsApp Business', category: 'Messaging', authMethod: 'apiKey' },
	{ id: 'docusign', name: 'DocuSign', category: 'Documents', authMethod: 'apiKey' },
	{ id: 'mailchimp', name: 'Mailchimp', category: 'Email', authMethod: 'apiKey' },
	{ id: 'zapier', name: 'Zapier', category: 'Automation', authMethod: 'apiKey' },
]

type ApiKeyId = 'zillow' | 'whatsapp' | 'docusign' | 'mailchimp' | 'zapier'
const API_KEY_IDS = new Set<string>(['zillow', 'whatsapp', 'docusign', 'mailchimp', 'zapier'])
const ALL_IDS = new Set<string>([...API_KEY_IDS, 'google-calendar'])

const connectSchemas: Record<ApiKeyId, z.ZodTypeAny> = {
	zillow: z.object({ apiKey: z.string().min(1) }),
	whatsapp: z.object({
		phoneNumberId: z.string().min(1),
		accessToken: z.string().min(1),
		webhookVerifyToken: z.string().min(1),
	}),
	docusign: z.object({
		accountId: z.string().min(1),
		integrationKey: z.string().min(1),
		secretKey: z.string().min(1),
	}),
	mailchimp: z.object({ apiKey: z.string().min(1) }),
	zapier: z.object({ webhookUrl: z.string().url() }),
}

// ─── Google OAuth routes (browser GET — no Authorization header) ─────────────

// GET /api/integrations/google-calendar/oauth/redirect?token=<firebase_token>
// The Next.js server route appends the user's Firebase token as a query param
// before redirecting the browser here.
router.get('/google-calendar/oauth/redirect', async (req, res) => {
	const token = req.query.token as string | undefined
	if (!token) {
		return res.redirect(
			`${process.env.FRONTEND_URL}/settings/integrations?error=Missing+token`
		)
	}

	try {
		const decoded = await adminAuth.verifyIdToken(token)
		const state = signState(decoded.uid)

		const params = new URLSearchParams({
			client_id: process.env.GOOGLE_CLIENT_ID!,
			redirect_uri: `${process.env.BACKEND_URL}/api/integrations/google-calendar/oauth/callback`,
			response_type: 'code',
			scope: 'https://www.googleapis.com/auth/calendar.events',
			access_type: 'offline',
			prompt: 'consent',
			state,
		})

		res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`)
	} catch {
		res.redirect(
			`${process.env.FRONTEND_URL}/settings/integrations?error=Invalid+or+expired+token`
		)
	}
})

// GET /api/integrations/google-calendar/oauth/callback
router.get('/google-calendar/oauth/callback', async (req, res) => {
	const { code, state, error } = req.query as Record<string, string>
	const base = `${process.env.FRONTEND_URL}/settings/integrations`

	if (error) return res.redirect(`${base}?error=${encodeURIComponent(error)}`)
	if (!code || !state) return res.redirect(`${base}?error=Missing+parameters`)

	const uid = verifyState(state)
	if (!uid) return res.redirect(`${base}?error=Invalid+or+expired+state`)

	try {
		const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				code,
				client_id: process.env.GOOGLE_CLIENT_ID!,
				client_secret: process.env.GOOGLE_CLIENT_SECRET!,
				redirect_uri: `${process.env.BACKEND_URL}/api/integrations/google-calendar/oauth/callback`,
				grant_type: 'authorization_code',
			}),
		})

		if (!tokenRes.ok) {
			const err = (await tokenRes.json()) as { error_description?: string }
			return res.redirect(
				`${base}?error=${encodeURIComponent(err.error_description ?? 'Token exchange failed')}`
			)
		}

		const tokens = (await tokenRes.json()) as {
			access_token: string
			refresh_token?: string
			expires_in?: number
		}

		const dbUser = await User.findOne({ firebaseUid: uid })
		if (!dbUser) return res.redirect(`${base}?error=User+not+found`)

		const config = {
			access_token: tokens.access_token,
			refresh_token: tokens.refresh_token ?? '',
			expiry_date: Date.now() + (tokens.expires_in ?? 3600) * 1000,
		}

		await Integration.findOneAndUpdate(
			{ agentId: dbUser._id, integrationId: 'google-calendar' },
			{
				$set: {
					status: 'connected',
					config: encrypt(JSON.stringify(config)),
					connectedAt: new Date(),
				},
			},
			{ upsert: true }
		)

		res.redirect(`${base}?connected=google-calendar`)
	} catch (e) {
		console.error('Google OAuth callback error:', e)
		res.redirect(`${base}?error=Internal+server+error`)
	}
})

// ─── Authenticated routes ─────────────────────────────────────────────────────

router.use(verifyFirebaseToken)
router.use(rateLimiter)

// GET /api/integrations
router.get('/', async (req, res) => {
	try {
		const dbUser = await User.findOne({ firebaseUid: req.user!.uid })
		if (!dbUser) return res.status(404).json({ error: 'User not found' })

		const docs = await Integration.find({ agentId: dbUser._id })
		const docMap = new Map(docs.map((d) => [d.integrationId, d]))

		const result = CATALOGUE.map((item) => {
			const doc = docMap.get(item.id)
			return {
				...item,
				status: doc?.status ?? 'disconnected',
				connectedAt: doc?.connectedAt ?? null,
			}
		})

		res.json(result)
	} catch (e) {
		console.error(e)
		res.status(500).json({ error: 'Internal server error' })
	}
})

// POST /api/integrations/:id/connect
router.post('/:id/connect', async (req, res) => {
	const { id } = req.params

	if (!API_KEY_IDS.has(id)) {
		return res.status(400).json({
			error: 'Invalid integration ID. Use the OAuth flow for Google Calendar.',
		})
	}

	const schema = connectSchemas[id as ApiKeyId]
	const parsed = schema.safeParse(req.body.config)
	if (!parsed.success) {
		return res.status(400).json({ error: parsed.error.errors[0].message })
	}

	try {
		const dbUser = await User.findOne({ firebaseUid: req.user!.uid })
		if (!dbUser) return res.status(404).json({ error: 'User not found' })

		const doc = await Integration.findOneAndUpdate(
			{ agentId: dbUser._id, integrationId: id },
			{
				$set: {
					status: 'connected',
					config: encrypt(JSON.stringify(parsed.data)),
					connectedAt: new Date(),
				},
			},
			{ upsert: true, new: true }
		)

		res.json({ id, status: doc!.status, connectedAt: doc!.connectedAt })
	} catch (e) {
		console.error(e)
		res.status(500).json({ error: 'Internal server error' })
	}
})

// DELETE /api/integrations/:id
router.delete('/:id', async (req, res) => {
	const { id } = req.params

	if (!ALL_IDS.has(id)) {
		return res.status(400).json({ error: 'Invalid integration ID' })
	}

	try {
		const dbUser = await User.findOne({ firebaseUid: req.user!.uid })
		if (!dbUser) return res.status(404).json({ error: 'User not found' })

		const doc = await Integration.findOneAndUpdate(
			{ agentId: dbUser._id, integrationId: id },
			{ $set: { status: 'disconnected', config: '' }, $unset: { connectedAt: '' } }
		)

		if (!doc) return res.status(404).json({ error: 'Integration not connected' })

		res.json({ id, status: 'disconnected' })
	} catch (e) {
		console.error(e)
		res.status(500).json({ error: 'Internal server error' })
	}
})

export default router
