import { createHref } from '@fairgarden/monolith/link'

// Every path to this app's own routes goes through this — links, form actions,
// redirects — so it carries the mount point when the app is served inside a
// monolith. On its own the mount is empty and a path comes back unchanged.
export const href = createHref('@fairgarden/members')
