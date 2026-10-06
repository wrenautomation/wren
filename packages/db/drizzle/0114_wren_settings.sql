CREATE TABLE "wren_settings" (
	"component" varchar(64) NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" varchar(320),
	CONSTRAINT "pk_wren_settings" PRIMARY KEY("component")
);
