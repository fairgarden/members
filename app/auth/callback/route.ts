import { completeSignIn } from '@fairgarden/members/lib/auth'
import { getConfig } from '@fairgarden/members/lib/config'
import { refreshMember } from '@fairgarden/members/lib/members'
import { startSession, takeFlow } from '@fairgarden/members/lib/session'

// Back from the id service: check what it sent, and start a session.
export const GET = async (request: Request) => {
  const { url } = getConfig()
  const search = new URL(request.url).search
  const flow = await takeFlow()
  if (!flow) return Response.redirect(`${url}/?error=expired`, 303)

  // Back where they started — a referral link, say — with what went wrong.
  const failed = (error: string) => {
    const back = new URL(`${url}${flow.returnTo}`)
    back.searchParams.set('error', error)
    return Response.redirect(back.href, 303)
  }

  const params = new URLSearchParams(search)
  // Most often, the person cancelled signing in.
  if (params.has('error')) return failed(params.get('error')!)

  try {
    const session = await completeSignIn(search, flow)
    // Membership is kept by email address; without it there is nothing to keep.
    if (!session.email) return failed('email_needed')
    await refreshMember(session.sub, session.email, session.name)
    await startSession(session)
    return Response.redirect(`${url}${flow.returnTo}`, 303)
  } catch (error) {
    console.error('[members] sign-in failed', error)
    return failed('sign_in_failed')
  }
}
