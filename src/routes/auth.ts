import { Router } from 'express'
import { SEEDED_WORKFLOWS } from '../lib/paddle-plans'
import { verifyFirebaseToken } from '../middleware/auth'
import Automation from '../models/Automation'
import User from '../models/User'

const router = Router()

async function ensureMongoUserFromFirebase(req: import('express').Request) {
	const { uid, email, name, picture } = req.user!
	const existing = await User.findOne({ firebaseUid: uid })
	if (existing) return existing

	const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)

	return User.create({
		firebaseUid: uid,
		email,
		name: name || req.body?.name,
		image: picture,
		plan: 'trial',
		trialEndsAt,
	})
}

// POST /api/auth/register
router.post('/register', verifyFirebaseToken, async (req, res) => {
	try {
		const user = await ensureMongoUserFromFirebase(req)

		// Global seeded automations are created separately. New users see all
		// platform automations and enable the ones their plan allows.

		return res.status(201).json({ user })
	} catch (err) {
		return res.status(500).json({ error: 'Internal server error' })
	}
})

// GET /api/auth/me
router.get('/me', verifyFirebaseToken, async (req, res) => {
	try {
		const userDoc = await ensureMongoUserFromFirebase(req)
		const user = userDoc.toObject ? userDoc.toObject() : userDoc

		const trialDaysRemaining = user.trialEndsAt
			? Math.max(
					0,
					Math.ceil((user.trialEndsAt.getTime() - Date.now()) / 86400000),
				)
			: 0

		return res.json({ user: { ...user, trialDaysRemaining } })
	} catch (err) {
		return res.status(500).json({ error: 'Internal server error' })
	}
})

export async function seedWorkflowsForUser(
	agentId: import('mongoose').Types.ObjectId,
) {
	// Deprecated: per-user automations are no longer created. Keep function
	// for compatibility but make it a no-op.
	return
}

// Ensure the global seeded automations exist. This should be run once (or
// at deploy) to create the platform workflows in the Automation collection.
export async function seedGlobalWorkflows() {
	const ops = SEEDED_WORKFLOWS.map((wf) => ({
		updateOne: {
			filter: { workflowKey: wf.workflowKey },
			update: {
				$setOnInsert: {
					workflowKey: wf.workflowKey,
					n8nWorkflowId: wf.n8nWorkflowId,
					name: wf.name,
					description: wf.description,
					trigger: wf.trigger,
					requiredPlan: wf.requiredPlan,
					isSeeded: true,
					isActive: false,
					runCount: 0,
					createdAt: new Date(),
				},
			},
			upsert: true,
		},
	}))
	await Automation.bulkWrite(ops)
}

export default router
