# An organization's rules for joining: the Example Club's bylaws on
# membership, as policy. Not members' own rules — an example of what an
# organization writes in its own policies/, in members' package, adding to
# what members asks: `admit`, and the id service scopes it needs.
#
#   fg-policy build --base apps/members/policies --dir apps/members/examples/admission
package fairgarden.members

import rego.v1

# Article II §1: new members join on probation.
status := "probationary"

# Article II §2: with an email address the id service has verified.
unmet["email"] := "Verify your email address in your account first." if not input.applicant.email_verified

# Article II §3: referred by an active member.
unmet["referral"] := "A member needs to refer you. Ask one for a referral link." if {
	not input.referral.by.status == "active"
}

# Article II §4: living in the area, which needs where you live, from your
# account — so Members asks for it. (`address` is where you receive post.)
extra_scopes contains "residential_address"

unmet["area"] := sprintf("Share where you live with Members, so we can check it is in %s.", [club_area.name]) if {
	not input.applicant.residential_address
}

unmet["area"] := sprintf("Add a postal code to where you live, in your account, so we can check it is in %s.", [club_area.name]) if {
	input.applicant.residential_address
	not input.applicant.residential_address.postal_code
}

unmet["area"] := sprintf("Membership is open to people who live in %s.", [club_area.name]) if {
	input.applicant.residential_address.postal_code
	not in_club_area
}

# Helpers in members' package are named for the club, so none collides with
# a rule members adds later.
club_area := data.fairgarden.members.settings.area

# Without the settings, nowhere is in the area: better nobody joins than anybody.
default club_area := {"name": "the club's area", "postal_codes": []}

# Where they live is as they gave it: the id service does not verify it.
in_club_area if {
	some prefix in club_area.postal_codes
	startswith(input.applicant.residential_address.postal_code, prefix)
}
