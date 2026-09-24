import { findReferral, type Member } from './members.ts'
import { decideAdmission, type Admission } from './policy.ts'
import type { Session } from './session.ts'

/**
 * Asking the policy whether someone may join: what the id service vouches
 * for, and the member who referred them, if their link still counts.
 */
export interface Application {
  admission: Admission
  /** The member whose link they came with. */
  referrer?: Member
  /** They came with a link that has been used, or has expired. */
  referralUnavailable: boolean
}

export const apply = async (
  session: Session,
  purpose: 'Preview' | 'Join',
  code: string | undefined
): Promise<Application> => {
  const found = code ? await findReferral(code) : undefined
  const admission = await decideAdmission({
    user: { name: session.sub },
    purpose,
    applicant: {
      email: session.email,
      email_verified: session.emailVerified,
      name: session.name,
      ...(session.address ? { address: session.address } : {}),
      ...(session.residentialAddress ? { residential_address: session.residentialAddress } : {}),
    },
    ...(found
      ? {
          referral: {
            by: {
              name: found.referrer.sub,
              status: found.referrer.status,
              roles: found.referrer.roles,
              since: found.referrer.joinedAt.toISOString(),
            },
          },
        }
      : {}),
  })
  return { admission, referrer: found?.referrer, referralUnavailable: Boolean(code && !found) }
}
