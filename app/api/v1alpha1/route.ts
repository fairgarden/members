// Kubernetes-style discovery: every resource, and the verbs each takes.
export const GET = () =>
  Response.json({
    apiVersion: 'v1',
    kind: 'APIResourceList',
    groupVersion: 'members.fairgarden.org/v1alpha1',
    resources: [
      {
        name: 'claimsreviews',
        singularName: 'claimsreview',
        namespaced: false,
        group: 'id.fairgarden.org',
        version: 'v1alpha1',
        kind: 'ClaimsReview',
        verbs: ['create'],
      },
    ],
  })
