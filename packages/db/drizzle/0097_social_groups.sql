CREATE TABLE "social_groups" (
	"id" serial NOT NULL,
	"network" varchar(16) NOT NULL,
	"ref" varchar(100) NOT NULL,
	"niche" varchar(32) NOT NULL,
	"keyword" text NOT NULL,
	"name" text,
	"url" text NOT NULL,
	"about" jsonb,
	"hit" jsonb NOT NULL,
	"error" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_social_groups" PRIMARY KEY("id"),
	CONSTRAINT "uq_social_groups_ref" UNIQUE("network","ref"),
	CONSTRAINT "ck_social_groups_socialnetwork" CHECK (("network")::text = ANY ((ARRAY['facebook'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "social_posts" (
	"id" serial NOT NULL,
	"network" varchar(16) NOT NULL,
	"group_id" integer NOT NULL,
	"ref" varchar(32) NOT NULL,
	"url" text NOT NULL,
	"author" text,
	"posted" text,
	"text" text,
	"raw" jsonb NOT NULL,
	"company_id" integer,
	"person_id" integer,
	"mapped_by" varchar(16),
	"error" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_social_posts" PRIMARY KEY("id"),
	CONSTRAINT "uq_social_posts_ref" UNIQUE("network","ref"),
	CONSTRAINT "ck_social_posts_socialnetwork" CHECK (("network")::text = ANY ((ARRAY['facebook'::character varying])::text[])),
	CONSTRAINT "ck_social_posts_postmapping" CHECK (("mapped_by")::text = ANY ((ARRAY['link'::character varying, 'author'::character varying, 'name'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "social_searches" (
	"id" serial NOT NULL,
	"network" varchar(16) NOT NULL,
	"niche" varchar(32) NOT NULL,
	"keyword" text NOT NULL,
	"n" integer NOT NULL,
	"groups" integer NOT NULL,
	"answer" jsonb NOT NULL,
	"searched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_social_searches" PRIMARY KEY("id"),
	CONSTRAINT "ck_social_searches_socialnetwork" CHECK (("network")::text = ANY ((ARRAY['facebook'::character varying])::text[]))
);
--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "fk_social_posts_group_id_social_groups" FOREIGN KEY ("group_id") REFERENCES "public"."social_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "fk_social_posts_company_id_companies" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "fk_social_posts_person_id_people" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_social_groups_niche_read" ON "social_groups" USING btree ("niche","read_at");--> statement-breakpoint
CREATE INDEX "ix_social_posts_group_id" ON "social_posts" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "ix_social_posts_company_id" ON "social_posts" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "ix_social_posts_person_id" ON "social_posts" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "ix_social_posts_read_at" ON "social_posts" USING btree ("read_at");--> statement-breakpoint
CREATE INDEX "ix_social_searches_keyword" ON "social_searches" USING btree ("network","niche","keyword","searched_at");