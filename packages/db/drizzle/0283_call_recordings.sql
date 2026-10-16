CREATE TABLE "call_recordings" (
	"id" serial NOT NULL,
	"call_booking_id" integer,
	"file_key" text NOT NULL,
	"bytes" bigint NOT NULL,
	"duration_s" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"transcript" text NOT NULL,
	"segments" jsonb NOT NULL,
	"notes" jsonb,
	"model" varchar(64),
	"by" varchar(8) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_call_recordings" PRIMARY KEY("id"),
	CONSTRAINT "uq_call_recordings_file_key" UNIQUE("file_key"),
	CONSTRAINT "ck_call_recordings_by" CHECK (("by")::text = ANY ((ARRAY['desk'::character varying, 'manual'::character varying])::text[]))
);
--> statement-breakpoint
ALTER TABLE "call_recordings" ADD CONSTRAINT "fk_call_recordings_call_booking_id_call_bookings" FOREIGN KEY ("call_booking_id") REFERENCES "public"."call_bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_call_recordings_call_booking_id" ON "call_recordings" USING btree ("call_booking_id");