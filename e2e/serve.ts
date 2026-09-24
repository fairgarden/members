import { spawn, spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import path from 'node:path'

/**
 * The members service as the browser tests see it: built for production (the
 * bundle is where the worst bugs hide) and served on its own port, with a
 * fresh embedded database every run. `E2E_DEV=1` serves `next dev` instead,
 * which starts faster while writing tests.
 *
 * `E2E_POLICY` names an organization's layer to build on members' own rules
 * and run, as a deployment would; otherwise the built-in rules decide.
 * `E2E_SKIP_BUILD=1` serves the build another server here already made.
 */

const ROOT = path.resolve(import.meta.dirname, '..')
const PORT = process.env.MEMBERS_PORT ?? '3120'
const DATA = process.env.FG_MEMBERS_DATA_DIR ?? 'e2e/.data'
const dev = process.env.E2E_DEV === '1'

rmSync(path.join(ROOT, DATA), { recursive: true, force: true })

const run = (command: string, args: string[]) => {
  const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

const env: Record<string, string> = { FG_POLICY_BUNDLE: 'none' }
if (process.env.E2E_POLICY) {
  const bundle = path.join(DATA, 'policies.tar.gz')
  run(path.join(ROOT, 'node_modules', '.bin', 'fg-policy'), [
    'build',
    '--base', 'policies',
    '--dir', process.env.E2E_POLICY,
    '--out', bundle,
  ])
  // Built here from the repository, as a deployment's is, so unsigned.
  Object.assign(env, { FG_POLICY_BUNDLE: bundle, FG_POLICY_ALLOW_UNSIGNED: 'true' })
}

const next = path.join(ROOT, 'node_modules', '.bin', 'next')
if (!dev && process.env.E2E_SKIP_BUILD !== '1') run(next, ['build'])

const server = spawn(next, [dev ? 'dev' : 'start', '-p', PORT], {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, ...env },
})
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.kill(signal))
}
server.on('exit', (code) => process.exit(code ?? 0))
