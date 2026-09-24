import { randomBytes } from 'node:crypto'
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm'
import { db } from './db.ts'
import type { AdmittedStatus } from './policy.ts'
import { members, referrals } from './schema.ts'

export type Member = typeof members.$inferSelect
export type Referral = typeof referrals.$inferSelect

/**
 * On sign-in: refresh what the id service told us about a member. Signing in
 * does not make anyone one; joining does, when the policy admits them.
 */
export const refreshMember = async (sub: string, email: string, name: string | null): Promise<Member | undefined> => {
  const database = await db()
  const [member] = await database
    .update(members)
    .set({ email, name, updatedAt: sql`now()` })
    .where(eq(members.sub, sub))
    .returning()
  return member
}

export class ReferralUnavailableError extends Error {
  constructor() {
    super('That referral link has been used, or has expired.')
    this.name = 'ReferralUnavailableError'
  }
}

/** Someone joined while this was deciding: whatever made them a member stands. */
class AlreadyMember extends Error {}

/**
 * Make someone a member, as the policy admitted them, using up the referral
 * they joined with. Joining again — from a second tab, say — changes nothing,
 * and uses up no referral.
 */
export const admitMember = async (applicant: {
  sub: string
  email: string
  name: string | null
  status: AdmittedStatus
  referral?: string
}): Promise<Member> => {
  const database = await db()
  try {
    return await database.transaction(async (tx) => {
      let referredBy: string | null = null
      if (applicant.referral) {
        const [used] = await tx
          .update(referrals)
          .set({ usedBy: applicant.sub, usedAt: sql`now()` })
          .where(and(eq(referrals.id, applicant.referral), isNull(referrals.usedBy), gt(referrals.expiresAt, sql`now()`)))
          .returning()
        if (!used) throw new ReferralUnavailableError()
        referredBy = used.referrer
      }
      const [member] = await tx
        .insert(members)
        .values({ sub: applicant.sub, email: applicant.email, name: applicant.name, status: applicant.status, referredBy })
        .onConflictDoNothing()
        .returning()
      // Undoes claiming the referral.
      if (!member) throw new AlreadyMember()
      return member
    })
  } catch (error) {
    if (!(error instanceof AlreadyMember)) throw error
    return (await findMember(applicant.sub))!
  }
}

export const findMember = async (sub: string): Promise<Member | undefined> => {
  const database = await db()
  const [member] = await database.select().from(members).where(eq(members.sub, sub))
  return member
}

export interface ProfileUpdate {
  nickname: string | null
  pronouns: string | null
  bio: string | null
}

export const updateProfile = async (sub: string, update: ProfileUpdate): Promise<Member> => {
  const database = await db()
  const [member] = await database
    .update(members)
    .set({ ...update, updatedAt: sql`now()` })
    .where(eq(members.sub, sub))
    .returning()
  return member
}

/**
 * The `membership` claim, which the id service passes to other services a
 * member lets see it.
 */
export const membershipClaim = (member: Member) => ({
  status: member.status,
  since: member.joinedAt.toISOString(),
  roles: member.roles,
  ...(member.nickname ? { nickname: member.nickname } : {}),
  ...(member.pronouns ? { pronouns: member.pronouns } : {}),
})

const REFERRAL_DAYS = 30

/** A link a member gives someone they vouch for; used once, within 30 days. */
export const createReferral = async (referrer: string): Promise<Referral> => {
  const [referral] = await (await db())
    .insert(referrals)
    .values({
      id: randomBytes(16).toString('base64url'),
      referrer,
      expiresAt: sql`now() + ${REFERRAL_DAYS} * interval '1 day'`,
    })
    .returning()
  return referral
}

/** A member's referral links, newest first. */
export const referralsOf = async (referrer: string): Promise<Referral[]> =>
  (await db())
    .select()
    .from(referrals)
    .where(eq(referrals.referrer, referrer))
    .orderBy(desc(referrals.createdAt))
    .limit(20)

/** A referral link that can still be used, and who gave it. */
export const findReferral = async (code: string): Promise<{ referral: Referral; referrer: Member } | undefined> => {
  const [row] = await (await db())
    .select({ referral: referrals, referrer: members })
    .from(referrals)
    .innerJoin(members, eq(members.sub, referrals.referrer))
    .where(and(eq(referrals.id, code), isNull(referrals.usedBy), gt(referrals.expiresAt, sql`now()`)))
  return row
}
