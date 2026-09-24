import { defineConfig, devices } from '@playwright/test'

/**
 * Browser tests for the members service, run against a production build that
 * signs in with a mock id service (e2e/mock-id.ts): once with the built-in
 * rules, and once with an organization's policy on top. Nothing outside this
 * repository is needed: `pnpm test:e2e`.
 *
 * The servers start in order, so the second serves the first one's build.
 */

const MEMBERS = 'http://localhost:3120'
const MOCK_ID = 'http://localhost:3121'
/** The same build, running examples/admission: an organization's rules for joining. */
const CLUB = 'http://localhost:3122'

const members = {
  FG_MEMBERS_ID_URL: MOCK_ID,
  FG_MEMBERS_CLIENT_ID: 'members',
  FG_MEMBERS_CLIENT_SECRET: 'members-secret',
  FG_MEMBERS_SECRET: 'e2e-session-secret',
}

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: { baseURL: MEMBERS, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node e2e/mock-id.ts',
      url: `${MOCK_ID}/health`,
      env: { MOCK_ID_PORT: '3121', MEMBERS_URLS: `${MEMBERS},${CLUB}` },
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'node e2e/serve.ts',
      url: MEMBERS,
      timeout: 300_000,
      reuseExistingServer: !process.env.CI,
      env: {
        ...members,
        MEMBERS_PORT: '3120',
        FG_MEMBERS_URL: MEMBERS,
        FG_MEMBERS_DATA_DIR: 'e2e/.data',
        FG_MEMBERS_EMBEDDED_DATABASE_PORT: '54420',
      },
    },
    {
      command: 'node e2e/serve.ts',
      url: CLUB,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      env: {
        ...members,
        MEMBERS_PORT: '3122',
        FG_MEMBERS_URL: CLUB,
        FG_MEMBERS_DATA_DIR: 'e2e/.club',
        FG_MEMBERS_EMBEDDED_DATABASE_PORT: '54422',
        E2E_POLICY: 'examples/admission',
        E2E_SKIP_BUILD: '1',
      },
    },
  ],
})
