CREATE TABLE "client_secret_events" (
	"id" bigserial NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"secret" varchar(35) NOT NULL,
	"client" varchar(40) NOT NULL,
	"name" varchar(64) NOT NULL,
	"op" varchar(8) NOT NULL,
	"by" varchar(320) NOT NULL,
	"why" text,
	CONSTRAINT "pk_client_secret_events" PRIMARY KEY("id"),
	CONSTRAINT "ck_client_secret_events_op" CHECK (("op")::text = ANY ((ARRAY['stage'::character varying, 'bind'::character varying, 'put'::character varying, 'rotate'::character varying, 'read'::character varying, 'delete'::character varying, 'expire'::character varying, 'rewrap'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "client_secrets" (
	"id" varchar(35) NOT NULL,
	"client" varchar(40) NOT NULL,
	"name" varchar(64) NOT NULL,
	"state" varchar(8) NOT NULL,
	"kid" varchar(16) NOT NULL,
	"wrapped" "bytea" NOT NULL,
	"sealed" "bytea" NOT NULL,
	"last4" varchar(4) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"bound_from" varchar(35),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" varchar(320) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" varchar(320) NOT NULL,
	CONSTRAINT "pk_client_secrets" PRIMARY KEY("id"),
	CONSTRAINT "ck_client_secrets_state" CHECK (("state")::text = ANY ((ARRAY['staged'::character varying, 'live'::character varying])::text[]))
);
--> statement-breakpoint
ALTER TABLE "client_secrets" ADD CONSTRAINT "fk_client_secrets_client" FOREIGN KEY ("client") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_client_secret_events_client_at" ON "client_secret_events" USING btree ("client","at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_client_secrets_live" ON "client_secrets" USING btree ("client","name") WHERE "client_secrets"."state" = 'live';