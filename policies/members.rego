# METADATA
# title: Your membership
# description: >-
#   Who may join, and what other services learn about your membership when
#   you let them.
package fairgarden.members

import rego.v1

# The members service's decisions, as it ships them: the questions it asks,
# what it asks them with, and places for an organization's own rules. As
# shipped they decide what members' built-in rules do.
#
# An organization builds its policy on top (fg-dist policy build), writing
# its own rules — its bylaws on who may join, say — in its own files in this
# package, where they add to these:
#
#   unmet[<requirement>] := <reason>   something an applicant must do before
#                                      they may join, in words they are shown
#   status := <status>                 what new members join as: "active",
#                                      unless it says "probationary"
#   extra_scopes contains <scope>      more to ask the id service for when
#                                      someone signs in, such as "address"
#   withheld[<claim>] := <reason>      a claim kept from a service; a dotted
#                                      key, such as "membership.roles", keeps
#                                      back part of one
#
# Upgrading members brings this file's changes and keeps the organization's.
# examples/admission is an organization's rules for joining, to start from.

# `release` is asked when a service you are signing in to wants your
# membership: which claims go to it, and why not the rest. Each reason is
# shown to you while you decide whether to share your membership.
#
# input.user     {name}          the member, as their `sub`
# input.client   {id, name}      the service the claims are for
# input.purpose  Preview | Release
# input.claims   {membership: {status, since, roles, nickname?, pronouns?}}

# METADATA
# title: What services learn about your membership
# description: >-
#   Services you share your membership with see all of it, except what is
#   withheld from them here, with the reason.
# entrypoint: true
release := {"claims": json.remove(input.claims, [replace(claim, ".", "/") | some claim, _ in withheld]), "reasons": withheld}

# Nothing, until an organization adds to it.
withheld[claim] := reason if {
	false
	claim := ""
	reason := ""
}

# `admit` is asked when someone signs in who is not a member yet: whether they
# may join, and if not, what they need to do first. It is asked again when
# they ask to join.
#
# input.user       {name}  the applicant, as their `sub`
# input.purpose    Preview (the join page is shown) | Join (they asked to)
# input.applicant  {email, email_verified, name, address?, residential_address?}
#                  what the id service vouches for. `address` is where they
#                  receive post, `residential_address` where they live; each
#                  as they gave it, and only there when they chose to share
#                  it — ask for it with extra_scopes
# input.referral   {by: {name, status, roles, since}}  the member who
#                  referred them, when one did

# METADATA
# title: Who may join
# description: >-
#   Anyone who signs in may join, unless the organization's rules say they
#   must do something first; then you are told what.
# entrypoint: true
admit := {"allow": count(unmet) == 0, "status": status, "reasons": unmet}

default status := "active"

# Nothing, until an organization adds to it.
unmet[requirement] := reason if {
	false
	requirement := ""
	reason := ""
}

# `scopes` is asked when someone signs in: what members asks the id service
# to share. You still choose, on the id service's own page.

# METADATA
# title: What Members asks your account for
# description: >-
#   Your email address and name, which membership needs, and anything the
#   organization's rules for joining read.
# entrypoint: true
scopes := {"scopes": array.concat(["openid", "email", "profile"], sort(extra_scopes))}

# Nothing, until an organization adds to it.
extra_scopes contains scope if {
	false
	scope := ""
}
