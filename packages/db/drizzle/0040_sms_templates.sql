CREATE TABLE "sms_templates" (
	"key" varchar(120) PRIMARY KEY NOT NULL,
	"body" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" varchar(200) NOT NULL
);
