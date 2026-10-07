CREATE TABLE "saved_views" (
	"id" serial NOT NULL,
	"workspace" varchar(64) NOT NULL,
	"viewer" varchar(200) NOT NULL,
	"record" varchar(64) NOT NULL,
	"name" varchar(60) NOT NULL,
	"params" text NOT NULL,
	"shared" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_saved_views" PRIMARY KEY("id")
);
--> statement-breakpoint
CREATE TABLE "snippets" (
	"id" serial NOT NULL,
	"workspace" varchar(64) NOT NULL,
	"title" varchar(120) NOT NULL,
	"body" text NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"channel" varchar(16),
	"created_by" varchar(200) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_snippets" PRIMARY KEY("id")
);
--> statement-breakpoint
CREATE TABLE "viewer_prefs" (
	"workspace" varchar(64) NOT NULL,
	"viewer" varchar(200) NOT NULL,
	"key" varchar(100) NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_viewer_prefs" PRIMARY KEY("workspace","viewer","key")
);
--> statement-breakpoint
CREATE INDEX "ix_saved_views_workspace_record" ON "saved_views" USING btree ("workspace","record","position");--> statement-breakpoint
CREATE INDEX "ix_snippets_workspace" ON "snippets" USING btree ("workspace","title");