import { spawnSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { and, eq, gte, like } from 'drizzle-orm'
import { newestFirst, toEntry } from '@fairgarden/policy/drizzle'
import { openConnection, type Connection } from './db.ts'
import { declaredMigrations, migrate, readMigrations, rollback, status } from '@fairgarden/distribution/migrations'
import { members, policyDecisions } from './schema.ts'

/**
 * `pnpm db:*`, run by Node itself (it strips the types), so everything this
 * imports keeps to syntax Node can strip.
 */

const ROOT = path.resolve(import.meta.dirname, '..')
// Where they are, and the journal table and lock they run under: package.json says.
const MIGRATIONS = declaredMigrations(ROOT)!

// The same files Next reads, highest precedence first; the environment wins.
const loadEnv = () => {
  const mode = process.env.NODE_ENV ?? 'development'
  for (const file of [`.env.${mode}.local`, '.env.local', `.env.${mode}`, '.env']) {
    try {
      process.loadEnvFile(path.join(ROOT, file))
    } catch {
      // not there
    }
  }
}

const withConnection = async <T>(fn: (connection: Connection) => Promise<T>): Promise<T> => {
  const connection = await openConnection({ autoMigrate: false })
  console.error(`Using the ${connection.describe}`)
  try {
    return await fn(connection)
  } finally {
    await connection.close()
  }
}

const USAGE = `Usage:
  pnpm db:status                     what has run, and what is pending
  pnpm db:migrate                    apply pending migrations
  pnpm db:rollback [--steps N]       roll back the latest N migrations (default 1)
  pnpm db:rollback --to TAG          roll back everything after TAG (0 for all)
  pnpm db:generate --name NAME       write the next migration from lib/schema.ts

  pnpm policy:log [--subject SUB] [--decision NAME] [--since 24h] [--limit N]
                                     decisions, as OPA decision log JSON lines

  pnpm members add --sub SUB --email EMAIL [--name NAME] [--status active|probationary] [--role ROLE...]
                                     make someone a member without asking the
                                     policy: the founders, when the rules for
                                     joining need members to exist already
`

const commands: Record<string, (args: string[]) => Promise<void>> = {
  async 'db status'() {
    await withConnection(async ({ pool }) => {
      const rows = await status(pool, MIGRATIONS.directory, MIGRATIONS)
      for (const row of rows) {
        const when = row.appliedAt ? row.appliedAt.toISOString() : ''
        const down = row.reversible ? '' : ' (no down migration)'
        console.log(`${row.state.padEnd(8)} ${row.tag}${down} ${when}`.trimEnd())
      }
    })
  },

  async 'db migrate'() {
    await withConnection(async ({ pool }) => {
      const applied = await migrate(pool, MIGRATIONS.directory, MIGRATIONS)
      console.log(applied.length ? `Applied ${applied.join(', ')}` : 'Already up to date')
    })
  },

  async 'db rollback'(args) {
    const { values } = parseArgs({
      args,
      options: { steps: { type: 'string' }, to: { type: 'string' } },
    })
    await withConnection(async ({ pool }) => {
      const rolledBack = await rollback(pool, MIGRATIONS.directory, MIGRATIONS, {
        steps: values.steps ? Number(values.steps) : undefined,
        to: values.to,
      })
      console.log(rolledBack.length ? `Rolled back ${rolledBack.join(', ')}` : 'Nothing to roll back')
    })
  },

  async 'db generate'(args) {
    const result = spawnSync('drizzle-kit', ['generate', ...args], {
      cwd: ROOT,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })
    if (result.status !== 0) process.exit(result.status ?? 1)

    // drizzle-kit only writes the way forward; leave a place for the way back.
    for (const { tag, down } of readMigrations(MIGRATIONS.directory)) {
      const file = path.join(MIGRATIONS.directory, `${tag}.down.sql`)
      if (down || existsSync(file)) continue
      writeFileSync(
        file,
        `-- Undoes ${tag}.sql. drizzle-kit does not write these; until the\n` +
          `-- statements below are filled in, this migration cannot be rolled back.\n` +
          `-- Separate statements with a line reading: --> statement-breakpoint\n`
      )
      console.log(`Write the rollback for ${tag} in drizzle/${tag}.down.sql`)
    }
  },
}

Object.assign(commands, {
  async 'policy log'(args: string[]) {
    const { values } = parseArgs({
      args,
      options: {
        subject: { type: 'string' },
        decision: { type: 'string' },
        since: { type: 'string' },
        limit: { type: 'string', default: '100' },
      },
    })
    await withConnection(async ({ database }) => {
      const conditions = [
        values.subject ? eq(policyDecisions.subject, values.subject) : undefined,
        values.decision ? like(policyDecisions.path, `%/${values.decision}`) : undefined,
        values.since ? gte(policyDecisions.decidedAt, since(values.since)) : undefined,
      ].filter((condition) => condition !== undefined)
      const rows = await database
        .select()
        .from(policyDecisions)
        .where(and(...conditions))
        .orderBy(...newestFirst(policyDecisions))
        .limit(Number(values.limit))
      // OPA's own decision log format, one per line, oldest first.
      for (const row of rows.reverse()) console.log(JSON.stringify(toEntry(row)))
    })
  },
})

Object.assign(commands, {
  async 'members add'(args: string[]) {
    const { values } = parseArgs({
      args,
      options: {
        sub: { type: 'string' },
        email: { type: 'string' },
        name: { type: 'string' },
        status: { type: 'string', default: 'active' },
        role: { type: 'string', multiple: true, default: [] },
      },
    })
    if (!values.sub || !values.email) throw new Error('Give the --sub the id service knows them by, and their --email.')
    if (values.status !== 'active' && values.status !== 'probationary') throw new Error('--status is active or probationary.')
    await withConnection(async ({ database }) => {
      const [added] = await database
        .insert(members)
        .values({
          sub: values.sub!,
          email: values.email!,
          name: values.name ?? null,
          status: values.status as 'active' | 'probationary',
          roles: values.role,
        })
        .onConflictDoNothing()
        .returning()
      if (!added) throw new Error(`${values.sub} is already a member.`)
      console.log(`Added ${added.email}, ${added.status}${added.roles.length ? `, ${added.roles.join(', ')}` : ''}.`)
    })
  },
})

/** `24h`, `7d`, `30m`, or a date. */
const since = (value: string): Date => {
  const match = /^(\d+)([mhd])$/.exec(value)
  if (!match) return new Date(value)
  const unit = { m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2] as 'm' | 'h' | 'd']
  return new Date(Date.now() - Number(match[1]) * unit)
}

const main = async () => {
  loadEnv()
  const [group, command, ...rest] = process.argv.slice(2)
  const run = commands[`${group} ${command}`]
  if (!run) {
    console.error(USAGE)
    process.exit(group ? 1 : 0)
  }
  await run(rest)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  if (error instanceof Error && error.cause) console.error(error.cause)
  process.exit(1)
})
