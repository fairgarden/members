import { signOutUrl } from '@fairgarden-private/members/lib/auth'
import { getConfig } from '@fairgarden-private/members/lib/config'
import { currentSession, endSession } from '@fairgarden-private/members/lib/session'

// Sign out here, then at the id service, which asks the person to confirm
// and sends them back. Only from this service's own pages: another site's
// form cannot sign anyone out.
export const POST = async (request: Request) => {
  const origin = request.headers.get('origin')
  if (origin && origin !== new URL(getConfig().url).origin) {
    return new Response('Sign out from this service.', { status: 403 })
  }
  const session = await currentSession()
  await endSession()
  return Response.redirect(await signOutUrl(session?.idToken), 303)
}
