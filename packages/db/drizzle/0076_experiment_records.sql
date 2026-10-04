CREATE VIEW "public"."email_allele_records" AS (
  select a.id, a.experiment_id, upper(left(e.niche, 1)) || replace(substr(e.niche, 2), '_', ' ') || ' · ' || e.template experiment, a.locus::text locus,
    a.allele::text allele, a.text, a.state::text state, a.origin::text origin,
    a.angle::text angle, a.judge_score, j.detail->>'reason' reason,
    coalesce((s.stats->a.locus->a.allele->>'exposures')::int, 0) exposures,
    coalesce((s.stats->a.locus->a.allele->>'replies')::int, 0) replies,
    coalesce((s.stats->a.locus->a.allele->>'interested')::int, 0) interested,
    case when a.state = 'live' then (s.shares->a.locus->>a.allele)::float8 end share,
    (s.p_best->a.locus->>a.allele)::float8 p_best,
    replace(a.retired_reason::text, '_', ' ') retired_reason, a.decided_by::text decided_by,
    a.decided_at decided, a.created_at created
  from experiment_alleles a
  join experiments e on e.id = a.experiment_id
  left join experiment_journal j on j.id = a.journal_id
  left join lateral (
    select generation, taken_at, stats, shares, p_best from experiment_snapshots
    where experiment_id = e.id order by generation desc limit 1) s on true);--> statement-breakpoint
CREATE VIEW "public"."email_candidate_records" AS (
  select r.id, r.experiment_id, r.experiment, r.locus, r.text, r.state, r.origin, r.angle,
    r.judge_score, r.reason, r.decided_by, r.decided, r.created
  from email_allele_records r
  join experiment_alleles a on a.id = r.id
  join experiment_journal j on j.id = a.journal_id and j.kind = 'candidate');--> statement-breakpoint
CREATE VIEW "public"."email_experiment_journal" AS (
  select j.experiment_id, j.created_at at, j.kind::text kind,
    coalesce(j.locus || ': ', '') || case j.kind
      when 'start' then 'Started'
      when 'seed' then 'Seeded ' || replace(coalesce(j.detail->>'seeding', ''), '_', ' ')
      when 'snapshot' then 'Generation ' || j.generation || ' counted'
      when 'strategist' then 'Plan ' || (j.detail->>'mode') || ' on '
        || coalesce((select string_agg(x, ', ') from jsonb_array_elements_text(j.detail->'loci') x), 'nothing')
        || coalesce('. ' || (j.detail->>'reason'), '')
      when 'check' then (j.detail->>'written') || ' written, '
        || coalesce(jsonb_array_length(j.detail->'dropped'), 0) || ' dropped'
        || coalesce('. ' || (j.detail->>'error'), '')
      when 'judge' then jsonb_array_length(j.detail->'scores') || ' scored'
      when 'candidate' then 'Candidate "' || (j.detail->>'text') || '"'
      when 'approve' then 'Approved "' || (j.detail->>'text') || '" by ' || (j.detail->>'by')
      when 'edit' then 'Edited to "' || (j.detail->>'text') || '" by ' || (j.detail->>'by')
      when 'reject' then 'Rejected "' || (j.detail->>'text') || '" by ' || (j.detail->>'by')
      when 'retire' then 'Retired ' || coalesce(j.detail->>'allele', 'options')
        || ' (' || replace(coalesce(j.detail->>'reason', ''), '_', ' ') || ')'
      when 'settle' then 'Settled on ' || coalesce(j.detail->>'allele', 'nothing')
      when 'switch' then (j.detail->>'key') || ' set to ' || (j.detail->'to')::text
      when 'import' then 'Imported a file edit'
      when 'stop' then 'Stopped (' || replace(coalesce(j.detail->>'reason', ''), '_', ' ') || ')'
      when 'pause' then 'Paused'
      when 'resume' then 'Resumed'
      else j.kind end what
  from experiment_journal j);--> statement-breakpoint
CREATE VIEW "public"."email_experiment_records" AS (
  select e.id, upper(left(e.niche, 1)) || replace(substr(e.niche, 2), '_', ' ') || ' · ' || e.template "name", e.niche::text niche, e.template::text template,
    e.state::text state, replace(e.stop_reason::text, '_', ' ') stop_reason,
    e.settings->>'selection' selection, replace(e.settings->>'fitness', '_', ' ') fitness,
    coalesce(s.generation, 0) generation, a.loci, a.live, a.waiting, a.retired,
    s.taken_at last_tick, e.started_at started
  from experiments e
  left join lateral (
    select generation, taken_at, stats, shares, p_best from experiment_snapshots
    where experiment_id = e.id order by generation desc limit 1) s on true
  left join lateral (
    select count(distinct x.locus) loci, count(*) filter (where x.state = 'live') live,
      count(*) filter (where x.state = 'candidate') waiting,
      count(*) filter (where x.state = 'retired') retired
    from experiment_alleles x where x.experiment_id = e.id) a on true);