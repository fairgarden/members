import { generateKeyPairSync, randomUUID } from 'node:crypto'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { SignJWT, type JWK } from 'jose'
import { afterAll, beforeAll } from 'vitest'

/**
 * Just enough of the id service for members to trust it: a discovery
 * document and a JWKS, and the signed requests it sends with ClaimsReviews.
 */
export const useIssuer = () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const publicJwk = { ...(publicKey.export({ format: 'jwk' }) as JWK), kid: 'test', alg: 'RS256', use: 'sig' }
  const issuer = { url: '', server: undefined as unknown as http.Server }

  beforeAll(async () => {
    issuer.server = http.createServer((req, res) => {
      res.setHeader('content-type', 'application/json')
      if (req.url === '/.well-known/openid-configuration') {
        return res.end(
          JSON.stringify({
            issuer: issuer.url,
            jwks_uri: `${issuer.url}/jwks`,
            authorization_endpoint: `${issuer.url}/auth`,
            token_endpoint: `${issuer.url}/token`,
            response_types_supported: ['code'],
            subject_types_supported: ['public'],
            id_token_signing_alg_values_supported: ['RS256'],
          })
        )
      }
      if (req.url === '/jwks') return res.end(JSON.stringify({ keys: [publicJwk] }))
      res.statusCode = 404
      res.end('{}')
    })
    await new Promise<void>((resolve) => issuer.server.listen(0, '127.0.0.1', resolve))
    issuer.url = `http://127.0.0.1:${(issuer.server.address() as AddressInfo).port}`
    process.env.FG_MEMBERS_ID_URL = issuer.url
    process.env.FG_MEMBERS_CLIENT_ID = 'members'
  })

  afterAll(() => {
    issuer.server?.close()
  })

  /** A signed claims review request, with anything overridden. */
  const token = (
    { sub, jti }: { sub: string; jti: string },
    { typ = 'fg-claims-review+jwt', audience = 'members', key = privateKey, issuerUrl = '' } = {}
  ) =>
    new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: 'test', typ })
      .setIssuer(issuerUrl || issuer.url)
      .setAudience(audience)
      .setSubject(sub)
      .setJti(jti)
      .setIssuedAt()
      .setExpirationTime('60s')
      .sign(key)

  interface ReviewOptions {
    claims?: string[]
    client?: { id: string; name: string }
    purpose?: string
    /** Overrides for the signed token. */
    signed?: Parameters<typeof token>[1]
    uid?: string
    /** The token's `jti`, when it should not match the body's uid. */
    tokenUid?: string
  }

  /** A ClaimsReview, as the id service would send it. */
  const review = async (subject: string, options: ReviewOptions = {}) => {
    const {
      claims = ['membership'],
      client = { id: 'events', name: 'Events' },
      purpose = 'Release',
      signed = {},
      uid = randomUUID(),
    } = options
    const tokenUid = options.tokenUid ?? uid
    return new Request('http://members.test/api/v1alpha1/claimsreviews', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${await token({ sub: subject, jti: tokenUid }, signed)}`,
      },
      body: JSON.stringify({
        apiVersion: 'id.fairgarden.org/v1alpha1',
        kind: 'ClaimsReview',
        request: { uid, purpose, subject, client, scopes: ['membership'], claims },
      }),
    })
  }

  return { issuer, token, review, strangerKey: () => generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey }
}
