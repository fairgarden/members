# Fair Garden Membership System

<!-- fg:version -->

Version **0.1.0-alpha.0**

<!-- /fg:version -->

The members service: what membership means here, and the profile members
choose to share with the community. Who a person is — their email, name,
phone and addresses — belongs to the id service; members signs in with it
like any other service and keeps only what the person agreed to share.

## Running it

```bash
pnpm dev            # http://localhost:3020, with apps/id on 3010
```

`.env.development` points at the id service and matches how
`apps/id/.env.development` enrols members. Without a database URL an embedded
Postgres starts in `.data/members`.

## Documentation

```bash
pnpm --filter @fairgarden/members-docs dev   # http://localhost:3035
```

## Testing

```bash
pnpm test                               # unit tests (vitest)
pnpm exec playwright install chromium   # once
pnpm test:e2e                           # browser tests (Playwright)
```

Nothing outside this repository is needed, not even the id service: the
browser tests sign in with `e2e/mock-id.ts`, an oidc-provider standing in for
it, which also sends signed claims reviews.

## Signing in

`/auth/login` sends the browser to the id service (authorization code with
PKCE), `/auth/callback` starts a session, kept in an encrypted cookie, and
`/auth/logout` ends it here and at the id service. Every setting is in
[.env.example](.env.example).

## Claims for other services

The id service enrols members with `FG_ID_SERVICE_MEMBERS_CLAIMS=membership`,
so the `membership` scope is this service's. When a person shares it with
another service, the id service POSTs a `ClaimsReview` to
`/api/v1alpha1/claimsreviews`; this checks the request's JWT against the id
service's JWKS and answers with the `membership` claim:

```json
{ "status": "active", "since": "2026-09-24T16:39:32.319Z", "roles": [], "nickname": "…", "pronouns": "…" }
```

Joining is the policy's decision: signing in does not make anyone a member.
Someone who is not one yet sees what joining takes — members asks `admit`
with what the id service vouches for about them and the member whose
referral link they came with — and joins at the status it gives, or is told
what stands in the way. What leaves the service is `release`'s decision; its
reasons go back in the review, and the id service shows them to the member.
Members makes referral links; `pnpm members add` adds founding members.

The built-in rules let anyone join and release everything.
[policies/members.rego](policies/members.rego) asks the same way, with places
for an organization's rules, which a distribution builds on top and members'
build copies in (`fg-dist policy use`). [examples/admission](examples/admission)
is an organization's rules for joining — probation, a verified email, a
referral from an active member, living in the area — to start from. Every
decision is recorded in `members_policy_decisions`, with the revision of the
policy that made it, and `pnpm policy:log` exports them as JSON lines.

The API follows Kubernetes conventions, with discovery at `/api` and
`/api/v1alpha1` and the OpenAPI document at `/api/openapi/v3`.

## Database

Drizzle, over `pg`, with the schema in `lib/schema.ts` and migrations in
`drizzle/`: `pnpm db:generate`, `db:migrate`, `db:rollback` and `db:status`
work as they do in the id service.

<!-- fg:releasing -->

## Releasing

This module releases on its own. `0.1.0-alpha.0` is what main is working towards,
not what is published — the version here is always the next one. Its release
notes are the top section of `CHANGELOG.md`, where every pull request adds a
line linking itself.

1. **Publish it.** Run the *Publish* workflow from the Actions tab, picking the
   dist tag. It refuses if that version is already on npm. Once it is out, open
   pull requests are held — their changelog check fails — so nothing is noted
   under a version that has already shipped.
2. **Start the next version.** `pnpm next-version` opens a pull request moving
   main to `0.1.0-alpha.1` and starting its section of the
   changelog, or `pnpm next-version --id rc` to change identifier. Merging it
   lifts the hold. A prerelease gets no maintenance branch; there is no
   released line behind it yet.

A held pull request goes on once it is brought up to date with main and its
line is moved into the new version's section.

Every push to main publishes `@fairgarden/members@canary`. A canary is not a release and
carries no promise; it is there so main can be tried without a checkout.

<!-- /fg:releasing -->
