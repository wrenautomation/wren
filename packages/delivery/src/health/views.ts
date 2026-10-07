/**
 * The views behind health's console records (`./records.ts`), one row per record, in main. The
 * shown score is the standing override, else the model's; both are columns. The demo is left out.
 */
import { sql } from "drizzle-orm";
import { date, integer, text, timestamp } from "drizzle-orm/pg-core";
import { delivery } from "../schema.js";
import { STALE_DAYS } from "./score.js";

const at = (name: string) => timestamp(name, { withTimezone: true });
/** The band of a shown score, as `bandOf` cuts it. */
const BAND = (score: string) =>
  sql.raw(`case when ${score} is null then 'none' when ${score} >= 70 then 'healthy'
    when ${score} >= 40 then 'watch' else 'risk' end`);
/** "Results 40% · Engagement 20%": the weights as they counted, the parts with none left out. */
const WEIGHTS = sql.raw(`concat_ws(' · ',
    case when (l.weights->>'results')::int > 0 then 'Results ' || (l.weights->>'results') || '%' end,
    case when (l.weights->>'engagement')::int > 0 then 'Engagement ' || (l.weights->>'engagement') || '%' end,
    case when (l.weights->>'sentiment')::int > 0 then 'Sentiment ' || (l.weights->>'sentiment') || '%' end,
    case when (l.weights->>'money')::int > 0 then 'Money ' || (l.weights->>'money') || '%' end)`);
const STALE_PARTS = sql.raw(
  `(select string_agg(initcap(x), ', ') from jsonb_array_elements_text(l.stale) x)`,
);

/** Each client's latest day, its standing override and rating, and its open flags. */
export const consoleHealth = delivery
  .view("console_health", {
    id: text("id"),
    name: text("name"),
    score: integer("score"),
    model: integer("model"),
    override: integer("override"),
    reason: text("reason"),
    overrideBy: text("override_by"),
    band: text("band"),
    results: integer("results"),
    engagement: integer("engagement"),
    sentiment: integer("sentiment"),
    money: integer("money"),
    resultsWhy: text("results_why"),
    engagementWhy: text("engagement_why"),
    sentimentWhy: text("sentiment_why"),
    moneyWhy: text("money_why"),
    weights: text("weights"),
    stale: integer("stale"),
    staleParts: text("stale_parts"),
    risks: integer("risks"),
    opportunities: integer("opportunities"),
    rating: integer("rating"),
    rated: at("rated"),
    updated: at("updated"),
  })
  .as(sql`
    with latest as (
      select distinct on (client_id) * from delivery.health_days order by client_id, day desc),
    rated as (
      select distinct on (client_id) client_id, score, at from delivery.health_ratings
      order by client_id, at desc, id desc),
    flagged as (
      select client_id, (count(*) filter (where side = 'risk'))::int risks,
        (count(*) filter (where side = 'opportunity'))::int opportunities
      from delivery.flags where cleared_at is null group by client_id)
    select c.id::text id, c.name::text "name", coalesce(o.score, l.score)::int score,
      l.score::int model, o.score::int override, o.reason, o.by override_by,
      ${BAND("coalesce(o.score, l.score)")} band,
      l.results::int results, l.engagement::int engagement, l.sentiment::int sentiment,
      l.money::int money,
      l.why->>'results' results_why, l.why->>'engagement' engagement_why,
      l.why->>'sentiment' sentiment_why, l.why->>'money' money_why,
      ${WEIGHTS} weights, jsonb_array_length(l.stale)::int stale, ${STALE_PARTS} stale_parts,
      coalesce(f.risks, 0) risks, coalesce(f.opportunities, 0) opportunities,
      r.score::int rating, r.at rated, l.at updated
    from latest l
    join clients c on c.id = l.client_id
    left join delivery.health_overrides o on o.client_id = l.client_id and o.cleared_at is null
    left join rated r on r.client_id = l.client_id
    left join flagged f on f.client_id = l.client_id
    where not c.demo`);

/** Every day kept, per client: the score as the model had it and the override standing then. */
export const consoleHealthDays = delivery
  .view("console_health_days", {
    id: text("id"),
    client: text("client"),
    name: text("name"),
    day: date("day"),
    score: integer("score"),
    model: integer("model"),
    override: integer("override"),
    band: text("band"),
    results: integer("results"),
    engagement: integer("engagement"),
    sentiment: integer("sentiment"),
    money: integer("money"),
    visited: text("visited"),
    staleParts: text("stale_parts"),
  })
  .as(sql`
    select l.client_id || ':' || l.day id, l.client_id::text client, c.name::text "name", l.day,
      coalesce(l.override, l.score)::int score, l.score::int model, l.override::int override,
      ${BAND("coalesce(l.override, l.score)")} band,
      l.results::int results, l.engagement::int engagement, l.sentiment::int sentiment,
      l.money::int money, case when l.visited then 'yes' else 'no' end visited,
      ${STALE_PARTS} stale_parts
    from delivery.health_days l join clients c on c.id = l.client_id
    where not c.demo`);

/** The rows behind each client's latest score: what, its value, its age, and where it lives. */
export const consoleHealthInputs = delivery
  .view("console_health_inputs", {
    id: text("id"),
    client: text("client"),
    name: text("name"),
    part: text("part"),
    what: text("what"),
    value: text("value"),
    at: at("at"),
    age: text("age"),
    rows: text("rows"),
  })
  .as(sql`
    with latest as (
      select distinct on (client_id) client_id, inputs from delivery.health_days
      order by client_id, day desc)
    select l.client_id || ':' || i.n id, l.client_id::text client, c.name::text "name",
      i.v->>'part' part, i.v->>'what' what, i.v->>'value' "value", (i.v->>'at')::timestamptz at,
      case when i.v->>'at' is null then 'live'
        when (i.v->>'part' = 'results'
            and (i.v->>'at')::timestamptz < now() - make_interval(days => ${sql.raw(String(STALE_DAYS.results))}))
          or (i.v->>'part' = 'sentiment'
            and (i.v->>'at')::timestamptz < now() - make_interval(days => ${sql.raw(String(STALE_DAYS.sentiment))}))
        then 'stale' else 'fresh' end age,
      i.v->>'href' "rows"
    from latest l
    join clients c on c.id = l.client_id
    cross join lateral jsonb_array_elements(l.inputs) with ordinality i(v, n)
    where not c.demo`);

/** Every client flag, open first by state; never its alert's `how`. */
export const consoleFlags = delivery
  .view("console_flags", {
    id: integer("id"),
    client: text("client"),
    name: text("name"),
    side: text("side"),
    source: text("source"),
    what: text("what"),
    state: text("state"),
    urgent: text("urgent"),
    owner: text("owner"),
    raised: at("raised"),
    raisedBy: text("raised_by"),
    addressed: at("addressed"),
    addressedBy: text("addressed_by"),
    note: text("note"),
    cleared: at("cleared"),
    clearedBy: text("cleared_by"),
  })
  .as(sql`
    select f.id, f.client_id::text client, c.name::text "name", f.side::text side,
      f.source::text source, f.what,
      case when f.cleared_at is not null then 'cleared' when f.addressed_at is not null
        then 'addressed' else 'open' end state,
      case when f.urgent then 'yes' else 'no' end urgent,
      coalesce(f.owner, 'Team') owner, f.raised_at raised, f.raised_by, f.addressed_at addressed,
      f.addressed_by, f.note, f.cleared_at cleared, f.cleared_by
    from delivery.flags f join clients c on c.id = f.client_id
    where not c.demo`);
