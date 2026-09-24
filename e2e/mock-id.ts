import { generateKeyPairSync, randomUUID } from 'node:crypto'
import http from 'node:http'
import { importJWK, SignJWT, type JWK } from 'jose'
import Provider from 'oidc-provider'

/**
 * Stands in for the id service, so the members service's browser tests need
 * nothing but itself: an OpenID Provider (oidc-provider's own development
 * screens: any login, any password) that knows the members client, and
 * `POST /test/claimsreviews`, which signs a ClaimsReview the way the id
 * service does and sends it to members, returning what members answered.
 *
 * Whatever login is typed is the account and its email address, and it says
 * what the id service would vouch for: living in Minneapolis, unless it has
 * `far` in it (San Francisco) or `nowhere` (not shared); and a verified email,
 * unless it has `unverified`.
 *
 * Run with `node e2e/mock-id.ts`; Playwright starts it.
 */

const PORT = Number(process.env.MOCK_ID_PORT ?? 3121)
const ISSUER = `http://localhost:${PORT}`
// Every members server the tests run; the first is sent claims reviews.
const SERVERS = (process.env.MEMBERS_URLS ?? 'http://localhost:3120').split(',')
const MEMBERS = SERVERS[0]

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = { ...(privateKey.export({ format: 'jwk' }) as JWK), kid: 'mock-id', alg: 'RS256', use: 'sig' }

const provider = new Provider(ISSUER, {
  clients: [
    {
      client_id: 'members',
      client_secret: 'members-secret',
      redirect_uris: SERVERS.map((server) => `${server}/auth/callback`),
      post_logout_redirect_uris: SERVERS,
    },
  ],
  jwks: { keys: [jwk] } as never,
  cookies: { keys: ['mock-id'] },
  claims: {
    openid: ['sub'],
    email: ['email', 'email_verified'],
    profile: ['name'],
    residential_address: ['residential_address'],
  },
  conformIdTokenClaims: false,
  // Whatever is typed as the login is the account, and its email address.
  async findAccount(_ctx, sub) {
    return {
      accountId: sub,
      async claims() {
        return {
          sub,
          email: sub,
          email_verified: !sub.includes('unverified'),
          name: `Member ${sub.split('@')[0]}`,
          ...(sub.includes('nowhere')
            ? {}
            : {
                residential_address: sub.includes('far')
                  ? { locality: 'San Francisco', region: 'CA', postal_code: '94110', country: 'US' }
                  : { locality: 'Minneapolis', region: 'MN', postal_code: '55401', country: 'US' },
              }),
        }
      },
    }
  },
})
provider.on('server_error', (_ctx, error) => console.error('[mock-id]', error))

const signingKey = importJWK(jwk, 'RS256')

/** Sign and send a ClaimsReview to members, as the id service would. */
const sendReview = async (req: http.IncomingMessage, res: http.ServerResponse) => {
  let body = ''
  for await (const chunk of req) body += chunk
  const { subject, client = { id: 'events', name: 'Events' }, purpose = 'Release' } = JSON.parse(body)
  const uid = randomUUID()
  const token = await new SignJWT({ scope: 'membership' })
    .setProtectedHeader({ alg: 'RS256', kid: jwk.kid, typ: 'fg-claims-review+jwt' })
    .setIssuer(ISSUER)
    .setAudience('members')
    .setSubject(subject)
    .setJti(uid)
    .setIssuedAt()
    .setExpirationTime('60s')
    .sign(await signingKey)
  const answer = await fetch(`${MEMBERS}/api/v1alpha1/claimsreviews`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({
      apiVersion: 'id.fairgarden.org/v1alpha1',
      kind: 'ClaimsReview',
      request: { uid, purpose, subject, client, scopes: ['membership'], claims: ['membership'] },
    }),
  })
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify({ status: answer.status, uid, body: await answer.json() }))
}

const callback = provider.callback()

http
  .createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/test/claimsreviews') {
      sendReview(req, res).catch((error: unknown) => {
        res.statusCode = 500
        res.end(String(error))
      })
      return
    }
    if (req.url === '/health') return res.end('ok')
    callback(req, res)
  })
  .listen(PORT, () => console.info(`[mock-id] on ${ISSUER}, for ${SERVERS.join(', ')}`))
