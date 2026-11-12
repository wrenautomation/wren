CREATE TABLE "agent_confirms" (
	"id" varchar(16) NOT NULL,
	"chat" text,
	"turn" text,
	"act" varchar(16) NOT NULL,
	"client" varchar(40) NOT NULL,
	"what" text NOT NULL,
	"args" jsonb NOT NULL,
	"key" varchar(64) NOT NULL,
	"state" varchar(8) DEFAULT 'pending' NOT NULL,
	"asked_by" text NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"used_at" timestamp with time zone,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_agent_confirms" PRIMARY KEY("id"),
	CONSTRAINT "ck_agent_confirms_act" CHECK (("act")::text = ANY ((ARRAY['send'::character varying, 'spend'::character varying, 'delete'::character varying, 'publish'::character varying])::text[])),
	CONSTRAINT "ck_agent_confirms_state" CHECK (("state")::text = ANY ((ARRAY['pending'::character varying, 'yes'::character varying, 'no'::character varying, 'used'::character varying])::text[]))
);
--> statement-breakpoint
CREATE INDEX "ix_agent_confirms_key" ON "agent_confirms" USING btree ("key","state");--> statement-breakpoint
CREATE INDEX "ix_agent_confirms_chat" ON "agent_confirms" USING btree ("chat","at");