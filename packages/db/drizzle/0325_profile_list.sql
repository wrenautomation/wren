CREATE TABLE "profile_list" (
	"profile_id" integer NOT NULL,
	"name" text NOT NULL,
	"emails" text,
	"phones" text,
	"handles" text,
	"channels" text,
	"consent" text,
	"first_seen" timestamp with time zone NOT NULL,
	"last_seen" timestamp with time zone NOT NULL,
	"keys" integer NOT NULL,
	"traits" integer NOT NULL,
	"merged" integer NOT NULL,
	"stage" text NOT NULL,
	"warmth" text NOT NULL,
	"why" text,
	"warmth_line" text,
	"warm_since" timestamp with time zone,
	"persona" text NOT NULL,
	"persona_role" text NOT NULL,
	"persona_niche" text NOT NULL,
	"persona_size" text NOT NULL,
	"subscriptions" text,
	"replies" integer NOT NULL,
	"replied_last" timestamp with time zone,
	"replied_channel" text,
	"first_channel" text,
	"last_touch_at" timestamp with time zone,
	"last_channel" text,
	"came_from" text,
	"lead" text,
	CONSTRAINT "pk_profile_list" PRIMARY KEY("profile_id")
);
--> statement-breakpoint
DROP VIEW "public"."profile_records";--> statement-breakpoint
ALTER TABLE "profile_list" ADD CONSTRAINT "fk_profile_list_profile_id_profiles" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_profile_list_profile_text" ON "profile_list" USING btree (("profile_id"::text));--> statement-breakpoint
CREATE INDEX "ix_profile_list_last_seen" ON "profile_list" USING btree (("last_seen" is null),"last_seen" desc,("profile_id"::text) collate "C");--> statement-breakpoint
CREATE VIEW "public"."profile_records" AS (
  select l.profile_id id, l.name, l.emails, l.phones, l.handles, l.channels, l.consent,
    l.first_seen, l.last_seen, l.keys, l.traits, l.merged, l.stage, l.warmth, l.why,
    l.warmth_line, l.warm_since, l.persona, l.persona_role, l.persona_niche, l.persona_size,
    l.subscriptions, l.replies, l.replied_last, l.replied_channel, l.first_channel,
    l.last_touch_at, l.last_channel, l.came_from, l.lead
  from profile_list l);--> statement-breakpoint
-- The list row, exact: any change to a profile, its rollup, keys, traits or merges, or the consent
-- on one of its addresses, rebuilds the rows it touched, once per statement. A row that did not
-- move is not written; a merged profile leaves the list.
CREATE FUNCTION profile_list_refresh(ids integer[]) RETURNS void LANGUAGE sql AS $$
  delete from profile_list l where l.profile_id = any(ids)
    and not exists (select 1 from profiles p where p.id = l.profile_id and p.merged_into is null);
  insert into profile_list
  select p.id, coalesce(p.name, ks.first_key, '#' || p.id),
    ks.emails, ks.phones, ks.handles, ks.channels, cs.consent,
    p.first_seen, p.last_seen, ks.keys, ts.traits, ms.merged,
    coalesce(r.stage, 'stranger'), coalesce(r.warmth, 'cold'), r.why, r.warmth_line,
    r.warm_since, coalesce(r.persona, 'unknown'), coalesce(r.persona_role, 'unknown'),
    coalesce(r.persona_niche, 'unknown'), coalesce(r.persona_size, 'unknown'), r.subscriptions,
    coalesce(r.replied_n, 0), r.replied_last, r.replied_last_channel,
    r.first_channel, r.last_touch_at, r.last_channel, r.came_from, ts.lead
  from profiles p
  left join profile_rollups r on r.profile_id = p.id
  left join lateral (
    select (array_agg(k.value order by k.kind <> 'email', k.kind <> 'phone', k.id))[1] first_key,
      string_agg(k.value, ', ' order by k.id) filter (where k.kind = 'email') emails,
      string_agg(k.value, ', ' order by k.id) filter (where k.kind = 'phone') phones,
      string_agg(substr(k.kind, 8) || ' ' || k.value, ', ' order by k.id)
        filter (where k.kind like 'handle:%') handles,
      string_agg(distinct case when k.kind = 'phone' then 'sms'
          when k.kind like 'handle:%' then substr(k.kind, 8) else k.kind end, ', ')
        filter (where k.kind in ('email', 'phone') or k.kind like 'handle:%') channels,
      count(*)::int keys
    from profile_keys k where k.profile_id = p.id) ks on true
  left join lateral (
    select string_agg(distinct x.said, ', ') consent from (
      select c.channel || ' ' || c.state said from profile_keys k
        join consents c on c.address = k.value
          and c.channel = case k.kind when 'email' then 'email' when 'phone' then 'sms' end
        where k.profile_id = p.id and k.kind in ('email', 'phone')
      union all
      select 'sms opted out' from profile_keys k join sms_contacts s on s.e164 = k.value
        where k.profile_id = p.id and k.kind = 'phone' and s.state = 'opted_out') x) cs on true
  left join lateral (
    select count(*)::int traits, max(t.value #>> '{}') filter (where t.key = 'lead') lead
    from profile_traits t where t.profile_id = p.id) ts on true
  left join lateral (
    select count(*)::int merged from profile_merges m where m.into_id = p.id) ms on true
  where p.id = any(ids) and p.merged_into is null
  on conflict (profile_id) do update set
    (name, emails, phones, handles, channels, consent, first_seen, last_seen, keys, traits,
      merged, stage, warmth, why, warmth_line, warm_since, persona, persona_role, persona_niche,
      persona_size, subscriptions, replies, replied_last, replied_channel, first_channel,
      last_touch_at, last_channel, came_from, lead)
    = (excluded.name, excluded.emails, excluded.phones, excluded.handles, excluded.channels,
      excluded.consent, excluded.first_seen, excluded.last_seen, excluded.keys, excluded.traits,
      excluded.merged, excluded.stage, excluded.warmth, excluded.why, excluded.warmth_line,
      excluded.warm_since, excluded.persona, excluded.persona_role, excluded.persona_niche,
      excluded.persona_size, excluded.subscriptions, excluded.replies, excluded.replied_last,
      excluded.replied_channel, excluded.first_channel, excluded.last_touch_at,
      excluded.last_channel, excluded.came_from, excluded.lead)
    where profile_list.* is distinct from excluded.*
$$;--> statement-breakpoint
-- TG_ARGV[0]: the profile id of a changed row `r`, as SQL.
CREATE FUNCTION profile_list_sync() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ids integer[];
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    PERFORM profile_list_refresh(array(select id from profiles));
    RETURN NULL;
  END IF;
  EXECUTE 'select array(' || CASE TG_OP
      WHEN 'INSERT' THEN format('select %s from new_rows r', TG_ARGV[0])
      WHEN 'DELETE' THEN format('select %s from old_rows r', TG_ARGV[0])
      ELSE format('select %1$s from new_rows r union select %1$s from old_rows r', TG_ARGV[0])
    END || ')' INTO ids;
  PERFORM profile_list_refresh(ids);
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER profile_list_ins AFTER INSERT ON profiles REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION profile_list_sync('r.id');--> statement-breakpoint
CREATE TRIGGER profile_list_upd AFTER UPDATE ON profiles REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION profile_list_sync('r.id');--> statement-breakpoint
CREATE TRIGGER profile_list_del AFTER DELETE ON profiles REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION profile_list_sync('r.id');--> statement-breakpoint
CREATE TRIGGER profile_list_ins AFTER INSERT ON profile_rollups REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION profile_list_sync('r.profile_id');--> statement-breakpoint
CREATE TRIGGER profile_list_upd AFTER UPDATE ON profile_rollups REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION profile_list_sync('r.profile_id');--> statement-breakpoint
CREATE TRIGGER profile_list_del AFTER DELETE ON profile_rollups REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION profile_list_sync('r.profile_id');--> statement-breakpoint
CREATE TRIGGER profile_list_truncate AFTER TRUNCATE ON profile_rollups FOR EACH STATEMENT EXECUTE FUNCTION profile_list_sync();--> statement-breakpoint
CREATE TRIGGER profile_list_ins AFTER INSERT ON profile_keys REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION profile_list_sync('r.profile_id');--> statement-breakpoint
CREATE TRIGGER profile_list_upd AFTER UPDATE ON profile_keys REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION profile_list_sync('r.profile_id');--> statement-breakpoint
CREATE TRIGGER profile_list_del AFTER DELETE ON profile_keys REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION profile_list_sync('r.profile_id');--> statement-breakpoint
CREATE TRIGGER profile_list_truncate AFTER TRUNCATE ON profile_keys FOR EACH STATEMENT EXECUTE FUNCTION profile_list_sync();--> statement-breakpoint
CREATE TRIGGER profile_list_ins AFTER INSERT ON profile_traits REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION profile_list_sync('r.profile_id');--> statement-breakpoint
CREATE TRIGGER profile_list_upd AFTER UPDATE ON profile_traits REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION profile_list_sync('r.profile_id');--> statement-breakpoint
CREATE TRIGGER profile_list_del AFTER DELETE ON profile_traits REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION profile_list_sync('r.profile_id');--> statement-breakpoint
CREATE TRIGGER profile_list_truncate AFTER TRUNCATE ON profile_traits FOR EACH STATEMENT EXECUTE FUNCTION profile_list_sync();--> statement-breakpoint
CREATE TRIGGER profile_list_ins AFTER INSERT ON profile_merges REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION profile_list_sync('r.into_id');--> statement-breakpoint
CREATE TRIGGER profile_list_upd AFTER UPDATE ON profile_merges REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION profile_list_sync('r.into_id');--> statement-breakpoint
CREATE TRIGGER profile_list_del AFTER DELETE ON profile_merges REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION profile_list_sync('r.into_id');--> statement-breakpoint
CREATE TRIGGER profile_list_truncate AFTER TRUNCATE ON profile_merges FOR EACH STATEMENT EXECUTE FUNCTION profile_list_sync();--> statement-breakpoint
CREATE TRIGGER profile_list_ins AFTER INSERT ON consents REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION profile_list_sync('(select k.profile_id from profile_keys k where k.kind = case r.channel when ''email'' then ''email'' when ''sms'' then ''phone'' end and k.value = r.address)');--> statement-breakpoint
CREATE TRIGGER profile_list_upd AFTER UPDATE ON consents REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION profile_list_sync('(select k.profile_id from profile_keys k where k.kind = case r.channel when ''email'' then ''email'' when ''sms'' then ''phone'' end and k.value = r.address)');--> statement-breakpoint
CREATE TRIGGER profile_list_del AFTER DELETE ON consents REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION profile_list_sync('(select k.profile_id from profile_keys k where k.kind = case r.channel when ''email'' then ''email'' when ''sms'' then ''phone'' end and k.value = r.address)');--> statement-breakpoint
CREATE TRIGGER profile_list_truncate AFTER TRUNCATE ON consents FOR EACH STATEMENT EXECUTE FUNCTION profile_list_sync();--> statement-breakpoint
CREATE TRIGGER profile_list_ins AFTER INSERT ON sms_contacts REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION profile_list_sync('(select k.profile_id from profile_keys k where k.kind = ''phone'' and k.value = r.e164)');--> statement-breakpoint
CREATE TRIGGER profile_list_upd AFTER UPDATE ON sms_contacts REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION profile_list_sync('(select k.profile_id from profile_keys k where k.kind = ''phone'' and k.value = r.e164)');--> statement-breakpoint
CREATE TRIGGER profile_list_del AFTER DELETE ON sms_contacts REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION profile_list_sync('(select k.profile_id from profile_keys k where k.kind = ''phone'' and k.value = r.e164)');--> statement-breakpoint
CREATE TRIGGER profile_list_truncate AFTER TRUNCATE ON sms_contacts FOR EACH STATEMENT EXECUTE FUNCTION profile_list_sync();--> statement-breakpoint
SELECT profile_list_refresh(array(select id from profiles));
