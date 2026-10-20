CREATE TABLE "platform_object_refs" (
	"platform" varchar(16) NOT NULL,
	"alias" text NOT NULL,
	"ref" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_platform_object_refs" PRIMARY KEY("platform","alias")
);
--> statement-breakpoint
CREATE TABLE "platform_objects" (
	"platform" varchar(16) NOT NULL,
	"ref" varchar(255) NOT NULL,
	"kind" varchar(16) NOT NULL,
	"url" text,
	"post" varchar(255),
	"parent" varchar(255),
	"author" varchar(200),
	"at" timestamp with time zone,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_platform_objects" PRIMARY KEY("platform","ref"),
	CONSTRAINT "ck_platform_objects_kind" CHECK (("kind")::text = ANY ((ARRAY['post'::character varying, 'comment'::character varying, 'group'::character varying])::text[]))
);
--> statement-breakpoint
ALTER TABLE "platform_object_refs" ADD CONSTRAINT "fk_platform_object_refs_platform_ref_platform_objects" FOREIGN KEY ("platform","ref") REFERENCES "public"."platform_objects"("platform","ref") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "ix_platform_object_refs_platform_ref" ON "platform_object_refs" USING btree ("platform","ref");--> statement-breakpoint
CREATE INDEX "ix_platform_objects_platform_post" ON "platform_objects" USING btree ("platform","post");