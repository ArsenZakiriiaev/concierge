import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { requiredEnv } from './config.js'

const VERSION = 1
const IV_LENGTH = 12
const TAG_LENGTH = 16
const KEY_LENGTH = 32

export function encryptToken(token: string): Buffer {
  const key = tokenKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([Buffer.from([VERSION]), iv, tag, ciphertext])
}

export function decryptToken(packed: Buffer): string {
  if (packed.length < 1 + IV_LENGTH + TAG_LENGTH) {
    throw new Error('Invalid encrypted token payload')
  }

  const version = packed.readUInt8(0)
  if (version !== VERSION) throw new Error('Unsupported encrypted token version')

  const key = tokenKey()
  const iv = packed.subarray(1, 1 + IV_LENGTH)
  const tag = packed.subarray(1 + IV_LENGTH, 1 + IV_LENGTH + TAG_LENGTH)
  const ciphertext = packed.subarray(1 + IV_LENGTH + TAG_LENGTH)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

function tokenKey(): Buffer {
  const raw = requiredEnv('CONCIERGE_TOKEN_KEY')

  if (/^[a-f0-9]{64}$/i.test(raw)) {
    return Buffer.from(raw, 'hex')
  }

  const base64 = Buffer.from(raw, 'base64')
  if (base64.length === KEY_LENGTH) return base64

  const utf8 = Buffer.from(raw, 'utf8')
  if (utf8.length === KEY_LENGTH) return utf8

  throw new Error('CONCIERGE_TOKEN_KEY must decode to exactly 32 bytes')
}
