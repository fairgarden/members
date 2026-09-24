import { lt, sql } from 'drizzle-orm'
import {
  createPolicy,
  jsonLinesLogger,
  PolicyUnavailableError,
  type DecisionLogger,
  type Policy,
} from '@fairgarden/policy'
import { drizzleLogger, drizzleRevisions } from '@fairgarden/policy/drizzle'
import { getConfig } from './config.ts'
import { db } from './db.ts'
import { policyDecisions, policyRevisions } from './schema.ts'

/**
 * This service's decisions, the same way the id service makes its own,
 * through `@fairgarden/policy`: the built-in rules below, or the
 * organization's signed policy (`FG_POLICY_BUNDLE`), or an OPA server
 * (`FG_POLICY_OPA_URL`). The package is `FG_MEMBERS_POLICY_PACKAGE`
 * (`fairgarden/members`); policies/members.rego is its rules as members ships
 * them, for the organization to build on — its bylaws, say, on who may join.
 * Every decision is recorded in `members_policy_decisions`, labelled with
 * the revision that made it, and every revision in `members_policy_revisions`.
 */

/**
 * `release`: which of a member's claims go to the service asking, and why
 * not the rest. The reasons travel back to the id service, which shows them
 * to the member while they decide what to share.
 */
export interface ReleaseInput {
  user: { name: string }
  /** The service the claims are for. */
  client: { id: string; name: string }
  /** `Preview` while the member decides, `Release` once they have. */
  purpose: string
  /** Everything this service would answer with. */
  claims: Record<string, unknown>
}

export interface Release {
  claims: Record<string, unknown>
  /** Keyed by what was withheld: a claim, or part of one, such as `membership.roles`. */
  reasons: Record<string, string>
}

/** The OpenID Connect `address` claim. */
export interface Address {
  formatted?: string
  street_address?: string
  locality?: string
  region?: string
  postal_code?: string
  country?: string
}

/**
 * `admit`: may this person join, at what status, and if not, what stands in
 * the way? Asked while they read the join page (`Preview`) and when they ask
 * to join (`Join`); the reasons are what the page tells them to do.
 */
export interface AdmitInput {
  /** The applicant, as their `sub`. */
  user: { name: string }
  purpose: 'Preview' | 'Join'
  /** What the id service vouches for, as far as they let it tell us. */
  applicant: {
    email: string
    email_verified: boolean
    name: string | null
    /** Where they receive post, when they shared it: as they gave it, not checked. */
    address?: Address
    /** Where they live, when they shared it: as they gave it, not checked. */
    residential_address?: Address
  }
  /** The member whose referral link brought them, if one did. */
  referral?: { by: { name: string; status: string; roles: string[]; since: string } }
}

/** What a new member's status may be. */
export const ADMITTED_STATUSES = ['probationary', 'active'] as const
export type AdmittedStatus = (typeof ADMITTED_STATUSES)[number]

export interface Admission {
  allowed: boolean
  /** The status they join with. */
  status: AdmittedStatus
  /** What stands in the way, keyed by requirement, in words they are shown. */
  reasons: Record<string, string>
}

type MembersDecisions = {
  release: { input: ReleaseInput; result: Partial<Release> }
  admit: { input: AdmitInput; result: { allow?: boolean; status?: string; reasons?: Record<string, string> } }
  /** `scopes`: what to ask the id service for when someone signs in. */
  scopes: { input: Record<string, never>; result: { scopes?: string[] } }
}

/** What members asks for without a policy saying otherwise. */
const BASIC_SCOPES = ['openid', 'email', 'profile']

/** Now and then, forget decisions older than the retention period. */
const sweeping: DecisionLogger = async () => {
  if (Math.random() >= 0.01) return
  const { retentionDays } = getConfig().policyLog
  await (await db())
    .delete(policyDecisions)
    .where(lt(policyDecisions.decidedAt, sql`now() - ${retentionDays} * interval '1 day'`))
}

let policy: Policy<MembersDecisions> | undefined

const current = (): Policy<MembersDecisions> => {
  if (policy) return policy
  const { policy: settings, policyLog } = getConfig()
  policy = createPolicy<MembersDecisions>({
    package: settings.package,
    source: settings.source,
    // Built in: everything asked for, for everyone; anyone who signs in may
    // join, straight away; and only what membership needs is asked of id.
    builtIn: {
      release: ({ claims }) => ({ claims, reasons: {} }),
      admit: () => ({ allow: true, status: 'active', reasons: {} }),
      scopes: () => ({ scopes: BASIC_SCOPES }),
    },
    loggers: [
      drizzleLogger(db, policyDecisions),
      sweeping,
      ...(policyLog.stdout ? [jsonLinesLogger()] : []),
    ],
    labels: { service: 'members' },
    onRevision: drizzleRevisions(db, policyRevisions).record,
    // What was on offer need not be kept: the result records what left. Nor
    // need who an applicant is beyond their `sub`, or where they live: the
    // result says whether it counted, and most who apply never join.
    erase: {
      release: ['/input/claims'],
      admit: [
        '/input/applicant/email',
        '/input/applicant/name',
        '/input/applicant/address',
        '/input/applicant/residential_address',
      ],
    },
  })
  return policy
}

/** If the policy cannot be evaluated: nothing. */
export const decideRelease = async (input: ReleaseInput): Promise<Release> => {
  try {
    const result = await current().decide('release', input)
    return { claims: result.claims ?? {}, reasons: result.reasons ?? {} }
  } catch (error) {
    if (!(error instanceof PolicyUnavailableError)) throw error
    console.error('[members] policy could not be evaluated', error.cause)
    return { claims: {}, reasons: { membership: 'Membership details are unavailable right now.' } }
  }
}

/** If the policy cannot be evaluated, nobody joins; the reason says so. */
export const decideAdmission = async (input: AdmitInput): Promise<Admission> => {
  try {
    const result = await current().decide('admit', input)
    const status = result.status ?? 'active'
    if (!(ADMITTED_STATUSES as readonly string[]).includes(status)) {
      throw new PolicyUnavailableError('admit', new Error(`the policy admitted with status ${status}`))
    }
    return {
      allowed: result.allow === true,
      status: status as AdmittedStatus,
      reasons: result.reasons ?? {},
    }
  } catch (error) {
    if (!(error instanceof PolicyUnavailableError)) throw error
    console.error('[members] policy could not be evaluated', error.cause)
    return { allowed: false, status: 'active', reasons: { policy: 'Joining is unavailable right now. Try again later.' } }
  }
}

/**
 * What to ask the id service for: what membership needs, and whatever the
 * organization's rules for joining read, such as an address. If the policy
 * cannot be evaluated, only what membership needs.
 */
export const requestedScopes = async (): Promise<string[]> => {
  try {
    const { scopes = BASIC_SCOPES } = await current().decide('scopes', {})
    return [...new Set(['openid', ...scopes])]
  } catch (error) {
    if (!(error instanceof PolicyUnavailableError)) throw error
    console.error('[members] policy could not be evaluated', error.cause)
    return BASIC_SCOPES
  }
}
