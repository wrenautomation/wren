CREATE TABLE "segment_member_events" (
	"id" serial NOT NULL,
	"segment_id" integer NOT NULL,
	"profile_id" integer NOT NULL,
	"change" varchar(8) NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_segment_member_events" PRIMARY KEY("id")
);
--> statement-breakpoint
CREATE TABLE "segment_members" (
	"segment_id" integer NOT NULL,
	"profile_id" integer NOT NULL,
	"since" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_segment_members" PRIMARY KEY("segment_id","profile_id")
);
--> statement-breakpoint
CREATE TABLE "segments" (
	"id" serial NOT NULL,
	"name" varchar(120) NOT NULL,
	"kind" varchar(16) NOT NULL,
	"rule" jsonb,
	"words" text,
	"state" varchar(16) DEFAULT 'active' NOT NULL,
	"size" integer DEFAULT 0 NOT NULL,
	"computed_at" timestamp with time zone,
	"uses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"by" varchar(320) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_segments" PRIMARY KEY("id"),
	CONSTRAINT "uq_segments_name" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "segment_member_events" ADD CONSTRAINT "fk_segment_member_events_segment_id_segments" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment_member_events" ADD CONSTRAINT "fk_segment_member_events_profile_id_profiles" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment_members" ADD CONSTRAINT "fk_segment_members_segment_id_segments" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment_members" ADD CONSTRAINT "fk_segment_members_profile_id_profiles" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_segment_member_events_segment_id" ON "segment_member_events" USING btree ("segment_id","at");--> statement-breakpoint
CREATE INDEX "ix_segment_member_events_profile_id" ON "segment_member_events" USING btree ("profile_id","at");--> statement-breakpoint
CREATE INDEX "ix_segment_members_profile_id" ON "segment_members" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "ix_segments_state" ON "segments" USING btree ("state","kind");--> statement-breakpoint
CREATE VIEW "public"."segment_member_records" AS (
  select m.segment_id || ':' || m.profile_id id, m.segment_id, s.name::text segment,
    s.kind::text segment_kind, m.profile_id,
    coalesce(p.name, '#' || p.id) "name",
    (select string_agg(k.value, ', ' order by k.id) from profile_keys k
      where k.profile_id = p.id and k.kind = 'email') emails,
    (select string_agg(k.value, ', ' order by k.id) from profile_keys k
      where k.profile_id = p.id and k.kind = 'phone') phones,
    m.since, '/people/people/' || m.profile_id profile_link
  from segment_members m
  join segments s on s.id = m.segment_id
  join profiles p on p.id = m.profile_id);--> statement-breakpoint
CREATE VIEW "public"."segment_records" AS (
  select s.id, s.name::text, s.kind::text, s.state::text, s.size, s.words,
    (select string_agg(u ->> 'name', ', ') from jsonb_array_elements(s.uses) u) used_by,
    jsonb_array_length(s.uses) uses,
    s.computed_at, s.used_at, s.archived_at, s.by::text, s.created_at,
    '/people/members?segmentId=' || s.id || '..' || s.id members
  from segments s);--> statement-breakpoint
-- What a segment rule reads a trait as (packages/core/src/segments.ts): a day or a number, null
-- when the value is neither, so one odd value never fails a count.
CREATE FUNCTION segment_date(v jsonb) RETURNS date LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF jsonb_typeof(v) <> 'string' THEN RETURN NULL; END IF;
  RETURN left(v #>> '{}', 10)::date;
EXCEPTION WHEN others THEN
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE FUNCTION segment_number(v jsonb) RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF jsonb_typeof(v) = 'number' THEN RETURN (v #>> '{}')::numeric; END IF;
  IF jsonb_typeof(v) <> 'string' THEN RETURN NULL; END IF;
  RETURN (v #>> '{}')::numeric;
EXCEPTION WHEN others THEN
  RETURN NULL;
END $$;--> statement-breakpoint
-- A changed trait, address, profile event or segment wakes the workspace's segments pass at
-- commit (designs/2026-10-11-push-not-poll.md). One notice per statement; the pass folds bursts.
CREATE TRIGGER profile_traits_segments_wake AFTER INSERT OR UPDATE OR DELETE ON profile_traits
  FOR EACH STATEMENT EXECUTE FUNCTION wren_wake('Segments/fleet');--> statement-breakpoint
CREATE TRIGGER profile_keys_segments_wake AFTER INSERT OR UPDATE OR DELETE ON profile_keys
  FOR EACH STATEMENT EXECUTE FUNCTION wren_wake('Segments/fleet');--> statement-breakpoint
CREATE TRIGGER profile_events_segments_wake AFTER INSERT ON profile_events
  FOR EACH STATEMENT EXECUTE FUNCTION wren_wake('Segments/fleet');--> statement-breakpoint
CREATE TRIGGER segments_segments_wake AFTER INSERT OR UPDATE OF rule, state ON segments
  FOR EACH STATEMENT EXECUTE FUNCTION wren_wake('Segments/fleet');
