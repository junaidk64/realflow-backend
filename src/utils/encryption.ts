import CryptoJS from 'crypto-js'
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto'
import { config } from '../config'

// Derive a 32-byte key from the config string using SHA-256
const KEY = createHash('sha256').update(config.encryption.key).digest()

const V2_PREFIX = 'v2:'

// AES-256-GCM encrypt — new format, prefixed with "v2:"
export const encrypt = (text: string): string => {
  if (!text) return ''
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', KEY, iv)
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  const payload = Buffer.concat([iv, tag, encrypted]).toString('base64')
  return `${V2_PREFIX}${payload}`
}

// Decrypt — detects format by prefix
export const decrypt = (encryptedText: string): string => {
  if (!encryptedText) return ''

  if (encryptedText.startsWith(V2_PREFIX)) {
    // New AES-256-GCM format
    const buf = Buffer.from(encryptedText.slice(V2_PREFIX.length), 'base64')
    const iv = buf.subarray(0, 12)
    const tag = buf.subarray(12, 28)
    const data = buf.subarray(28)
    const decipher = createDecipheriv('aes-256-gcm', KEY, iv)
    decipher.setAuthTag(tag)
    return decipher.update(data).toString('utf8') + decipher.final('utf8')
  }

  // Legacy CryptoJS format — keep working for existing DB values
  try {
    const bytes = CryptoJS.AES.decrypt(encryptedText, config.encryption.key)
    const decrypted = bytes.toString(CryptoJS.enc.Utf8)
    if (!decrypted) throw new Error('Empty result')
    return decrypted
  } catch {
    throw new Error('Decryption failed')
  }
}

export const hashValue = (value: string): string =>
  createHash('sha256').update(value).digest('hex')

export const generateSecureToken = (length = 32): string =>
  randomBytes(length).toString('hex')

export default { encrypt, decrypt, hashValue, generateSecureToken }
