package fairgarden.members.admission_test

import data.fairgarden.members
import rego.v1

applicant := {"email": "new@example.com", "email_verified": true, "name": "New", "residential_address": {"country": "US", "postal_code": "55401"}}

referral := {"by": {"name": "old", "status": "active", "roles": [], "since": "2025-01-01T00:00:00Z"}}

joining(who, extra) := object.union({"user": {"name": "new"}, "purpose": "Join", "applicant": who}, extra)

test_a_referred_neighbour_joins_on_probation if {
	members.admit == {"allow": true, "status": "probationary", "reasons": {}} with input as joining(applicant, {"referral": referral})
}

test_every_requirement_is_listed_at_once if {
	decision := members.admit with input as joining({"email": "new@example.com", "email_verified": false, "name": null}, {})
	not decision.allow
	decision.reasons == {
		"email": "Verify your email address in your account first.",
		"referral": "A member needs to refer you. Ask one for a referral link.",
		"area": "Share where you live with Members, so we can check it is in Minneapolis.",
	}
}

test_a_probationary_member_cannot_refer if {
	probationary := {"by": object.union(referral.by, {"status": "probationary"})}
	decision := members.admit with input as joining(applicant, {"referral": probationary})
	object.keys(decision.reasons) == {"referral"}
}

test_only_neighbours_join if {
	far := object.union(applicant, {"residential_address": {"postal_code": "94110"}})
	decision := members.admit with input as joining(far, {"referral": referral})
	decision.reasons == {"area": "Membership is open to people who live in Minneapolis."}
}

test_a_postal_code_is_needed_to_tell if {
	vague := object.union(object.remove(applicant, ["residential_address"]), {"residential_address": {"locality": "Minneapolis"}})
	decision := members.admit with input as joining(vague, {"referral": referral})
	decision.reasons == {"area": "Add a postal code to where you live, in your account, so we can check it is in Minneapolis."}
}

test_without_its_settings_nobody_is_in_the_area if {
	decision := members.admit with input as joining(applicant, {"referral": referral}) with data.fairgarden.members.settings as {}
	decision.reasons == {"area": "Membership is open to people who live in the club's area."}
}

test_members_asks_where_you_live if {
	members.scopes.scopes == ["openid", "email", "profile", "residential_address"]
}
