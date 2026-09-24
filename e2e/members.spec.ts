import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'

const MOCK_ID = 'http://localhost:3121'
const CLUB = 'http://localhost:3122'
const ROOT = path.resolve(import.meta.dirname, '..')

let count = 0
/** The mock id service reads `far`, `nowhere` and `unverified` in a login; see mock-id.ts. */
const uniqueEmail = (label: string) => `${label}-${Date.now().toString(36)}-${process.pid}-${(count += 1)}@example.com`

/** Sign in through the mock id service's development screens, starting at `start`. */
const signIn = async (page: Page, email: string, start = '/') => {
  await page.goto(start)
  await page.getByRole('link', { name: 'Sign In' }).click()
  await expect(page).toHaveURL(new RegExp(`^${MOCK_ID}/`))
  await page.getByPlaceholder('Enter any login').fill(email)
  await page.getByPlaceholder('and password').fill('anything')
  await page.getByRole('button', { name: 'Sign-in' }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page).toHaveURL(start)
}

/** Ask to join, as someone signed in who may. */
const join = async (page: Page) => {
  await expect(page.getByRole('heading', { name: 'Become a member' })).toBeVisible()
  await page.getByRole('button', { name: 'Join' }).click()
  await expect(page.getByRole('heading', { name: 'Membership' })).toBeVisible()
}

/** A member's newest referral link, made on their home page. */
const referralLink = async (page: Page) => {
  await page.getByRole('button', { name: 'Create a Referral Link' }).click()
  const link = page.locator('#referrals li').first().locator('span').first()
  await expect(link).toContainText('?referral=')
  return new URL((await link.textContent())!)
}

const review = async (page: Page, subject: string, client = { id: 'events', name: 'Events' }) =>
  (await (await page.request.post(`${MOCK_ID}/test/claimsreviews`, { data: { subject, client } })).json()) as {
    status: number
    uid: string
    body: { response?: { uid: string; claims: Record<string, unknown> } }
  }

test.describe('the members service', () => {
  test('signs people in with the id service, and makes them members when they join', async ({ page }) => {
    const email = uniqueEmail('join')
    await signIn(page, email)
    // Signing in is not joining.
    await expect(page.getByText('You can join now.')).toBeVisible()
    await join(page)
    await expect(page.getByRole('heading', { name: `Member ${email.split('@')[0]}` })).toBeVisible()
    await expect(page.getByText(email).first()).toBeVisible()
    await expect(page.getByText('Active')).toBeVisible()
    await expect(page.getByText(/^Member since/)).toBeVisible()
  })

  test('keeps the profile a member fills in, and shares only part of it', async ({ page }) => {
    const email = uniqueEmail('profile')
    await signIn(page, email)
    await join(page)
    await page.getByLabel('Nickname').fill('Sprout')
    await page.getByLabel('Pronouns').fill('she/her')
    await page.getByLabel('About You').fill('Grows tomatoes.')
    await page.getByRole('button', { name: 'Save Profile' }).click()
    await expect(page.getByText('Saved.')).toBeVisible()

    await page.reload()
    await expect(page.getByRole('heading', { name: 'Sprout' })).toBeVisible()
    await expect(page.getByLabel('About You')).toHaveValue('Grows tomatoes.')

    // What the id service is told, when the member shares their membership.
    const { status, uid, body } = await review(page, email)
    expect(status).toBe(200)
    expect(body.response).toEqual({
      uid,
      claims: {
        membership: { status: 'active', since: expect.any(String), roles: [], nickname: 'Sprout', pronouns: 'she/her' },
      },
    })
  })

  test('records every release decision, for audits', async ({ page }) => {
    const email = uniqueEmail('audited')
    await signIn(page, email)
    await join(page)
    await review(page, email, { id: 'gallery', name: 'Gallery' })

    // The export an auditor would run, against this server's database.
    const lines = execFileSync(
      process.execPath,
      [path.resolve(import.meta.dirname, '..', 'lib', 'cli.ts'), 'policy', 'log', '--subject', email],
      {
        cwd: path.resolve(import.meta.dirname, '..'),
        env: { ...process.env, FG_MEMBERS_DATA_DIR: 'e2e/.data', FG_MEMBERS_EMBEDDED_DATABASE_PORT: '54420' },
        stdio: ['ignore', 'pipe', 'ignore'],
      }
    )
      .toString()
      .trim()
      .split('\n')
    const entries = lines.map((line) => JSON.parse(line))
    // Joining was decided too: shown the page, then asked.
    expect(entries.filter((entry) => entry.path === 'fairgarden/members/admit').map((entry) => entry.input.purpose)).toEqual([
      'Preview',
      'Join',
    ])
    expect(entries.find((entry) => entry.path === 'fairgarden/members/release')).toMatchObject({
      path: 'fairgarden/members/release',
      input: { user: { name: email }, client: { id: 'gallery' }, purpose: 'Release' },
      result: { claims: { membership: { status: 'active' } } },
      erased: ['/input/claims'],
      labels: { service: 'members', engine: 'builtin', revision: 'builtin' },
    })
  })

  test('tells the id service nothing about people who are not members', async ({ page }) => {
    const { status, body } = await review(page, uniqueEmail('stranger'))
    expect(status).toBe(200)
    expect(body.response?.claims).toEqual({})
  })

  test('refuses claims reviews not signed by the id service', async ({ request }) => {
    const response = await request.post('/api/v1alpha1/claimsreviews', {
      headers: { authorization: 'Bearer not-a-token' },
      data: { apiVersion: 'id.fairgarden.org/v1alpha1', kind: 'ClaimsReview', request: {} },
    })
    expect(response.status()).toBe(401)
    expect(await response.json()).toMatchObject({ kind: 'Status', reason: 'Unauthorized' })
  })

  test('says so when someone cancels signing in', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: 'Sign In' }).click()
    await page.getByRole('link', { name: /cancel/i }).click()
    await expect(page.getByText('You cancelled signing in.')).toBeVisible()
  })

  test('signs out here and at the id service', async ({ page }) => {
    await signIn(page, uniqueEmail('leave'))
    await page.getByRole('button', { name: 'Sign Out' }).click()
    await expect(page).toHaveURL(new RegExp(`^${MOCK_ID}/`))
    await page.getByRole('button', { name: /sign me out/i }).click()
    await expect(page).toHaveURL('/')
    await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible()

    // Signed out at the id service too: it asks for a login again.
    await page.getByRole('link', { name: 'Sign In' }).click()
    await expect(page.getByPlaceholder('Enter any login')).toBeVisible()
  })

  test("lets members refer others, each link once", async ({ page, browser }) => {
    await signIn(page, uniqueEmail('referrer'))
    await join(page)
    await page.getByLabel('Nickname').fill('Bramble')
    await page.getByRole('button', { name: 'Save Profile' }).click()
    await expect(page.getByText('Saved.')).toBeVisible()
    const link = await referralLink(page)

    const applicant = await (await browser.newContext()).newPage()
    await signIn(applicant, uniqueEmail('referred'), `${link.pathname}${link.search}`)
    // Only what the referrer tells the community about themselves.
    await expect(applicant.getByText('Bramble referred you.')).toBeVisible()
    await join(applicant)

    // Used: gone from the referrer's links, and no good to anyone else.
    await page.reload()
    await expect(page.locator('#referrals')).toHaveCount(0)
    const latecomer = await (await browser.newContext()).newPage()
    await signIn(latecomer, uniqueEmail('late'), `${link.pathname}${link.search}`)
    await expect(latecomer.getByText('That referral link has been used, or has expired.')).toBeVisible()
    // Here, where nobody needs a referral, a dead link stands in nobody's way.
    await join(latecomer)
  })

  test('keeps a referral link through a sign-in that did not work', async ({ page }) => {
    await page.goto('/?referral=kept-for-later')
    await page.getByRole('link', { name: 'Sign In' }).click()
    await page.getByRole('link', { name: /cancel/i }).click()
    await expect(page.getByText('You cancelled signing in.')).toBeVisible()
    expect(new URL(page.url()).searchParams.get('referral')).toBe('kept-for-later')
  })

  test('publishes its API, Kubernetes style', async ({ request }) => {
    expect(await (await request.get('/api')).json()).toMatchObject({ kind: 'APIVersions', versions: ['v1alpha1'] })
    const resources = await (await request.get('/api/v1alpha1')).json()
    expect(resources.resources.map((resource: { name: string }) => resource.name)).toEqual(['claimsreviews'])
    expect(await (await request.get('/api/openapi/v3')).json()).toMatchObject({ openapi: '3.1.0' })
  })
})

test.describe("an organization's rules for joining", () => {
  // The same build, running examples/admission on top of members' own rules.
  test.use({ baseURL: CLUB })

  /** A founder, added the way an organization adds its first members. */
  const founder = (email: string) =>
    execFileSync(process.execPath, [path.join(ROOT, 'lib', 'cli.ts'), 'members', 'add', '--sub', email, '--email', email], {
      cwd: ROOT,
      env: { ...process.env, FG_MEMBERS_DATA_DIR: 'e2e/.club', FG_MEMBERS_EMBEDDED_DATABASE_PORT: '54422' },
      stdio: 'ignore',
    })

  test('asks where someone lives, because they depend on it', async ({ page }) => {
    await page.goto('/')
    const asked = page.waitForRequest((request) => request.url().startsWith(MOCK_ID) && request.url().includes('scope='))
    await page.getByRole('link', { name: 'Sign In' }).click()
    const scope = new URL((await asked).url()).searchParams.get('scope')
    expect(scope?.split(' ')).toEqual(['openid', 'email', 'profile', 'residential_address'])
  })

  test('tell an applicant everything they need to do first', async ({ page }) => {
    await signIn(page, uniqueEmail('nowhere-unverified'))
    await expect(page.getByText('Before you can join:')).toBeVisible()
    await expect(page.getByText('Verify your email address in your account first.')).toBeVisible()
    await expect(page.getByText('A member needs to refer you. Ask one for a referral link.')).toBeVisible()
    await expect(page.getByText('Share where you live with Members, so we can check it is in Minneapolis.')).toBeVisible()
    // What to do about it: share what was held back, fix it at the id service, and look again.
    await expect(page.getByRole('link', { name: 'Share More With Members' })).toHaveAttribute('href', /consent/)
    await expect(page.getByRole('link', { name: 'Go to Your Account' })).toHaveAttribute('href', `${MOCK_ID}/account`)
    await expect(page.getByRole('link', { name: 'Check Again' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Join' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'policy' })).toHaveAttribute('href', `${MOCK_ID}/policy`)
  })

  test('admit a neighbour an active member referred, on probation', async ({ page, browser }) => {
    const email = uniqueEmail('founder')
    founder(email)
    await signIn(page, email)
    const link = await referralLink(page)

    const applicant = await (await browser.newContext()).newPage()
    await signIn(applicant, uniqueEmail('neighbour'), `${link.pathname}${link.search}`)
    await expect(applicant.getByText('You can join now, as a probationary member.')).toBeVisible()
    await join(applicant)
    await expect(applicant.getByText('Probationary')).toBeVisible()

    // A probationary member's referral does not count.
    const second = await referralLink(applicant)
    const next = await (await browser.newContext()).newPage()
    await signIn(next, uniqueEmail('second'), `${second.pathname}${second.search}`)
    await expect(next.getByText('A member needs to refer you. Ask one for a referral link.')).toBeVisible()
  })

  test('admit only people who live in the area', async ({ page, browser }) => {
    const email = uniqueEmail('founder')
    founder(email)
    await signIn(page, email)
    const link = await referralLink(page)

    const applicant = await (await browser.newContext()).newPage()
    await signIn(applicant, uniqueEmail('far'), `${link.pathname}${link.search}`)
    await expect(applicant.getByText('Membership is open to people who live in Minneapolis.')).toBeVisible()
    await expect(applicant.getByRole('button', { name: 'Join' })).toHaveCount(0)
    // They shared where they live; sharing again would not change it.
    await expect(applicant.getByRole('link', { name: 'Share More With Members' })).toHaveCount(0)
  })
})
