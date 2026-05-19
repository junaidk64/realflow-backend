/**
 * One-time migration: backfill organizationId on Lead, Template, Workflow, and Settings
 * documents created before multi-tenancy was introduced.
 *
 * Run with:
 *   npx ts-node -r dotenv/config src/scripts/migrate-org-scope.ts
 */
import dotenv from 'dotenv'
dotenv.config()

import mongoose from 'mongoose'
import { config } from '../config'
import { Lead } from '../models/Lead'
import { Settings } from '../models/Settings'
import { Template } from '../models/Template'
import { User } from '../models/User'
import { Workflow } from '../models/Workflow'

async function run() {
	await mongoose.connect(config.mongoUri)
	console.log('Connected to MongoDB')

	// Build a userId → organizationId lookup map
	const users = await User.find({ organizationId: { $ne: null } }).select('_id organizationId').lean()
	const orgMap = new Map<string, mongoose.Types.ObjectId>()
	for (const u of users) {
		orgMap.set(u._id.toString(), u.organizationId as mongoose.Types.ObjectId)
	}
	console.log(`Loaded ${orgMap.size} user→org mappings`)

	// Helper: process any collection in batches
	async function backfill(
		model: mongoose.Model<any>,
		label: string,
	): Promise<void> {
		const docs = await model.find({ organizationId: null }).select('_id userId').lean()
		console.log(`${label}: ${docs.length} doc(s) need backfill`)
		let updated = 0
		for (const doc of docs) {
			const orgId = orgMap.get(doc.userId?.toString())
			if (!orgId) continue
			await model.updateOne({ _id: doc._id }, { $set: { organizationId: orgId } })
			updated++
		}
		console.log(`  → Updated ${updated} doc(s)`)
	}

	await backfill(Lead, 'Lead')
	await backfill(Template, 'Template')
	await backfill(Workflow, 'Workflow')
	await backfill(Settings, 'Settings')

	console.log('Migration complete')
	await mongoose.disconnect()
}

run().catch((err) => {
	console.error(err)
	process.exit(1)
})
