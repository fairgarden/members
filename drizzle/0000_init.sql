CREATE TABLE "members_members" (
	"sub" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"nickname" text,
	"pronouns" text,
	"bio" text,
	"status" text DEFAULT 'active' NOT NULL,
	"roles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
