import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'crypto'

function getKey(): Buffer {
	const key = process.env.ENCRYPTION_KEY
	if (!key) throw new Error('ENCRYPTION_KEY env var is not set')
	return Buffer.from(key, 'hex')
}

export function encrypt(text: string): string {
	const key = getKey()
	const iv = randomBytes(12)
	const cipher = createCipheriv('aes-256-gcm', key, iv)
	const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
	const tag = cipher.getAuthTag()
	return Buffer.concat([iv, tag, encrypted]).toString('base64')
}

export function decrypt(data: string): string {
	const key = getKey()
	const buf = Buffer.from(data, 'base64')
	const iv = buf.subarray(0, 12)
	const tag = buf.subarray(12, 28)
	const encrypted = buf.subarray(28)
	const decipher = createDecipheriv('aes-256-gcm', key, iv)
	decipher.setAuthTag(tag)
	return decipher.update(encrypted).toString('utf8') + decipher.final('utf8')
}

// Signs a uid into a URL-safe state token for OAuth flows (5-min TTL)
export function signState(uid: string): string {
	const key = getKey()
	const payload = `${uid}:${Date.now()}`
	const sig = createHmac('sha256', key).update(payload).digest('hex')
	return Buffer.from(`${payload}.${sig}`).toString('base64url')
}

// Returns the uid if the state is valid and unexpired, otherwise null
export function verifyState(state: string): string | null {
	try {
		const key = getKey()
		const decoded = Buffer.from(state, 'base64url').toString()
		const lastDot = decoded.lastIndexOf('.')
		const payload = decoded.slice(0, lastDot)
		const sig = decoded.slice(lastDot + 1)
		const expected = createHmac('sha256', key).update(payload).digest('hex')
		if (sig !== expected) return null
		const colonIdx = payload.indexOf(':')
		const uid = payload.slice(0, colonIdx)
		const ts = parseInt(payload.slice(colonIdx + 1), 10)
		if (Date.now() - ts > 5 * 60 * 1000) return null
		return uid
	} catch {
		return null
	}
}
