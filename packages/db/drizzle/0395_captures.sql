CREATE TABLE "captures" (
	"id" serial NOT NULL,
	"platform" varchar(16) NOT NULL,
	"ref" varchar(255) NOT NULL,
	"person" text NOT NULL,
	"sources" text[] NOT NULL,
	"url" text NOT NULL,
	"author" varchar(200),
	"lists" text[] DEFAULT '{}' NOT NULL,
	"raw" jsonb NOT NULL,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"filed_at" timestamp with time zone,
	"records" text[],
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	CONSTRAINT "pk_captures" PRIMARY KEY("id"),
	CONSTRAINT "uq_captures_platform_ref_person" UNIQUE("platform","ref","person"),
	CONSTRAINT "ck_captures_platform" CHECK (("platform")::text = ANY ((ARRAY['instagram'::character varying, 'x'::character varying, 'youtube'::character varying, 'linkedin'::character varying])::text[]))
);
--> statement-breakpoint
ALTER TABLE "captures" ADD CONSTRAINT "fk_captures_platform_ref_platform_objects" FOREIGN KEY ("platform","ref") REFERENCES "public"."platform_objects"("platform","ref") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "ix_captures_filed_at" ON "captures" USING btree ("filed_at","first_seen");