import path from 'node:path'
import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { db } from '@fairgarden-private/members/lib/db'
import { migrate, rollback } from '@fairgarden-private/members/lib/migrator'
import {
  admitMember,
  createReferral,
  findMember,
  findReferral,
  membershipClaim,
  ReferralUnavailableError,
  referralsOf,
  refreshMember,
  updateProfile,
} from '@fairgarden-private/members/lib/members'
import { referrals } from '@fairgarden-private/members/lib/schema'
import { ROOT, useDatabase } from './helpers/database'

describe('members', () => {
  const database = useDatabase()

  it('are made by joining, not by signing in, and refreshed on sign-in after', async () => {
    expect(await refreshMember('sub-1', 'first@example.com', 'First Name')).toBeUndefined()
    expect(await findMember('sub-1')).toBeUndefined()

    const first = await admitMember({ sub: 'sub-1', email: 'first@example.com', name: 'First Name', status: 'probationary' })
    expect(first).toMatchObject({ status: 'probationary', roles: [], nickname: null, referredBy: null })
    // Joining again changes nothing.
    expect(await admitMember({ sub: 'sub-1', email: 'first@example.com', name: null, status: 'active' })).toEqual(first)

    const again = await refreshMember('sub-1', 'changed@example.com', null)
    expect(again).toMatchObject({ email: 'changed@example.com', name: null, joinedAt: first.joinedAt })
  })

  it('keep what they tell the community', async () => {
    await admitMember({ sub: 'sub-2', email: 'second@example.com', name: 'Second', status: 'active' })
    await updateProfile('sub-2', { nickname: 'Two', pronouns: null, bio: 'Hello' })
    expect(await findMember('sub-2')).toMatchObject({ nickname: 'Two', pronouns: null, bio: 'Hello' })
  })

  it('release their membership, and never their bio', async () => {
    const member = (await findMember('sub-2'))!
    expect(membershipClaim(member)).toEqual({
      status: 'active',
      since: member.joinedAt.toISOString(),
      roles: [],
      nickname: 'Two',
    })
  })

  it('refer others with links that work once', async () => {
    const referral = await createReferral('sub-2')
    expect(referral.id).toMatch(/^[\w-]{22}$/)
    expect(await findReferral(referral.id)).toMatchObject({ referral: { id: referral.id }, referrer: { sub: 'sub-2' } })

    const joined = await admitMember({ sub: 'sub-3', email: 'third@example.com', name: null, status: 'active', referral: referral.id })
    expect(joined.referredBy).toBe('sub-2')
    expect(await findReferral(referral.id)).toBeUndefined()
    expect((await referralsOf('sub-2'))[0]).toMatchObject({ usedBy: 'sub-3' })

    await expect(
      admitMember({ sub: 'sub-4', email: 'fourth@example.com', name: null, status: 'active', referral: referral.id })
    ).rejects.toThrow(ReferralUnavailableError)
    // Nobody joins on a used link.
    expect(await findMember('sub-4')).toBeUndefined()
  })

  it('refer only until a link expires', async () => {
    const referral = await createReferral('sub-2')
    await (await db()).update(referrals).set({ expiresAt: sql`now() - interval '1 minute'` })
    expect(await findReferral(referral.id)).toBeUndefined()
  })

  it('roll back to nothing and forward again', async () => {
    const migrations = path.join(ROOT, 'drizzle')
    expect(await rollback(database.pool, migrations, { to: '0' })).toEqual([
      '0003_policy_revisions',
      '0002_referrals',
      '0001_policy_decisions',
      '0000_init',
    ])
    expect(await migrate(database.pool, migrations)).toEqual([
      '0000_init',
      '0001_policy_decisions',
      '0002_referrals',
      '0003_policy_revisions',
    ])
  })
})
