CREATE TABLE "members_policy_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"path" text NOT NULL,
	"subject" text,
	"input" jsonb,
	"result" jsonb,
	"error" text,
	"labels" jsonb NOT NULL,
	"erased" jsonb,
	"evaluation_ns" bigint NOT NULL,
	"decided_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "members_policy_decisions_subject" ON "members_policy_decisions" USING btree ("subject","decided_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "members_policy_decisions_decided_at" ON "members_policy_decisions" USING btree ("decided_at");