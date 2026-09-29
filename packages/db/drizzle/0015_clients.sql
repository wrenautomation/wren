CREATE TABLE "clients" (
	"id" varchar(40) NOT NULL,
	"name" text NOT NULL,
	"database" varchar(63) NOT NULL,
	"accounts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"caps" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"portal_emails" text[] DEFAULT '{}'::text[] NOT NULL,
	"demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_clients" PRIMARY KEY("id"),
	CONSTRAINT "uq_clients_database" UNIQUE("database")
);
