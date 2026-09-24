import { index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { decisionLogTable, revisionTable } from '@fairgarden/policy/drizzle'

/**
 * The members database. `pnpm db:generate` writes the next migration into
 * drizzle/ from this. Tables are prefixed `members_` so this can share a
 * database with the id service. Free of other imports: drizzle-kit loads it
 * on its own.
 */

/**
 * A member, keyed by the `sub` the id service gives them. The id service
 * keeps who they are; this keeps what membership means here, and whatever
 * they choose to tell the community.
 */
export const members = pgTable('members_members', {
  sub: text('sub').primaryKey(),
  /** As of their last sign-in, for showing; the id service owns it. */
  email: text('email').notNull(),
  name: text('name'),
  nickname: text('nickname'),
  pronouns: text('pronouns'),
  bio: text('bio'),
  /**
   * What policy admitted them as, then whatever the organisation sets; never
   * the member.
   */
  status: text('status').$type<'probationary' | 'active' | 'lapsed' | 'suspended'>().notNull().default('active'),
  roles: jsonb('roles').$type<string[]>().notNull().default([]),
  /** The member whose referral they joined with, if any. */
  referredBy: text('referred_by'),
  joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * A member vouching for someone who wants to join: a link, used once. Whether
 * it counts is the policy's to say, when they ask to join.
 */
export const referrals = pgTable(
  'members_referrals',
  {
    /** The code in the link. */
    id: text('id').primaryKey(),
    referrer: text('referrer')
      .notNull()
      .references(() => members.sub, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** Who joined with it. */
    usedBy: text('used_by'),
    usedAt: timestamp('used_at', { withTimezone: true }),
  },
  (table) => [index('members_referrals_referrer').on(table.referrer, table.createdAt.desc())]
)

/** Every decision about what leaves this service, as Open Policy Agent logs its own, for audits. */
export const policyDecisions = decisionLogTable('members_policy_decisions')

/** Every revision of the organization's policy this service has run, so each decision can be read beside its rules. */
export const policyRevisions = revisionTable('members_policy_revisions')
