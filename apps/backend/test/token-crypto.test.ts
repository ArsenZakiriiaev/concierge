import { describe, expect, it } from 'vitest'
import { decryptToken, encryptToken } from '../src/token-crypto.js'

describe('delegated token encryption', () => {
  it('round-trips with the configured key and fails with the wrong key', () => {
    process.env.CONCIERGE_TOKEN_KEY = '0123456789abcdef0123456789abcdef'
    const encrypted = encryptToken('railway-token')

    expect(encrypted.toString('utf8')).not.toContain('railway-token')
    expect(decryptToken(encrypted)).toBe('railway-token')

    process.env.CONCIERGE_TOKEN_KEY = 'abcdef0123456789abcdef0123456789'
    expect(() => decryptToken(encrypted)).toThrow()
  })
})
