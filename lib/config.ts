import { createHash } from 'node:crypto'
import path from 'node:path'
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
  /** Encrypts the session cookie. */
  sessionKey: Uint8Array
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

const mountPath = (): string => {
  try {
    const mounts = JSON.parse(process.env.MONOLITH_MOUNTS ?? '{}') as Record<string, string>
    return mounts[PACKAGE_NAME] ?? ''
  } catch {
    return ''
  }
}

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
  const mount = mountPath()
  const url = `${publicUrl()}${mount}`
  const local = /^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(url)

  const secret = env('FG_MEMBERS_SECRET')
  if (!secret && !local) throw new Error('Set FG_MEMBERS_SECRET to a long random value.')

  cached = {
    url,
    mount,
    issuer: trimSlash(env('FG_MEMBERS_ID_URL') ?? 'http://localhost:3010'),
    clientId: env('FG_MEMBERS_CLIENT_ID') ?? 'members',
    clientSecret: env('FG_MEMBERS_CLIENT_SECRET'),
    sessionKey: createHash('sha256').update(secret ?? 'local development only').digest(),
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
