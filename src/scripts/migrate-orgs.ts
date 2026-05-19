/**
 * One-time migration: assign role:'root' and create an Organization for all
 * existing users that don't yet have an organizationId.
 *
 * Run with:
 *   npx ts-node -r dotenv/config src/scripts/migrate-orgs.ts
 */
import dotenv from 'dotenv'
dotenv.config()

import mongoose from 'mongoose'
import { config } from '../config'
import { Organization } from '../models/Organization'
import { User } from '../models/User'

async function run() {
	await mongoose.connect(config.mongoUri)
	console.log('Connected to MongoDB')

	const users = await User.find({ organizationId: null })
	console.log(`Found ${users.length} user(s) without an organization`)

	for (const user of users) {
		const org = await Organization.create({
			name: 'My Business',
			ownerId: user._id,
		})
		await User.findByIdAndUpdate(user._id, {
			organizationId: org._id,
			role: 'root',
		})
		console.log(`  Migrated user ${user.email} → org ${org._id}`)
	}

	console.log('Migration complete')
	await mongoose.disconnect()
}

run().catch((err) => {
	console.error(err)
	process.exit(1)
})
