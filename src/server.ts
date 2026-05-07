import cors from 'cors'
import dotenv from 'dotenv'
import 'dotenv/config'
import express from 'express'
import helmet from 'helmet'
import { connectDB } from './lib/db'

dotenv.config()

import analyticsRoutes from './routes/analytics'
import appointmentsRoutes from './routes/appointments'
import authRoutes from './routes/auth'
import automationsRoutes from './routes/automations'
import billingRoutes from './routes/billing'
import documentsRoutes from './routes/documents'
import geocodesRoutes from './routes/GeoCodes'
import integrationRoutes from './routes/integrations'
import leadsRoutes from './routes/leads'
import listingsRoutes from './routes/listings'
import portalRoutes from './routes/portal'
import uploadRoutes from './routes/upload'

const app = express()

app.use(helmet())
app.use(
	cors({
		origin: true,
		credentials: false,
		methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
		allowedHeaders: ['Content-Type', 'Authorization', 'x-webhook-secret'],
	}),
)
app.options('*', cors())
app.use(express.urlencoded({ extended: true })) // For parsing application/x-www-form-urlencoded
app.use(express.json()) // For parsing application/json

// Raw body needed for Paddle webhook signature verification
app.use('/api/billing/webhook', express.raw({ type: 'application/json' }))

// JSON body parser for all other routes
app.use(express.json())

// Routes
app.use('/api/auth', authRoutes)
app.use('/api/leads', leadsRoutes)
app.use('/api/listings', listingsRoutes)
app.use('/api/automations', automationsRoutes)
app.use('/api/appointments', appointmentsRoutes)
app.use('/api/documents', documentsRoutes)
app.use('/api/upload', uploadRoutes)
app.use('/api/billing', billingRoutes)
app.use('/api/analytics', analyticsRoutes)
app.use('/api/portal', portalRoutes)
app.use('/api/integrations', integrationRoutes)
app.use('/api/geocodes', geocodesRoutes)

app.get('/health', (_req, res) => res.json({ status: 'ok' }))

const PORT = process.env.PORT || 4000

connectDB().then(() => {
	app.listen(PORT, () => console.log(`API running on port ${PORT}`))
})
