CREATE TABLE "profile_rollups" (
	"profile_id" integer NOT NULL,
	"stage" varchar(16) NOT NULL,
	"warmth" varchar(8) NOT NULL,
	"why" text DEFAULT '' NOT NULL,
	"warmth_line" text,
	"warm_since" timestamp with time zone,
	"subscribed_n" integer DEFAULT 0 NOT NULL,
	"subscribed_first" timestamp with time zone,
	"subscribed_last" timestamp with time zone,
	"replied_n" integer DEFAULT 0 NOT NULL,
	"replied_first" timestamp with time zone,
	"replied_last" timestamp with time zone,
	"booked_n" integer DEFAULT 0 NOT NULL,
	"booked_first" timestamp with time zone,
	"booked_last" timestamp with time zone,
	"form_n" integer DEFAULT 0 NOT NULL,
	"form_first" timestamp with time zone,
	"form_last" timestamp with time zone,
	"visited_n" integer DEFAULT 0 NOT NULL,
	"visited_first" timestamp with time zone,
	"visited_last" timestamp with time zone,
	"watched_n" integer DEFAULT 0 NOT NULL,
	"watched_first" timestamp with time zone,
	"watched_last" timestamp with time zone,
	"opened_n" integer DEFAULT 0 NOT NULL,
	"opened_first" timestamp with time zone,
	"opened_last" timestamp with time zone,
	"clicked_n" integer DEFAULT 0 NOT NULL,
	"clicked_first" timestamp with time zone,
	"clicked_last" timestamp with time zone,
	"engaged_n" integer DEFAULT 0 NOT NULL,
	"engaged_first" timestamp with time zone,
	"engaged_last" timestamp with time zone,
	"contacted_n" integer DEFAULT 0 NOT NULL,
	"contacted_first" timestamp with time zone,
	"contacted_last" timestamp with time zone,
	"subscriptions" text,
	"replied_channels" text,
	"replied_last_channel" varchar(24),
	"first_touch_at" timestamp with time zone,
	"first_channel" varchar(24),
	"first_touch" text,
	"last_touch_at" timestamp with time zone,
	"last_channel" varchar(24),
	"last_touch" text,
	"came_from" varchar(32),
	"persona" varchar(64) NOT NULL,
	"persona_role" varchar(16) NOT NULL,
	"persona_niche" varchar(32) NOT NULL,
	"persona_size" varchar(16) NOT NULL,
	"refreshed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_profile_rollups" PRIMARY KEY("profile_id")
);
--> statement-breakpoint
CREATE TABLE "profile_site_reads" (
	"profile_id" integer NOT NULL,
	"visits" integer NOT NULL,
	"visit_first" timestamp with time zone,
	"visit_last" timestamp with time zone,
	"watches" integer NOT NULL,
	"watch_first" timestamp with time zone,
	"watch_last" timestamp with time zone,
	"read_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pk_profile_site_reads" PRIMARY KEY("profile_id")
);
--> statement-breakpoint
DROP VIEW "public"."profile_records";--> statement-breakpoint
ALTER TABLE "profile_rollups" ADD CONSTRAINT "fk_profile_rollups_profile_id_profiles" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_site_reads" ADD CONSTRAINT "fk_profile_site_reads_profile_id_profiles" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_profile_rollups_stage" ON "profile_rollups" USING btree ("stage");--> statement-breakpoint
CREATE INDEX "ix_profile_rollups_warmth" ON "profile_rollups" USING btree ("warmth","warm_since");--> statement-breakpoint
CREATE INDEX "ix_profile_rollups_persona" ON "profile_rollups" USING btree ("persona");--> statement-breakpoint
CREATE INDEX "ix_profile_rollups_replied_last" ON "profile_rollups" USING btree ("replied_last");--> statement-breakpoint
CREATE INDEX "ix_profile_site_reads_read_at" ON "profile_site_reads" USING btree ("read_at");--> statement-breakpoint
CREATE VIEW "public"."profile_records" AS (
  select p.id, coalesce(p.name, (select k.value from profile_keys k where k.profile_id = p.id
      order by k.kind <> 'email', k.kind <> 'phone', k.id limit 1), '#' || p.id) "name",
    (select string_agg(k.value, ', ' order by k.id) from profile_keys k
      where k.profile_id = p.id and k.kind = 'email') emails,
    (select string_agg(k.value, ', ' order by k.id) from profile_keys k
      where k.profile_id = p.id and k.kind = 'phone') phones,
    (select string_agg(substr(k.kind, 8) || ' ' || k.value, ', ' order by k.id) from profile_keys k
      where k.profile_id = p.id and k.kind like 'handle:%') handles,
    (select string_agg(distinct case when k.kind = 'phone' then 'sms'
        when k.kind like 'handle:%' then substr(k.kind, 8) else k.kind end, ', ')
      from profile_keys k where k.profile_id = p.id and (k.kind in ('email', 'phone')
        or k.kind like 'handle:%')) channels,
    (select string_agg(distinct x.said, ', ') from (
      select c.channel || ' ' || c.state said from profile_keys k
        join consents c on c.address = k.value
          and c.channel = case k.kind when 'email' then 'email' when 'phone' then 'sms' end
        where k.profile_id = p.id and k.kind in ('email', 'phone')
      union all
      select 'sms opted out' from profile_keys k join sms_contacts s on s.e164 = k.value
        where k.profile_id = p.id and k.kind = 'phone' and s.state = 'opted_out') x) consent,
    p.first_seen, p.last_seen,
    (select count(*)::int from profile_keys k where k.profile_id = p.id) keys,
    (select count(*)::int from profile_traits t where t.profile_id = p.id) traits,
    (select count(*)::int from profile_merges m where m.into_id = p.id) merged,
    coalesce(r.stage, 'stranger') stage, coalesce(r.warmth, 'cold') warmth, r.why, r.warmth_line,
    r.warm_since, coalesce(r.persona, 'unknown') persona,
    coalesce(r.persona_role, 'unknown') persona_role,
    coalesce(r.persona_niche, 'unknown') persona_niche,
    coalesce(r.persona_size, 'unknown') persona_size, r.subscriptions,
    coalesce(r.replied_n, 0) replies, r.replied_last, r.replied_last_channel replied_channel,
    r.first_channel, r.last_touch_at, r.last_channel, r.came_from
  from profiles p
  left join profile_rollups r on r.profile_id = p.id
  where p.merged_into is null);