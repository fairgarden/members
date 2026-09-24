import { createRemoteJWKSet, jwtVerify } from 'jose'
import { getConfig } from './config.ts'
import { findMember, membershipClaim } from './members.ts'
import { oidcConfiguration } from './auth.ts'
import { decideRelease } from './policy.ts'

/**
 * `POST /api/v1alpha1/claimsreviews`: the id service asking for the claims
 * this service supplies — the `membership` scope — for someone who agreed to
 * share them with another service, or who is deciding whether to.
 *
 * The contract, `ClaimsReview`, is the id service's (see its OpenAPI
 * document's `webhooks`): it signs the request with its token key, and this
 * checks that against the JWKS it publishes before answering.
 */

const REVIEW_VERSION = 'id.fairgarden.org/v1alpha1'
const TOKEN_TYPE = 'fg-claims-review+jwt'

interface ClaimsReview {
  apiVersion: string
  kind: 'ClaimsReview'
  request?: {
    uid: string
    subject: string
    client: { id: string; name: string }
    claims: string[]
    scopes: string[]
    purpose: string
  }
}

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined

const keys = async () => {
  if (!jwks) {
    const { jwks_uri: uri } = (await oidcConfiguration()).serverMetadata()
    jwks = createRemoteJWKSet(new URL(uri!))
  }
  return jwks
}

const status = (code: number, reason: string, message: string) =>
  Response.json(
    { apiVersion: 'v1', kind: 'Status', metadata: {}, status: 'Failure', code, reason, message },
    { status: code, headers: { 'Cache-Control': 'no-store' } }
  )

export const reviewClaims = async (request: Request): Promise<Response> => {
  const token = /^Bearer (.+)$/.exec(request.headers.get('authorization') ?? '')?.[1]
  if (!token) return status(401, 'Unauthorized', 'A bearer token from the id service is required.')

  const { issuer, clientId } = getConfig()
  let payload
  try {
    ;({ payload } = await jwtVerify(token, await keys(), {
      issuer,
      audience: clientId,
      typ: TOKEN_TYPE,
      maxTokenAge: '2m',
    }))
  } catch {
    return status(401, 'Unauthorized', 'The token is not from the id service, or has expired.')
  }

  let review: ClaimsReview
  try {
    review = (await request.json()) as ClaimsReview
  } catch {
    return status(400, 'BadRequest', 'Send a ClaimsReview as JSON.')
  }
  const asked = review.request
  if (review.apiVersion !== REVIEW_VERSION || review.kind !== 'ClaimsReview' || !asked) {
    return status(422, 'Invalid', `Send a ${REVIEW_VERSION} ClaimsReview with a request.`)
  }
  // The body says nothing the signed token does not.
  if (asked.uid !== payload.jti || asked.subject !== payload.sub) {
    return status(403, 'Forbidden', 'The review does not match its token.')
  }

  const member = await findMember(asked.subject)
  const everything: Record<string, unknown> = {}
  if (member && asked.claims.includes('membership')) everything.membership = membershipClaim(member)

  // This service's policy has the last word on what leaves it, and says why.
  const { claims, reasons } = await decideRelease({
    user: { name: asked.subject },
    client: asked.client,
    purpose: asked.purpose,
    claims: everything,
  })

  return Response.json(
    {
      apiVersion: REVIEW_VERSION,
      kind: 'ClaimsReview',
      response: { uid: asked.uid, claims, ...(Object.keys(reasons).length ? { reasons } : {}) },
    },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
