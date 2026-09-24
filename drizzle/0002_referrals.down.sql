-- Undoes 0002_referrals.sql: referral links, and who referred each member.
DROP TABLE "members_referrals";--> statement-breakpoint
ALTER TABLE "members_members" DROP COLUMN "referred_by";
