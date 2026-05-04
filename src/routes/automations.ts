import { Router } from 'express'
import { triggerN8nWebhook } from '../lib/n8n'
import { canEnableWorkflow, SEEDED_WORKFLOWS } from '../lib/paddle-plans'
import { verifyFirebaseToken } from '../middleware/auth'
import { rateLimiter } from '../middleware/rateLimit'
import Automation from '../models/Automation'
import Lead from '../models/Lead'
import User from '../models/User'

const router = Router()

// n8n callback — verified by shared secret, no Firebase auth
router.post('/n8n-callback', async (req, res) => {
	try {
		const secret = req.headers['x-webhook-secret']
		if (secret !== process.env.N8N_WEBHOOK_SECRET) {
			return res.status(401).json({ error: 'Unauthorized' })
		}

		const { event, leadId, automationId, result } = req.body

		if (leadId) {
			await Lead.findByIdAndUpdate(leadId, {
				$push: {
					activities: {
						type: event,
						content: result?.message,
						createdAt: new Date(),
					},
				},
				lastContactedAt: new Date(),
			})
		}

		if (automationId) {
			await Automation.findByIdAndUpdate(automationId, {
				$inc: { runCount: 1 },
				lastRunAt: new Date(),
			})
		}

		return res.json({ ok: true })
	} catch {
		return res.status(500).json({ error: 'Internal server error' })
	}
})

router.use(verifyFirebaseToken)
router.use(rateLimiter)

// GET /api/automations
// Returns the user's 4 seeded automations enriched with plan-access metadata.
router.get('/', async (req, res) => {
	try {
		const dbUser = await User.findOne({ firebaseUid: req.user!.uid })
		if (!dbUser) return res.status(404).json({ error: 'User not found' })

		const automations = await Automation.find({ isSeeded: true }).lean()

		const enriched = automations.map((a) => ({
			...a,
			isLocked: !canEnableWorkflow(dbUser.plan, a.workflowKey),
			isActive:
				Array.isArray(dbUser.n8nWorkflowsEnabled) &&
				dbUser.n8nWorkflowsEnabled.includes(a.workflowKey),
		}))

		return res.json({ automations: enriched })
	} catch {
		return res.status(500).json({ error: 'Internal server error' })
	}
})

// PATCH /api/automations/:id
// Only allows toggling isActive. Checks plan permission for the workflow.
router.patch('/:id', async (req, res) => {
	try {
		const dbUser = await User.findOne({ firebaseUid: req.user!.uid })
		if (!dbUser) return res.status(404).json({ error: 'User not found' })

		const automation = await Automation.findOne({
			_id: req.params.id,
			isSeeded: true,
		})
		if (!automation)
			return res.status(404).json({ error: 'Automation not found' })

		// Only isActive can be toggled — all other fields are system-managed
		const { isActive } = req.body
		if (typeof isActive !== 'boolean') {
			return res.status(400).json({ error: 'Only isActive can be updated' })
		}

		// Plan gate: check if this workflow is unlocked for the user's plan
		if (isActive && !canEnableWorkflow(dbUser.plan, automation.workflowKey)) {
			const wf = SEEDED_WORKFLOWS.find(
				(w) => w.workflowKey === automation.workflowKey,
			)
			return res.status(403).json({
				error: `This workflow requires the ${wf?.requiredPlan ?? 'higher'} plan or above.`,
				requiredPlan: wf?.requiredPlan,
				upgrade: true,
			})
		}

		// Toggle the user's enabled workflows list
		dbUser.n8nWorkflowsEnabled = dbUser.n8nWorkflowsEnabled || []
		if (isActive) {
			if (!dbUser.n8nWorkflowsEnabled.includes(automation.workflowKey)) {
				dbUser.n8nWorkflowsEnabled.push(automation.workflowKey)
			}
		} else {
			dbUser.n8nWorkflowsEnabled = dbUser.n8nWorkflowsEnabled.filter(
				(k) => k !== automation.workflowKey,
			)
		}
		await dbUser.save()

		return res.json({
			automation: { ...automation.toObject(), isActive },
			n8nWorkflowsEnabled: dbUser.n8nWorkflowsEnabled,
		})
	} catch {
		return res.status(500).json({ error: 'Internal server error' })
	}
})

// POST /api/automations/:id/run — manual trigger for seeded automations
router.post('/:id/run', async (req, res) => {
	try {
		const dbUser = await User.findOne({ firebaseUid: req.user!.uid })
		if (!dbUser) return res.status(404).json({ error: 'User not found' })

		const automation = await Automation.findOne({
			_id: req.params.id,
			isSeeded: true,
		})
		if (!automation)
			return res.status(404).json({ error: 'Automation not found' })

		// Check plan and whether user has enabled the workflow
		if (!canEnableWorkflow(dbUser.plan, automation.workflowKey)) {
			return res
				.status(403)
				.json({
					error: 'Your plan does not include this workflow.',
					upgrade: true,
				})
		}
		if (
			!Array.isArray(dbUser.n8nWorkflowsEnabled) ||
			!dbUser.n8nWorkflowsEnabled.includes(automation.workflowKey)
		) {
			return res
				.status(403)
				.json({ error: 'This workflow is not enabled for your account.' })
		}

		await triggerN8nWebhook(`workflow-${automation.n8nWorkflowId}`, {
			automationId: automation._id,
			// agentId is the user triggering the run
			agentId: dbUser._id,
			manual: true,
			...req.body,
		})

		return res.json({ ok: true })
	} catch {
		return res.status(500).json({ error: 'Internal server error' })
	}
})

export default router
