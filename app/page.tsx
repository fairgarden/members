import { Alert } from '@fairgarden/design/feedback/alert'
import { Button } from '@fairgarden/design/actions/button'
import { Tag } from '@fairgarden/design/feedback/tag'
import type from '@fairgarden/design/utils/type.module.css'
import { apply } from '@fairgarden/members/lib/admission'
import { getConfig } from '@fairgarden/members/lib/config'
import { href } from '@fairgarden/members/lib/link'
import { findMember, referralsOf, type Member } from '@fairgarden/members/lib/members'
import { requestedScopes } from '@fairgarden/members/lib/policy'
import { currentSession, type Session } from '@fairgarden/members/lib/session'
import { Note, Panel, Section, Stack } from '@fairgarden/members/lib/ui/Panel'
import { join, refer } from './actions'
import styles from './home.module.css'
import { ProfileForm } from './ProfileForm'

const ERRORS: Record<string, string> = {
  access_denied: 'You cancelled signing in.',
  expired: 'Signing in took too long. Try again.',
  sign_in_failed: 'Signing in did not work. Try again.',
  referral_unavailable: 'That referral link has been used, or has expired. Ask for another.',
  email_needed: 'Members needs your email address to keep your membership. Sign in again, and share it.',
}

const STATUSES: Record<Member['status'], string> = {
  probationary: 'Probationary',
  active: 'Active',
  lapsed: 'Lapsed',
  suspended: 'Suspended',
}

type Search = { error?: string; referral?: string }

const signInHref = (returnTo: string, consent = false) =>
  href(`/auth/login?${new URLSearchParams({ returnTo, ...(consent ? { consent: '' } : {}) })}`)

/** Where the organization's rules are shown in full: the id service's policy page. */
const policyHref = () => `${getConfig().issuer}/policy`

function ErrorAlert({ error }: { error?: string }) {
  if (!error) return null
  return (
    <Alert status="warning" title="That didn't work.">
      {ERRORS[error] ?? 'Something went wrong. Try again.'}
    </Alert>
  )
}

function SignOut() {
  return (
    <form method="post" action={href('/auth/logout')}>
      <Button type="submit" variant="text">
        Sign Out
      </Button>
    </form>
  )
}

/**
 * What members asked the id service for that it was not given: the scopes the
 * organization's rules read, which the person may have declined.
 */
const unshared = async (session: Session) => {
  const shared: Record<string, boolean> = {
    address: Boolean(session.address),
    residential_address: Boolean(session.residentialAddress),
  }
  return (await requestedScopes()).filter((scope) => scope in shared && !shared[scope])
}

/**
 * Someone signed in who is not a member yet: what the organization's rules
 * say about them joining, what to do about anything in the way, and the
 * button to ask.
 */
async function JoinPanel({ session, search }: { session: Session; search: Search }) {
  const { admission, referrer, referralUnavailable } = await apply(session, 'Preview', search.referral)
  const returnTo = search.referral ? `/?referral=${encodeURIComponent(search.referral)}` : '/'
  const reasons = Object.entries(admission.reasons)
  const missing = admission.allowed ? [] : await unshared(session)

  return (
    <Panel
      eyebrow="Members"
      title="Become a member"
      lede={
        admission.allowed
          ? `You can join now${admission.status === 'probationary' ? ', as a probationary member' : ''}.`
          : 'Before you can join:'
      }
    >
      <ErrorAlert error={search.error} />
      {referralUnavailable && !search.error ? <ErrorAlert error="referral_unavailable" /> : null}
      {/* Only what the referrer tells the community: their name is theirs, and links get passed on. */}
      {referrer ? <Note>{referrer.nickname ?? 'A member'} referred you.</Note> : null}
      {reasons.length > 0 ? (
        <ul className={styles.list}>
          {reasons.map(([requirement, reason]) => (
            <li key={requirement} className={styles.reason}>
              {reason}
            </li>
          ))}
        </ul>
      ) : null}
      {admission.allowed ? (
        <form action={join}>
          {referrer ? <input type="hidden" name="referral" value={search.referral} /> : null}
          <Button type="submit" variant="solid" size="lg">
            Join
          </Button>
        </form>
      ) : (
        <>
          <Stack row>
            {missing.length > 0 ? (
              // Asks again what to share with Members, on the id service's own page.
              <Button render={<a href={signInHref(returnTo, true)} />} nativeButton={false}>
                Share More With Members
              </Button>
            ) : null}
            <Button render={<a href={`${getConfig().issuer}/account`} />} nativeButton={false}>
              Go to Your Account
            </Button>
            <Button variant="text" render={<a href={signInHref(returnTo)} />} nativeButton={false}>
              Check Again
            </Button>
          </Stack>
          <Note>Changed something in your account? Check again, and Members sees it.</Note>
        </>
      )}
      <Note>
        Who may join is set by the organization’s <a href={policyHref()}>policy</a>. Signed in as{' '}
        {session.email}.
      </Note>
      <SignOut />
    </Panel>
  )
}

/** A member's referral links: each one lets one person join with them as referrer. */
async function ReferralsSection({ member }: { member: Member }) {
  const links = (await referralsOf(member.sub)).filter(
    (referral) => !referral.usedBy && referral.expiresAt > new Date()
  )
  return (
    <Section title="Refer someone">
      <Note>
        Give someone you vouch for a link; it works once, for 30 days. Whether a referral counts is up to
        the organization’s <a href={policyHref()}>policy</a>.
      </Note>
      {links.length > 0 ? (
        <ul className={styles.list} id="referrals">
          {links.map((referral) => (
            <li key={referral.id} className={styles.link}>
              <span className={`${type.typeData} ${styles.url}`}>
                {`${getConfig().url}/?referral=${referral.id}`}
              </span>
              <span className={styles.muted}>
                Until {referral.expiresAt.toLocaleDateString('en', { dateStyle: 'medium' })}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <form action={refer}>
        <Button type="submit">Create a Referral Link</Button>
      </form>
    </Section>
  )
}

/**
 * A member's home: their membership as the organisation records it, the
 * profile they keep, and links to refer others. Who they are — email, name,
 * addresses — lives in the id service, and is only here because they agreed
 * to share it. Someone who is not a member yet is shown how to become one.
 */
export default async function Home({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams
  const session = await currentSession()

  if (!session) {
    const returnTo = search.referral ? `/?referral=${encodeURIComponent(search.referral)}` : '/'
    return (
      <Panel
        eyebrow="Members"
        title="Welcome"
        lede={
          search.referral
            ? 'A member has invited you to join. Sign in to see what joining takes.'
            : 'Sign in to see your membership and profile.'
        }
      >
        <ErrorAlert error={search.error} />
        <Stack row>
          <Button
            variant="solid"
            size="lg"
            // A route handler that sends the browser to the id service, so a
            // full navigation rather than a client-side one.
            // Without an email address there is nothing to keep, so ask again what to share.
            render={<a href={signInHref(returnTo, search.error === 'email_needed')} />}
            nativeButton={false}
          >
            Sign In
          </Button>
        </Stack>
      </Panel>
    )
  }

  const member = await findMember(session.sub)
  if (!member) return <JoinPanel session={session} search={search} />

  return (
    <Panel
      wide
      eyebrow="Members"
      title={member.nickname ?? member.name ?? member.email}
      lede={member.email}
    >
      <ErrorAlert error={search.error} />
      <Section title="Membership">
        <Stack row>
          <Tag>{STATUSES[member.status]}</Tag>
          {member.roles.map((role) => (
            <Tag key={role}>{role}</Tag>
          ))}
        </Stack>
        <Note>
          Member since {member.joinedAt.toLocaleDateString('en', { dateStyle: 'long' })}. Services you
          share your membership with see this, your nickname and your pronouns.
        </Note>
      </Section>
      <Section title="Your profile">
        <ProfileForm nickname={member.nickname} pronouns={member.pronouns} bio={member.bio} />
      </Section>
      <ReferralsSection member={member} />
      <Section title="Your account">
        <Note>Your email, name, phone number and addresses are kept by your account, which decides who else sees them.</Note>
        <Stack row>
          <Button render={<a href={`${getConfig().issuer}/account`} />} nativeButton={false}>
            Manage Your Account
          </Button>
          <SignOut />
        </Stack>
      </Section>
    </Panel>
  )
}
