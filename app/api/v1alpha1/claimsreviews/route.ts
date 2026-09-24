import { reviewClaims } from '@fairgarden-private/members/lib/claims-reviews'

// The id service asks here for the `membership` claims — see lib/claims-reviews.ts.
export const POST = reviewClaims
