CREATE TABLE "phone_consents" (
	"id" serial NOT NULL,
	"e164" varchar(16) NOT NULL,
	"whose" varchar(64) DEFAULT 'wren' NOT NULL,
	"source" varchar(16) NOT NULL,
	"text" text NOT NULL,
	"text_version" varchar(64) NOT NULL,
	"ai_voice" boolean DEFAULT false NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"given_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_phone_consents" PRIMARY KEY("id"),
	CONSTRAINT "ck_phone_consents_source" CHECK (("source")::text = ANY ((ARRAY['form'::character varying, 'manual'::character varying, 'import'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "voice_calls" (
	"id" serial NOT NULL,
	"whose" varchar(64) DEFAULT 'wren' NOT NULL,
	"direction" varchar(16) NOT NULL,
	"pipeline" varchar(200) NOT NULL,
	"ref" varchar(200) NOT NULL,
	"from_number" varchar(32) DEFAULT '' NOT NULL,
	"to_number" varchar(32) DEFAULT '' NOT NULL,
	"sms_contact_id" integer,
	"lead_name" text,
	"outcome" varchar(16) NOT NULL,
	"transcript" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"booking_id" integer,
	"message" text,
	"recording_key" text,
	"by" varchar(320),
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_voice_calls" PRIMARY KEY("id"),
	CONSTRAINT "ck_voice_calls_direction" CHECK (("direction")::text = ANY ((ARRAY['inbound'::character varying, 'outbound'::character varying, 'test'::character varying])::text[])),
	CONSTRAINT "ck_voice_calls_outcome" CHECK (("outcome")::text = ANY ((ARRAY['booked'::character varying, 'transferred'::character varying, 'message'::character varying, 'ended'::character varying, 'hung_up'::character varying, 'timed_out'::character varying, 'failed'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "voice_turns" (
	"id" serial NOT NULL,
	"call_id" integer NOT NULL,
	"n" integer NOT NULL,
	"pipeline" varchar(200) NOT NULL,
	"caller" text DEFAULT '' NOT NULL,
	"agent" text DEFAULT '' NOT NULL,
	"tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"speculative" boolean DEFAULT false NOT NULL,
	"barged" boolean DEFAULT false NOT NULL,
	"final_ms" integer,
	"end_ms" integer,
	"token_ms" integer,
	"audio_ms" integer,
	"heard_ms" integer,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_voice_turns" PRIMARY KEY("id")
);
--> statement-breakpoint
ALTER TABLE "voice_calls" ADD CONSTRAINT "fk_voice_calls_sms_contact_id_sms_contacts" FOREIGN KEY ("sms_contact_id") REFERENCES "public"."sms_contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_turns" ADD CONSTRAINT "fk_voice_turns_call_id_voice_calls" FOREIGN KEY ("call_id") REFERENCES "public"."voice_calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_phone_consents_e164" ON "phone_consents" USING btree ("e164");--> statement-breakpoint
CREATE INDEX "ix_voice_calls_started_at" ON "voice_calls" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "ix_voice_calls_sms_contact_id" ON "voice_calls" USING btree ("sms_contact_id");--> statement-breakpoint
CREATE INDEX "ix_voice_calls_booking_id" ON "voice_calls" USING btree ("booking_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_voice_turns_call_id_n" ON "voice_turns" USING btree ("call_id","n");--> statement-breakpoint
CREATE INDEX "ix_voice_turns_at" ON "voice_turns" USING btree ("at");--> statement-breakpoint
CREATE VIEW "public"."voice_call_records" AS (
  select c.id, c.whose::text whose, c.direction::text direction, c.pipeline::text pipeline,
    coalesce(c.lead_name, nullif(case when c.direction = 'outbound' then c.to_number
      else c.from_number end, ''), 'Test caller') who,
    (case when c.direction = 'outbound' then c.to_number else c.from_number end)::text number,
    c.outcome::text outcome,
    (select count(*)::int from voice_turns t where t.call_id = c.id and t.n > 0) turns,
    (select percentile_cont(0.5) within group (order by t.heard_ms)::int
       from voice_turns t where t.call_id = c.id and t.n > 0) heard,
    c.started_at started,
    extract(epoch from c.ended_at - c.started_at)::int seconds,
    c.message, c.by::text by
  from voice_calls c);--> statement-breakpoint
CREATE VIEW "public"."voice_latency" AS (
  select s.pipeline || ':' || s.stage id, s.pipeline::text pipeline, s.stage, s.rank,
    round(percentile_cont(0.5) within group (order by s.ms)::numeric)::int p50,
    round(percentile_cont(0.95) within group (order by s.ms)::numeric)::int p95,
    count(*)::int turns, max(s.at) last
  from (
    select t.pipeline, t.at, x.stage, x.rank, x.ms
    from voice_turns t
    cross join lateral (values ('final', 1, t.final_ms), ('end', 2, t.end_ms),
      ('token', 3, t.token_ms), ('audio', 4, t.audio_ms), ('heard', 5, t.heard_ms))
      as x(stage, rank, ms)
    where t.n > 0 and x.ms is not null and t.at > now() - interval '30 days'
  ) s
  group by s.pipeline, s.stage, s.rank);