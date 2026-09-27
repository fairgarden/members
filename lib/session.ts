import { EncryptJWT, jwtDecrypt, type JWTPayload } from 'jose'
import { cookies } from 'next/headers'
import { getConfig } from './config.ts'
import type { Address } from './policy.ts'

/**
 * The members session, and the state of a sign-in in progress, each kept in
 * an encrypted cookie: nothing about a session is stored server side.
 */

const SESSION_COOKIE = 'fg_members_session'
const FLOW_COOKIE = 'fg_members_flow'
const SESSION_HOURS = 12

export interface Session {
  sub: string
  email: string
  emailVerified: boolean
  name: string | null
  /** Where they receive post and where they live: only when the policy asked, and they chose to share it. */
  address?: Address
  residentialAddress?: Address
  /** Sent back to the id service when signing out, to say who. */
  idToken: string
}

export interface Flow {
  verifier: string
  state: string
  nonce: string
  returnTo: string
}

const seal = (payload: JWTPayload, expires: string) =>
  new EncryptJWT(payload)
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt()
    .setExpirationTime(expires)
    .encrypt(getConfig().sessionKeys[0])

// Sealed with the newest key; opened with whichever still works, so a cookie
// sealed before a rotation outlives it.
const open = async <T>(value: string | undefined): Promise<T | undefined> => {
  if (!value) return undefined
  for (const key of getConfig().sessionKeys) {
    try {
      const { payload } = await jwtDecrypt(value, key)
      return payload as T
    } catch {
      // not this key, or not a cookie of ours
    }
  }
  return undefined
}

// Only this app's own paths: inside a monolith the other apps share the origin,
// and have no use for these.
const cookiePath = () => getConfig().mount || '/'

const cookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: getConfig().url.startsWith('https:'),
  path: cookiePath(),
})

export const currentSession = async (): Promise<Session | undefined> =>
  open<Session>((await cookies()).get(SESSION_COOKIE)?.value)

export const startSession = async (session: Session) => {
  ;(await cookies()).set(SESSION_COOKIE, await seal({ ...session }, `${SESSION_HOURS}h`), {
    ...cookieOptions(),
    maxAge: SESSION_HOURS * 60 * 60,
  })
}

export const endSession = async () => {
  ;(await cookies()).delete({ name: SESSION_COOKIE, path: cookiePath() })
}

export const saveFlow = async (flow: Flow) => {
  ;(await cookies()).set(FLOW_COOKIE, await seal({ ...flow }, '10m'), {
    ...cookieOptions(),
    maxAge: 10 * 60,
  })
}

export const takeFlow = async (): Promise<Flow | undefined> => {
  const store = await cookies()
  const flow = await open<Flow>(store.get(FLOW_COOKIE)?.value)
  store.delete({ name: FLOW_COOKIE, path: cookiePath() })
  return flow
}
