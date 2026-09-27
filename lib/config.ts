import { createHash } from 'node:crypto'
import path from 'node:path'
import { secretValues } from '@fairgarden/distribution/secrets'
import { policySourceFromEnv, type PolicySource } from '@fairgarden/policy'

/**
 * What the members service is told by its environment. Read on first use, so
 * a build does not need it. Loaded natively by the CLI too, so it keeps to
 * syntax Node can strip.
 */

const PACKAGE_NAME = '@fairgarden/members'

export interface Config {
  /** The public URL, including any monolith mount point. */
  url: string
  /** The monolith mount point, or `''` when running on its own. */
  mount: string
  /** The id service's issuer, which members signs in with. */
  issuer: string
  clientId: string
  clientSecret: string | undefined
  /**
   * Encrypt the session cookie: the first seals, and every one opens, so a
   * secret rotated in (`FG_MEMBERS_SECRET="new old"`) signs nobody out.
   */
  sessionKeys: Uint8Array[]
  databaseUrl: string | undefined
  dataDir: string
  embeddedDatabasePort: number
  /**
   * The organization's policy (`FG_POLICY_*`, shared by every service), or
   * undefined for the built-in rules; and the Rego package holding this
   * service's rules, as a path.
   */
  policy: { source: PolicySource | undefined; package: string }
  /** How long decisions are kept, and whether they also go to standard output. */
  policyLog: { retentionDays: number; stdout: boolean }
}

const env = (name: string): string | undefined => process.env[name]?.trim() || undefined
const trimSlash = (value: string) => value.replace(/\/+$/, '')

/** Where a monolith mounted each app it serves, this one included; empty on its own. */
const mounts = (): Record<string, string> => {
  try {
    return JSON.parse(process.env.MONOLITH_MOUNTS ?? '{}') as Record<string, string>
  } catch {
    return {}
  }
}

const ID_PACKAGE = '@fairgarden/id'

const publicUrl = (): string => {
  const configured = env('FG_MEMBERS_URL')
  if (configured) return trimSlash(configured)
  const production = env('VERCEL_PROJECT_PRODUCTION_URL')
  if (env('VERCEL_ENV') === 'production' && production) return `https://${production}`
  const deployment = env('VERCEL_URL')
  if (deployment) return `https://${deployment}`
  return `http://localhost:${env('PORT') ?? '3020'}`
}

const policySettings = (): Config['policy'] => ({
  source: policySourceFromEnv(),
  package: (env('FG_MEMBERS_POLICY_PACKAGE') ?? 'fairgarden/members').replace(/\./g, '/'),
})

let cached: Config | undefined

export const getConfig = (): Config => {
  if (cached) return cached
  const mounted = mounts()
  const mount = mounted[PACKAGE_NAME] ?? ''
  const url = `${publicUrl()}${mount}`
  const local = /^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(url)

  // Newest first, from its slots once rotated, or as set by hand.
  const secrets = secretValues('FG_MEMBERS_SECRET')
  if (secrets.length === 0 && !local) throw new Error('Set FG_MEMBERS_SECRET to a long random value.')

  // Beside the id service in a monolith, everything about signing in with it
  // follows from the one deployment: its issuer is this origin at its mount,
  // and the client secret is the one variable both apps read — the one id
  // knows this service by. On its own, the issuer has to be said.
  const idMount = mounted[ID_PACKAGE]
  const issuer =
    env('FG_MEMBERS_ID_URL') ??
    (idMount !== undefined ? `${trimSlash(env('FG_ID_URL') ?? publicUrl())}${idMount}` : undefined) ??
    (local ? 'http://localhost:3010' : undefined)
  if (!issuer) {
    throw new Error(
      "Set FG_MEMBERS_ID_URL to the id service's issuer: its FG_ID_URL, and its mount point if a monolith serves it."
    )
  }
  const clientId = env('FG_MEMBERS_CLIENT_ID') ?? 'members'
  const own = secretValues('FG_MEMBERS_CLIENT_SECRET')
  const clientSecrets =
    own.length > 0 || idMount === undefined
      ? own
      : secretValues(`FG_ID_SERVICE_${clientId.toUpperCase().replace(/-/g, '_')}_SECRET`)

  cached = {
    url,
    mount,
    issuer: trimSlash(issuer),
    clientId,
    // The newest: id accepts the ones before it until the next rotation.
    clientSecret: clientSecrets[0],
    sessionKeys: (secrets.length > 0 ? secrets : ['local development only']).map((secret) =>
      createHash('sha256').update(secret).digest()
    ),
    databaseUrl: env('FG_MEMBERS_DATABASE_URL') ?? env('DATABASE_URL') ?? env('POSTGRES_URL'),
    // Only for the embedded development database; not traced into a build.
    dataDir: path.resolve(/* turbopackIgnore: true */ env('FG_MEMBERS_DATA_DIR') ?? path.join('.data', 'members')),
    embeddedDatabasePort: Number(env('FG_MEMBERS_EMBEDDED_DATABASE_PORT') ?? 54320),
    policy: policySettings(),
    policyLog: {
      retentionDays: Number(env('FG_MEMBERS_POLICY_LOG_RETENTION_DAYS') ?? 400),
      stdout: env('FG_MEMBERS_POLICY_LOG_STDOUT') === 'true',
    },
  }
  return cached
}
