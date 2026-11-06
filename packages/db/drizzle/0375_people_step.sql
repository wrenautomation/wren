DROP VIEW "public"."profile_records";--> statement-breakpoint
CREATE VIEW "pipeline"."person_steps" AS (
  select i.profile_id, i.id journey, i.node, coalesce(n.name, i.node::text) step, i.moved_at since,
    d.days, case when d.days >= coalesce(n.idle, 14) then 'stale' end flag, i.owner
  from pipeline.instances i
  left join pipeline.shape_versions v on v.number = i.version
  left join lateral (
    select x.n->>'name' name, (x.n->>'idleDays')::int idle
    from jsonb_array_elements(v.run->'nodes') x(n) where x.n->>'id' = i.node limit 1) n on true
  cross join lateral (
    select floor(extract(epoch from now() - i.moved_at) / 86400)::int days) d
  where i.status = 'open' and i.subject_kind = 'person');--> statement-breakpoint
CREATE VIEW "public"."profile_records" AS (
  select l.profile_id id, l.name, l.emails, l.phones, l.handles, l.channels, l.consent,
    l.first_seen, l.last_seen, l.keys, l.traits, l.merged, l.stage, l.warmth, l.why,
    l.warmth_line, l.warm_since, l.persona, l.persona_role, l.persona_niche, l.persona_size,
    l.subscriptions, l.replies, l.replied_last, l.replied_channel, l.first_channel,
    l.last_touch_at, l.last_channel, l.came_from, l.lead,
    s.journey, s.step, s.node::text step_node, s.since step_since, s.days step_days,
    s.flag step_flag, s.owner step_owner
  from profile_list l left join pipeline.person_steps s on s.profile_id = l.profile_id);