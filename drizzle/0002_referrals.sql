CREATE TABLE "members_referrals" (
	"id" text PRIMARY KEY NOT NULL,
	"referrer" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_by" text,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "members_members" ADD COLUMN "referred_by" text;--> statement-breakpoint
ALTER TABLE "members_referrals" ADD CONSTRAINT "members_referrals_referrer_members_members_sub_fk" FOREIGN KEY ("referrer") REFERENCES "public"."members_members"("sub") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "members_referrals_referrer" ON "members_referrals" USING btree ("referrer","created_at" DESC NULLS LAST);