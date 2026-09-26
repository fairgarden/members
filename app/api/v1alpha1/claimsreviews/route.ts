import { reviewClaims } from '@fairgarden/members/lib/claims-reviews'

// The id service asks here for the `membership` claims — see lib/claims-reviews.ts.
export const POST = reviewClaims
