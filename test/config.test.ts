import { createHash } from 'node:crypto'
import { EncryptJWT, jwtDecrypt } from 'jose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('getConfig', () => {
  const saved = { ...process.env }
  beforeEach(() => {
    vi.resetModules()
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('FG_') || key.startsWith('VERCEL') || key.startsWith('MONOLITH_')) delete process.env[key]
    }
  })
  afterEach(() => {
    process.env = { ...saved }
  })

  const load = async () => (await import('@fairgarden/members/lib/config')).getConfig()

  it('works out signing in with the id service mounted beside it', async () => {
    process.env.FG_ID_URL = 'https://example.com'
    process.env.FG_MEMBERS_URL = 'https://example.com'
    process.env.FG_MEMBERS_SECRET = 'session'
    process.env.MONOLITH_MOUNTS = JSON.stringify({ '@fairgarden/id': '/id', '@fairgarden/members': '/members' })
    // the one variable both apps read, newest first
    process.env.FG_ID_SERVICE_MEMBERS_SECRET = 'newest older'
    const config = await load()
    expect(config.issuer).toBe('https://example.com/id')
    expect(config.clientSecret).toBe('newest')
  })

  it('follows a Vercel deployment to its own domain, id and all', async () => {
    process.env.VERCEL_ENV = 'preview'
    process.env.VERCEL_URL = 'core-abc123.vercel.app'
    process.env.FG_MEMBERS_SECRET = 'session'
    process.env.MONOLITH_MOUNTS = JSON.stringify({ '@fairgarden/id': '/id', '@fairgarden/members': '/members' })
    const config = await load()
    expect(config.url).toBe('https://core-abc123.vercel.app/members')
    expect(config.issuer).toBe('https://core-abc123.vercel.app/id')
  })

  it('will not guess where the id service is when deployed without it', async () => {
    process.env.FG_MEMBERS_URL = 'https://members.example.com'
    process.env.FG_MEMBERS_SECRET = 'session'
    await expect(load()).rejects.toThrow(/Set FG_MEMBERS_ID_URL/)
  })

  it('reads its secrets from their slots once rotated, the shared one included', async () => {
    process.env.FG_MEMBERS_URL = 'https://example.com'
    process.env.MONOLITH_MOUNTS = JSON.stringify({ '@fairgarden/id': '/id', '@fairgarden/members': '/members' })
    process.env.FG_MEMBERS_SECRET_A = 'session-before'
    process.env.FG_MEMBERS_SECRET_B = 'session-now'
    process.env.FG_MEMBERS_SECRET_CURRENT = 'B'
    process.env.FG_ID_SERVICE_MEMBERS_SECRET_A = 'client-now'
    process.env.FG_ID_SERVICE_MEMBERS_SECRET_CURRENT = 'A'
    const config = await load()
    expect(config.sessionKeys).toHaveLength(2)
    expect(Buffer.from(config.sessionKeys[0])).toEqual(createHash('sha256').update('session-now').digest())
    expect(config.clientSecret).toBe('client-now')
  })

  it('seals sessions with the newest secret, and opens what an older one sealed', async () => {
    process.env.FG_MEMBERS_URL = 'https://members.example.com'
    process.env.FG_MEMBERS_ID_URL = 'https://id.example.com'
    process.env.FG_MEMBERS_SECRET = 'newest older'
    const { sessionKeys } = await load()
    expect(sessionKeys).toHaveLength(2)
    expect(Buffer.from(sessionKeys[0])).toEqual(createHash('sha256').update('newest').digest())

    // a cookie sealed before the rotation, with what is now the older key
    const before = await new EncryptJWT({ sub: 'someone' })
      .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
      .encrypt(sessionKeys[1])
    const opened = await Promise.any(sessionKeys.map((key) => jwtDecrypt(before, key)))
    expect(opened.payload.sub).toBe('someone')
  })
})
