'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { apply } from '@fairgarden-private/members/lib/admission'
import { admitMember, createReferral, findMember, ReferralUnavailableError, updateProfile } from '@fairgarden-private/members/lib/members'
import { currentSession } from '@fairgarden-private/members/lib/session'

const clean = (value: unknown, max: number): string | null => {
  const text = String(value ?? '').trim()
  return text ? text.slice(0, max) : null
}

/** Save what a member tells the community about themselves. */
export async function saveProfile(values: Record<string, unknown>): Promise<{ error?: string }> {
  const session = await currentSession()
  if (!session) return { error: 'Your session ended. Sign in again.' }
  await updateProfile(session.sub, {
    nickname: clean(values.nickname, 60),
    pronouns: clean(values.pronouns, 40),
    bio: clean(values.bio, 1000),
  })
  revalidatePath('/')
  return {}
}

/** `path` with one more query parameter. */
const withParam = (path: string, name: string, value: string) => {
  const url = new URL(path, 'http://members')
  url.searchParams.set(name, value)
  return `${url.pathname}${url.search}`
}

/**
 * Ask to join. The policy decides again, now that they have asked; if it
 * says no, the page shows why, as it did before they asked.
 */
export async function join(form: FormData): Promise<void> {
  const session = await currentSession()
  if (!session) redirect('/?error=expired')
  // Already one: joined in another tab, or this page was stale.
  if (await findMember(session.sub)) redirect('/')
  const code = clean(form.get('referral'), 64) ?? undefined
  const back = code ? withParam('/', 'referral', code) : '/'

  const { admission, referralUnavailable } = await apply(session, 'Join', code)
  if (!admission.allowed) redirect(back)
  // A link that no longer works counts for nothing: the policy was asked
  // without it, and said yes.
  const referral = referralUnavailable ? undefined : code
  try {
    await admitMember({ ...session, status: admission.status, referral })
  } catch (error) {
    if (!(error instanceof ReferralUnavailableError)) throw error
    // Used up by someone else a moment ago.
    redirect(withParam(back, 'error', 'referral_unavailable'))
  }
  revalidatePath('/')
  redirect('/')
}

/** A new referral link, for a member to give someone they vouch for. */
export async function refer(): Promise<void> {
  const session = await currentSession()
  if (!session) redirect('/?error=expired')
  if (!(await findMember(session.sub))) redirect('/')
  await createReferral(session.sub)
  revalidatePath('/')
  redirect('/#referrals')
}
