import fs from 'fs'
import path from 'path'
import winston from 'winston'

const logDir = 'logs'
if (!fs.existsSync(logDir)) {
	fs.mkdirSync(logDir, { recursive: true })
}

const logFormat = winston.format.combine(
	winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
	winston.format.errors({ stack: true }),
	winston.format.splat(),
	winston.format.json(),
)

const safeStringify = (obj: unknown): string => {
	const seen = new Set<unknown>()
	return JSON.stringify(obj, (_key, value) => {
		if (typeof value === 'object' && value !== null) {
			if (seen.has(value)) return '[Circular]'
			seen.add(value)
		}
		return value
	})
}

const consoleFormat = winston.format.combine(
	winston.format.colorize(),
	winston.format.timestamp({ format: 'HH:mm:ss' }),
	winston.format.printf(({ timestamp, level, message, ...meta }) => {
		const metaStr = Object.keys(meta).length ? ` ${safeStringify(meta)}` : ''
		return `[${timestamp}] ${level}: ${message}${metaStr}`
	}),
)

const logger = winston.createLogger({
	level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
	format: logFormat,
	defaultMeta: { service: 'email-auto-backend' },
	transports: [
		new winston.transports.File({
			filename: path.join(logDir, 'error.log'),
			level: 'error',
			maxsize: 5242880, // 5MB
			maxFiles: 5,
		}),
		new winston.transports.File({
			filename: path.join(logDir, 'combined.log'),
			maxsize: 10485760, // 10MB
			maxFiles: 10,
		}),
	],
})

if (process.env.NODE_ENV !== 'production') {
	logger.add(
		new winston.transports.Console({
			format: consoleFormat,
		}),
	)
} else {
	logger.add(
		new winston.transports.Console({
			format: winston.format.combine(
				winston.format.timestamp(),
				winston.format.json(),
			),
		}),
	)
}

export default logger
