// Kubernetes-style discovery: the versions this API serves.
export const GET = () =>
  Response.json({ apiVersion: 'v1', kind: 'APIVersions', versions: ['v1alpha1'] })
