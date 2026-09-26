import { beforeAll, describe, expect, it } from 'vitest'
import { reviewClaims } from '@fairgarden/members/lib/claims-reviews'
import { admitMember, updateProfile } from '@fairgarden/members/lib/members'
import { useDatabase } from './helpers/database'
import { useIssuer } from './helpers/issuer'

describe('claims reviews from the id service', () => {
  useDatabase()
  const { review, strangerKey } = useIssuer()

  beforeAll(async () => {
    await admitMember({ sub: 'member-1', email: 'one@example.com', name: 'Member One', status: 'active' })
    await updateProfile('member-1', { nickname: 'Uno', pronouns: 'they/them', bio: 'Private, never released.' })
  })

  const answer = async (request: Request) => {
    const response = await reviewClaims(request)
    return { status: response.status, body: await response.json() }
  }

  it('answers with the membership, echoing the review it was sent', async () => {
    const request = await review('member-1', { uid: 'review-1' })
    const { status, body } = await answer(request)
    expect(status).toBe(200)
    expect(body).toEqual({
      apiVersion: 'id.fairgarden.org/v1alpha1',
      kind: 'ClaimsReview',
      response: {
        uid: 'review-1',
        claims: {
          membership: {
            status: 'active',
            since: expect.any(String),
            roles: [],
            nickname: 'Uno',
            pronouns: 'they/them',
          },
        },
      },
    })
  })

  it('answers with nothing for someone who is not a member, or claims it does not keep', async () => {
    expect((await answer(await review('stranger'))).body.response.claims).toEqual({})
    expect((await answer(await review('member-1', { claims: ['shoe_size'] }))).body.response.claims).toEqual({})
  })

  it.each([
    ['without a token', async () => new Request('http://members.test/', { method: 'POST', body: '{}' }), 401],
    ['signed by someone else', async () => review('member-1', { signed: { key: strangerKey() } }), 401],
    ['meant for another service', async () => review('member-1', { signed: { audience: 'events' } }), 401],
    ['that is an ID token, not a review', async () => review('member-1', { signed: { typ: 'JWT' } }), 401],
    ['whose body does not match its token', async () => review('member-1', { uid: 'a', tokenUid: 'b' }), 403],
  ])('refuses a review %s', async (_what, make, status) => {
    const response = await reviewClaims(await make())
    expect(response.status).toBe(status)
    expect(await response.json()).toMatchObject({ kind: 'Status', status: 'Failure', code: status })
  })
})
