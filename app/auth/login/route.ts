import { beginSignIn } from '@fairgarden/members/lib/auth'
import { saveFlow } from '@fairgarden/members/lib/session'

// Off to the id service to sign in; it comes back to /auth/callback.
// `?consent` asks the person again what to share.
export const GET = async (request: Request) => {
  const params = new URL(request.url).searchParams
  const returnTo = params.get('returnTo')
  const { url, flow } = await beginSignIn(returnTo?.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/', {
    consent: params.has('consent'),
  })
  await saveFlow(flow)
  return Response.redirect(url, 303)
}
