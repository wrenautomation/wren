CREATE TABLE "grants" (
	"id" serial NOT NULL,
	"email" text NOT NULL,
	"client" varchar(40) NOT NULL,
	"verbs" text[] NOT NULL,
	"apps" text[],
	"channels" text[],
	"record" text,
	"until" timestamp with time zone,
	"uses_left" integer,
	"reason" text,
	"by" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_grants" PRIMARY KEY("id")
);
--> statement-breakpoint
CREATE TABLE "role_grants" (
	"id" serial NOT NULL,
	"role" varchar(64) NOT NULL,
	"verbs" text[] NOT NULL,
	"apps" text[],
	"channels" text[],
	"record" text,
	CONSTRAINT "pk_role_grants" PRIMARY KEY("id")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" varchar(64) NOT NULL,
	"client" varchar(40),
	"name" text NOT NULL,
	"about" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_roles" PRIMARY KEY("id")
);
--> statement-breakpoint
-- The built-in roles, so every seat and membership names a row before the foreign keys land.
INSERT INTO "roles" ("id", "name", "about") VALUES
	('admin', 'Admin', 'Does everything, on every client.'),
	('operator', 'Operator', 'Works its clients. No money, sends, installs or team.'),
	('owner', 'Owner', 'Runs the account: people, invoices, the look.'),
	('member', 'Member', 'Uses the apps and acts in them.'),
	('viewer', 'Viewer', 'Reads only.')
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
ALTER TABLE "client_members" DROP CONSTRAINT "ck_client_members_role";--> statement-breakpoint
ALTER TABLE "operators" DROP CONSTRAINT "ck_operators_role";--> statement-breakpoint
ALTER TABLE "client_members" ALTER COLUMN "role" SET DATA TYPE varchar(64);--> statement-breakpoint
ALTER TABLE "client_members" ALTER COLUMN "role" SET DEFAULT 'member';--> statement-breakpoint
ALTER TABLE "operators" ALTER COLUMN "role" SET DATA TYPE varchar(64);--> statement-breakpoint
ALTER TABLE "operators" ALTER COLUMN "role" SET DEFAULT 'admin';--> statement-breakpoint
ALTER TABLE "role_grants" ADD CONSTRAINT "fk_role_grants_role" FOREIGN KEY ("role") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_grants_email" ON "grants" USING btree ("email","client");--> statement-breakpoint
CREATE INDEX "ix_role_grants_role" ON "role_grants" USING btree ("role");--> statement-breakpoint
CREATE INDEX "ix_roles_client" ON "roles" USING btree ("client");--> statement-breakpoint
ALTER TABLE "client_members" ADD CONSTRAINT "fk_client_members_role" FOREIGN KEY ("role") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operators" ADD CONSTRAINT "fk_operators_role" FOREIGN KEY ("role") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_client_members_role" ON "client_members" USING btree ("role");--> statement-breakpoint
CREATE INDEX "ix_operators_role" ON "operators" USING btree ("role");