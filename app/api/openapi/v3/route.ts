import { getConfig } from '@fairgarden/members/lib/config'

// The OpenAPI 3.1 document for this service's API: so far, only the claims
// reviews the id service sends. Their schema is the id service's own; it is
// referenced rather than copied, so the two cannot drift.
export const GET = () => {
  const { url, issuer } = getConfig()
  const review = { $ref: `${issuer}/api/openapi/v3#/components/schemas/ClaimsReview` }
  const statusSchema = { $ref: `${issuer}/api/openapi/v3#/components/schemas/Status` }
  return Response.json({
    openapi: '3.1.0',
    info: {
      title: 'Members API',
      version: 'v1alpha1',
      description: 'What the members service answers. Resources follow Kubernetes API conventions.',
    },
    servers: [{ url }],
    paths: {
      '/api/v1alpha1/claimsreviews': {
        post: {
          operationId: 'createClaimsReview',
          summary: 'Supply the membership claims for a person',
          description:
            'Called by the id service when a person shares the `membership` scope with a service, or is shown what they would share.',
          security: [{ idService: [] }],
          requestBody: { required: true, content: { 'application/json': { schema: review } } },
          responses: {
            200: { description: 'The review, answered', content: { 'application/json': { schema: review } } },
            default: { description: 'An error', content: { 'application/json': { schema: statusSchema } } },
          },
          'x-kubernetes-action': 'create',
          'x-kubernetes-group-version-kind': { group: 'id.fairgarden.org', version: 'v1alpha1', kind: 'ClaimsReview' },
        },
      },
    },
    components: {
      securitySchemes: {
        idService: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: `Signed by ${issuer}; typ fg-claims-review+jwt, audience this service's client ID.`,
        },
      },
    },
  })
}
