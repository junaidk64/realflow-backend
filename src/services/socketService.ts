import { Server as HttpServer } from 'http'
import { Server as IOServer, Socket } from 'socket.io'
import { config } from '../config'
import logger from '../utils/logger'

let io: IOServer | null = null

// ─── Initialise ───────────────────────────────────────────────────────────────

export const initSocket = (httpServer: HttpServer): IOServer => {
	io = new IOServer(httpServer, {
		cors: {
			origin: [
				config.frontendUrl,
				'http://localhost:3000',
				'http://localhost:3001',
				'https://realflow-frontend-zeta.vercel.app',
			],
			credentials: true,
		},
		transports: ['websocket', 'polling'],
	})

	io.on('connection', (socket: Socket) => {
		logger.debug(`Socket connected: ${socket.id}`)

		// Client must join their own room immediately after connecting:
		// socket.emit('join', { userId, organizationId })
		socket.on('join', ({ userId, organizationId }: { userId?: string; organizationId?: string }) => {
			if (userId) {
				socket.join(`user:${userId}`)
				logger.debug(`Socket ${socket.id} joined user:${userId}`)
			}
			if (organizationId) {
				socket.join(`org:${organizationId}`)
				logger.debug(`Socket ${socket.id} joined org:${organizationId}`)
			}
		})

		socket.on('disconnect', () => {
			logger.debug(`Socket disconnected: ${socket.id}`)
		})
	})

	logger.info('Socket.IO initialised')
	return io
}

export const getIO = (): IOServer => {
	if (!io) throw new Error('Socket.IO not initialised — call initSocket first')
	return io
}

// ─── Emit helpers ─────────────────────────────────────────────────────────────

export const emitToUser = (userId: string, event: string, data: unknown): void => {
	try {
		getIO().to(`user:${userId}`).emit(event, data)
	} catch {
		// Socket.IO not yet initialised (e.g. during tests) — silently skip
	}
}

export const emitToOrg = (orgId: string, event: string, data: unknown): void => {
	try {
		getIO().to(`org:${orgId}`).emit(event, data)
	} catch {
		// Socket.IO not yet initialised — silently skip
	}
}

export default { initSocket, getIO, emitToUser, emitToOrg }
