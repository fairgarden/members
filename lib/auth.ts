import * as client from 'openid-client'
import { getConfig } from './config.ts'
import { requestedScopes, type Address } from './policy.ts'
import type { Flow } from './session.ts'

/**
 * Signing in with the id service, as an ordinary OpenID Connect client:
 * authorization code with PKCE, a confidential client when it has a secret.
 * What it asks for is the policy's `scopes` decision: an address, say, only
 * when the organization's rules for joining read one.
 */

let discovered: Promise<client.Configuration> | undefined

export const oidcConfiguration = (): Promise<client.Configuration> => {
  const { issuer, clientId, clientSecret } = getConfig()
  discovered ??= client
    .discovery(
      new URL(issuer),
      clientId,
      undefined,
      clientSecret ? client.ClientSecretBasic(clientSecret) : client.None(),
      // An http issuer is only ever local development.
      issuer.startsWith('http:') ? { execute: [client.allowInsecureRequests] } : undefined
    )
    .catch((error: unknown) => {
      discovered = undefined
      throw error
    })
  return discovered
}

const callbackUrl = () => `${getConfig().url}/auth/callback`

/**
 * Where to send the browser to sign in, and what to remember until it is
 * back. `consent` asks the person again what to share, for when they
 * declined something joining needs.
 */
export const beginSignIn = async (returnTo: string, { consent = false } = {}): Promise<{ url: URL; flow: Flow }> => {
  const configuration = await oidcConfiguration()
  const verifier = client.randomPKCECodeVerifier()
  const flow: Flow = {
    verifier,
    state: client.randomState(),
    nonce: client.randomNonce(),
    returnTo,
  }
  const url = client.buildAuthorizationUrl(configuration, {
    redirect_uri: callbackUrl(),
    scope: (await requestedScopes()).join(' '),
    ...(consent ? { prompt: 'consent' } : {}),
    code_challenge: await client.calculatePKCECodeChallenge(verifier),
    code_challenge_method: 'S256',
    state: flow.state,
    nonce: flow.nonce,
  })
  return { url, flow }
}

/** Exchange the code the id service sent back for who signed in. */
export const completeSignIn = async (search: string, flow: Flow) => {
  const configuration = await oidcConfiguration()
  // Rebuilt from the configured URL, so the redirect URI matches exactly
  // whatever proxy the request came through.
  const current = new URL(`${callbackUrl()}${search}`)
  const tokens = await client.authorizationCodeGrant(configuration, current, {
    pkceCodeVerifier: flow.verifier,
    expectedState: flow.state,
    expectedNonce: flow.nonce,
  })
  const claims = tokens.claims()!
  const addressIn = (value: unknown) => (value && typeof value === 'object' ? (value as Address) : undefined)
  const address = addressIn(claims.address)
  const residentialAddress = addressIn(claims.residential_address)
  return {
    sub: claims.sub,
    // Empty when they declined to share it, which membership cannot do without.
    email: typeof claims.email === 'string' ? claims.email : '',
    emailVerified: claims.email_verified === true,
    name: typeof claims.name === 'string' ? claims.name : null,
    ...(address ? { address } : {}),
    ...(residentialAddress ? { residentialAddress } : {}),
    idToken: tokens.id_token!,
  }
}

export const signOutUrl = async (idToken: string | undefined): Promise<URL> => {
  const configuration = await oidcConfiguration()
  return client.buildEndSessionUrl(configuration, {
    post_logout_redirect_uri: getConfig().url,
    ...(idToken ? { id_token_hint: idToken } : {}),
  })
}
