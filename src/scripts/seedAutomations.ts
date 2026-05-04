/**
 * One-time script: seeds the 4 platform workflows for every existing user
 * that doesn't already have them.
 *
 * Run with:
 *   npx ts-node src/scripts/seedAutomations.ts
 */

import 'dotenv/config'
import mongoose from 'mongoose'
import { seedGlobalWorkflows } from '../routes/auth'

async function main() {
	await mongoose.connect(process.env.MONGODB_URI!)
	console.log('Connected to MongoDB')

	console.log('Seeding global platform workflows…')
	await seedGlobalWorkflows()
	console.log('Done. Seeded global workflows.')
	await mongoose.disconnect()
}

main().catch((err) => {
	console.error(err)
	process.exit(1)
})
