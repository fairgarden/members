package fairgarden.members_test

import data.fairgarden.members
import rego.v1

membership := {"membership": {"status": "active", "since": "2026-01-01T00:00:00Z", "roles": ["steward"]}}

asked_by(client) := {"user": {"name": "a"}, "client": {"id": client, "name": client}, "purpose": "Release", "claims": membership}

applying := {
	"user": {"name": "new"},
	"purpose": "Join",
	"applicant": {"email": "new@example.com", "email_verified": true, "name": "New"},
}

test_everything_is_released_by_default if {
	decision := members.release with input as asked_by("events")
	decision.claims == membership
	decision.reasons == {}
}

test_anyone_may_join_by_default if {
	members.admit == {"allow": true, "status": "active", "reasons": {}} with input as applying
}

test_only_what_membership_needs_is_asked_for_by_default if {
	members.scopes == {"scopes": ["openid", "email", "profile"]}
}

# The extension points, filled in as an organization's rules would.

test_a_claim_withheld_is_kept_and_explained if {
	decision := members.release with input as asked_by("shop")
		with members.withheld as {"membership": "Only Events can see your membership."}
	decision.claims == {}
	decision.reasons == {"membership": "Only Events can see your membership."}
}

test_part_of_a_claim_may_be_withheld if {
	decision := members.release with input as asked_by("shop")
		with members.withheld as {"membership.roles": "Roles are for Events only."}
	decision.claims == {"membership": {"status": "active", "since": "2026-01-01T00:00:00Z"}}
	decision.reasons == {"membership.roles": "Roles are for Events only."}
}

test_anything_unmet_stops_someone_joining_and_says_why if {
	decision := members.admit with input as applying with members.unmet as {"referral": "A member needs to refer you."}
	not decision.allow
	decision.reasons == {"referral": "A member needs to refer you."}
}

test_new_members_may_start_on_probation if {
	decision := members.admit with input as applying with members.status as "probationary"
	decision.status == "probationary"
}

test_more_may_be_asked_for if {
	members.scopes == {"scopes": ["openid", "email", "profile", "address"]} with members.extra_scopes as {"address"}
}
