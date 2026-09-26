import { execFileSync, spawnSync } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { toEntry } from '@fairgarden/policy/drizzle'
import { ROOT, useDatabase } from './helpers/database'

const membership = { membership: { status: 'active', since: '2026-01-01T00:00:00.000Z', roles: ['steward'] } }
const input = (subject: string, client = 'events') => ({
  user: { name: subject },
  client: { id: client, name: client },
  purpose: 'Release',
  claims: membership,
})

const applying = (subject: string, overrides: Record<string, unknown> = {}) => ({
  user: { name: subject },
  purpose: 'Join' as const,
  applicant: {
    email: `${subject}@example.com`,
    email_verified: true,
    name: null,
    residential_address: { country: 'US', region: 'MN', postal_code: '55401' },
  },
  ...overrides,
})

const load = async (env: Record<string, string> = {}) => {
  vi.resetModules()
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('FG_POLICY_') || key === 'FG_MEMBERS_POLICY_PACKAGE') delete process.env[key]
  }
  // Whatever a build left in .policy/, each test says which policy it means.
  Object.assign(process.env, env.FG_POLICY_BUNDLE || env.FG_POLICY_OPA_URL ? {} : { FG_POLICY_BUNDLE: 'none' }, env)
  return import('@fairgarden/members/lib/policy')
}

const recorded = async (subject: string) => {
  const { db } = await import('@fairgarden/members/lib/db')
  const { policyDecisions } = await import('@fairgarden/members/lib/schema')
  return (await (await db()).select().from(policyDecisions).where(eq(policyDecisions.subject, subject))).map(toEntry)
}

describe("the members service's own policy", () => {
  useDatabase()
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('releases everything by default, and records what left without what was on offer', async () => {
    expect(await (await load()).decideRelease(input('m1'))).toEqual({ claims: membership, reasons: {} })
    const [entry] = await recorded('m1')
    expect(entry).toMatchObject({
      path: 'fairgarden/members/release',
      input: { user: { name: 'm1' }, client: { id: 'events' }, purpose: 'Release' },
      result: { claims: membership },
      erased: ['/input/claims'],
      labels: { service: 'members', engine: 'builtin' },
    })
    expect(entry.input).not.toHaveProperty('claims')
  })

  it('can keep claims from a service, and say why', async () => {
    const server = http.createServer(async (req, res) => {
      let body = ''
      for await (const chunk of req) body += chunk
      const { input: asked } = JSON.parse(body)
      res.setHeader('content-type', 'application/json')
      res.end(
        JSON.stringify({
          result:
            asked.client.id === 'events'
              ? { claims: asked.claims, reasons: {} }
              : { claims: {}, reasons: { membership: 'Only Events can see your membership.' } },
        })
      )
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const policy = await load({ FG_POLICY_OPA_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}` })
    expect(await policy.decideRelease(input('m2', 'events'))).toEqual({ claims: membership, reasons: {} })
    expect(await policy.decideRelease(input('m2', 'gallery'))).toEqual({
      claims: {},
      reasons: { membership: 'Only Events can see your membership.' },
    })
    expect((await recorded('m2')).map((entry) => entry.labels.engine)).toEqual(['server', 'server'])
    server.close()
  })

  it('releases nothing when the policy cannot be evaluated, and records that', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const policy = await load({ FG_POLICY_BUNDLE: '/nowhere/policies.tar.gz', FG_POLICY_ALLOW_UNSIGNED: 'true' })
    const { claims, reasons } = await policy.decideRelease(input('m3'))
    expect(claims).toEqual({})
    expect(reasons.membership).toBeTruthy()
    const [entry] = await recorded('m3')
    expect(entry.error).toBeTruthy()

    // Nobody joins, and signing in asks only for what membership needs.
    expect(await policy.decideAdmission(applying('m3'))).toEqual({
      allowed: false,
      status: 'active',
      reasons: { policy: 'Joining is unavailable right now. Try again later.' },
    })
    expect(await policy.requestedScopes()).toEqual(['openid', 'email', 'profile'])
  })

  it('lets anyone join by default, straight away, and asks only for what membership needs', async () => {
    const policy = await load()
    expect(await policy.decideAdmission(applying('m5'))).toEqual({ allowed: true, status: 'active', reasons: {} })
    expect(await policy.requestedScopes()).toEqual(['openid', 'email', 'profile'])
    // Who they are, beyond their sub, and where they live are not kept in the record.
    const [entry] = await recorded('m5')
    expect(entry).toMatchObject({
      path: 'fairgarden/members/admit',
      erased: ['/input/applicant/email', '/input/applicant/name', '/input/applicant/residential_address'],
    })
    expect((entry.input as { applicant: object }).applicant).toEqual({ email_verified: true })
  })

  // members' Rego, built into a signed bundle with an organization's layer on
  // top, and run the way a deployment runs it. Needs the opa CLI to build.
  const opa = process.env.OPA ?? 'opa'
  const hasOpa = spawnSync(opa, ['version']).status === 0

  describe.skipIf(!hasOpa)("from the organization's bundle", () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const organizationKey = publicKey.export({ type: 'spki', format: 'pem' }).toString()

    /** members' rules, with an organization's on top: examples/admission, or just a .manifest. */
    const build = ({ bylaws = false } = {}) => {
      const root = mkdtempSync(path.join(tmpdir(), 'policy-'))
      cpSync(path.join(ROOT, 'policies'), path.join(root, 'apps/members/policies'), { recursive: true })
      if (bylaws) cpSync(path.join(ROOT, 'examples/admission'), path.join(root, 'policies'), { recursive: true })
      else {
        mkdirSync(path.join(root, 'policies'))
        writeFileSync(path.join(root, 'policies/.manifest'), '{"metadata":{"organization":"Test Club"}}')
      }
      writeFileSync(path.join(root, 'key.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }))
      execFileSync(
        path.join(ROOT, 'node_modules', '.bin', 'fg-policy'),
        ['build', '--base', 'apps/*/policies', '--signing-key', 'key.pem'],
        { cwd: root, env: { ...process.env, OPA: opa }, stdio: 'ignore' }
      )
      return { FG_POLICY_BUNDLE: path.join(root, 'policies.tar.gz'), FG_POLICY_PUBLIC_KEY: organizationKey }
    }

    it('releases everything and lets anyone join, as members ships it', async () => {
      const policy = await load(build())
      expect(await policy.decideRelease(input('m4'))).toEqual({ claims: membership, reasons: {} })
      expect(await policy.decideAdmission(applying('m4'))).toEqual({ allowed: true, status: 'active', reasons: {} })
      expect(await policy.requestedScopes()).toEqual(['openid', 'email', 'profile'])
    })

    it("follows an organization's bylaws on who may join", async () => {
      const policy = await load(build({ bylaws: true }))
      // The address is asked for, because who may join depends on it.
      expect(await policy.requestedScopes()).toEqual(['openid', 'email', 'profile', 'residential_address'])

      const referral = { referral: { by: { name: 'old', status: 'active', roles: [], since: '2025-01-01T00:00:00Z' } } }
      expect(await policy.decideAdmission(applying('m6', referral))).toEqual({
        allowed: true,
        status: 'probationary',
        reasons: {},
      })
      const nobody = await policy.decideAdmission(
        applying('m7', { applicant: { email: 'm7@example.com', email_verified: false, name: null } })
      )
      expect(nobody.allowed).toBe(false)
      expect(Object.keys(nobody.reasons).sort()).toEqual(['area', 'email', 'referral'])
      expect(nobody.reasons.area).toBe('Share where you live with Members, so we can check it is in Minneapolis.')
    })
  })
})
