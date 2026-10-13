CREATE TABLE "blog_posts" (
	"slug" varchar(80) NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"body" text NOT NULL,
	"date" date NOT NULL,
	"draft" boolean DEFAULT true NOT NULL,
	"published_at" timestamp with time zone,
	"emailed_at" timestamp with time zone,
	"commit_sha" varchar(40),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "pk_blog_posts" PRIMARY KEY("slug")
);
--> statement-breakpoint
CREATE INDEX "ix_blog_posts_published_at" ON "blog_posts" USING btree ("published_at");