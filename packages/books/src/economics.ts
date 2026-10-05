/**
 * Unit economics (designs/2026-10-04-unit-economics.md): what a client costs to win, what one
 * is worth, who leaves, and what each funnel stage costs per channel. Cash basis in CAD, months
 * in Toronto. Revenue and client lives come from `delivery.*` and the channel tables, read by
 * name here and pinned by a schema test, never imported. Demo clients never count. Money is in
 * dollars; a ratio with nothing to divide by is null, never a made-up figure.
 */
import { sql } from "drizzle-orm";
import { bigint, boolean, date, integer, numeric, text } from "drizzle-orm/pg-core";
import { books } from "./schema.js";

/** Where a client with no known source counts. */
export const UNKNOWN_CHANNEL = "unknown";

/**
 * Paid invoices in CAD at the Bank of Canada rate on the day paid, else the closest earlier
 * one, else the closest later one (Books keeps rates only for days it posted a bill).
 * `mrr_cents` is a monthly bill's recurring part: its amount less units at the contract's
 * per-unit fee. Setup fees and units are revenue, not MRR.
 */
export const econPaid = books
  .view("econ_paid", {
    invoiceId: integer("invoice_id"),
    engagementId: integer("engagement_id"),
    clientId: text("client_id"),
    paidOn: date("paid_on"),
    month: date("month"),
    setup: boolean("setup"),
    period: text("period"),
    cadCents: bigint("cad_cents", { mode: "number" }),
    mrrCents: bigint("mrr_cents", { mode: "number" }),
  })
  .as(sql`
    select i.id invoice_id, i.engagement_id, e.client_id::text client_id, i.paid_on,
      date_trunc('month', i.paid_on)::date "month", i.setup, i.period::text period,
      round(i.cents * x.rate)::bigint cad_cents,
      case when i.period is not null and not i.setup then greatest(0, round(
        (i.cents - coalesce(i.units, 0) * coalesce((t.terms ->> 'perUnitCents')::bigint, 0))
        * x.rate))::bigint else 0 end mrr_cents
    from delivery.invoices i
    join delivery.engagements e on e.id = i.engagement_id
    join public.clients c on c.id = e.client_id and not c.demo
    cross join lateral (select case when i.currency = 'CAD' then 1::numeric else (
      select r.cad_per_unit from books.rates r where r.currency = i.currency and r.source = 'boc'
      order by r."on" <= i.paid_on desc, abs(r."on" - i.paid_on) limit 1) end rate) x
    left join delivery.agreements t on t.engagement_id = i.engagement_id
    where i.status = 'paid'`);

/**
 * One row per client that has paid, per month from its first payment to now.
 * - paying: paid this month, or paid before with an engagement running (not onboarding) in it.
 * - churned: an engagement ended this month, after a payment, with no other one still open.
 * - mrr: the recurring part of its latest monthly bill, while it pays and hasn't churned.
 * - channel: the source on the engagement of its first payment, else `unknown`.
 */
export const econClientMonths = books
  .view("econ_client_months", {
    clientId: text("client_id"),
    month: date("month"),
    firstMonth: date("first_month"),
    channel: text("channel"),
    isNew: boolean("is_new"),
    paying: boolean("paying"),
    churned: boolean("churned"),
    revenueCents: bigint("revenue_cents", { mode: "number" }),
    mrrCents: bigint("mrr_cents", { mode: "number" }),
    keptCents: bigint("kept_cents", { mode: "number" }),
  })
  .as(sql`
    with firsts as (
      select distinct on (p.client_id) p.client_id, p.paid_on first_paid,
        p."month" first_month, coalesce(e.source_channel::text, 'unknown') channel
      from books.econ_paid p join delivery.engagements e on e.id = p.engagement_id
      order by p.client_id, p.paid_on, p.invoice_id),
    cm as (
      select f.*, generate_series(f.first_month,
        date_trunc('month', now() at time zone 'America/Toronto')::date, interval '1 month')::date "month"
      from firsts f),
    flags as (
      select cm.*,
        exists (select 1 from books.econ_paid p where p.client_id = cm.client_id and p."month" = cm."month")
          or (cm.first_paid < cm."month" and exists (select 1 from delivery.engagements e
            where e.client_id = cm.client_id and e.status <> 'onboarding'
              and e.starts_on < cm."month" + interval '1 month'
              and (e.ended_on >= cm."month" or (e.ended_on is null and e.status <> 'done')))) paying,
        exists (select 1 from delivery.engagements e
          where e.client_id = cm.client_id and e.ended_on >= cm.first_paid
            and e.ended_on >= cm."month" and e.ended_on < cm."month" + interval '1 month'
            and not exists (select 1 from delivery.engagements o
              where o.client_id = e.client_id and o.id <> e.id and o.starts_on <= e.ended_on
                and (o.ended_on > e.ended_on or (o.ended_on is null and o.status <> 'done')))) churned
      from cm)
    select f.client_id, f."month", f.first_month, f.channel, f."month" = f.first_month is_new,
      f.paying, f.churned, coalesce(p.revenue_cents, 0)::bigint revenue_cents,
      (case when f.paying and not f.churned then coalesce((select r.mrr_cents from books.econ_paid r
        where r.client_id = f.client_id and r.period is not null and not r.setup
          and r.paid_on < f."month" + interval '1 month'
        order by r.period desc, r.paid_on desc, r.invoice_id desc limit 1), 0) else 0 end)::bigint mrr_cents,
      coalesce(p.kept_cents, 0)::bigint kept_cents
    from flags f left join (
      select p.client_id, p."month", sum(p.cad_cents) revenue_cents,
        sum(p.cad_cents) filter (where not p.setup) kept_cents
      from books.econ_paid p group by 1, 2) p on p.client_id = f.client_id and p."month" = f."month"`);

/**
 * Every figure per month, from the first month with spend or a client to now. Spend by bucket
 * (an expense with none is overhead). Paying at the start of a month is paying the month
 * before. CAC over trailing 3, 6 and 12 months; predicted LTV, LTV:CAC and payback over 6.
 * Realized LTV is to date: over clients who churned, and over every client who paid.
 */
export const econMonths = books
  .view("econ_months", {
    id: text("id"),
    month: date("month"),
    latest: boolean("latest"),
    currency: text("currency"),
    spend: numeric("spend", { mode: "number" }),
    acquisition: numeric("acquisition", { mode: "number" }),
    delivery: numeric("delivery", { mode: "number" }),
    overhead: numeric("overhead", { mode: "number" }),
    revenue: numeric("revenue", { mode: "number" }),
    mrr: numeric("mrr", { mode: "number" }),
    paying: integer("paying"),
    payingStart: integer("paying_start"),
    newClients: integer("new_clients"),
    churned: integer("churned"),
    arpa: numeric("arpa", { mode: "number" }),
    arpa3: numeric("arpa_3", { mode: "number" }),
    grossMargin: numeric("gross_margin", { mode: "number" }),
    cac3: numeric("cac_3", { mode: "number" }),
    cac6: numeric("cac_6", { mode: "number" }),
    cac12: numeric("cac_12", { mode: "number" }),
    logoChurn: numeric("logo_churn", { mode: "number" }),
    revenueChurn: numeric("revenue_churn", { mode: "number" }),
    ltv: numeric("ltv", { mode: "number" }),
    ltvCac: numeric("ltv_cac", { mode: "number" }),
    payback: numeric("payback", { mode: "number" }),
    realizedLtv: numeric("realized_ltv", { mode: "number" }),
    realizedLtvAll: numeric("realized_ltv_all", { mode: "number" }),
  })
  .as(sql`
    with cur as (select date_trunc('month', now() at time zone 'America/Toronto')::date m),
    spend as (
      select date_trunc('month', e.posted_on)::date "month", coalesce(a.bucket::text, 'overhead') bucket,
        sum(l.cad_cents) cents
      from books.lines l join books.entries e on e.id = l.entry_id
      join books.accounts a on a.id = l.account_id
      where a.type = 'expense' group by 1, 2),
    cm as (select * from books.econ_client_months),
    months as (
      select generate_series(least(cur.m, (select min("month") from spend),
        (select min("month") from cm)), cur.m, interval '1 month')::date "month" from cur),
    base as (
      select mo."month",
        coalesce((select sum(s.cents) from spend s where s."month" = mo."month"), 0) spend,
        coalesce((select sum(s.cents) from spend s where s."month" = mo."month" and s.bucket = 'acquisition'), 0) acq,
        coalesce((select sum(s.cents) from spend s where s."month" = mo."month" and s.bucket = 'delivery'), 0) del,
        coalesce((select sum(s.cents) from spend s where s."month" = mo."month" and s.bucket = 'overhead'), 0) ovh,
        coalesce(c.revenue, 0) rev, coalesce(c.mrr, 0) mrr, coalesce(c.paying, 0) paying,
        coalesce(c.new_clients, 0) new_clients, coalesce(c.churned, 0) churned,
        coalesce((select count(*) from cm x where x.paying and x."month" = (mo."month" - interval '1 month')::date), 0) paying_start,
        (select sum(prev.mrr_cents) from cm x join cm prev on prev.client_id = x.client_id
          and prev."month" = (x."month" - interval '1 month')::date where x."month" = mo."month") mrr_start,
        (select sum(x.mrr_cents) from cm x join cm prev on prev.client_id = x.client_id
          and prev."month" = (x."month" - interval '1 month')::date
          where x."month" = mo."month" and prev.mrr_cents > 0) mrr_kept,
        (select count(distinct x.client_id) from cm x where x."month" <= mo."month") clients_to_date,
        (select count(distinct x.client_id) from cm x where x.churned and x."month" <= mo."month") churned_to_date,
        (select sum(x.revenue_cents) from cm x where x."month" <= mo."month" and exists (select 1
          from cm y where y.client_id = x.client_id and y.churned and y."month" <= mo."month")) churned_revenue
      from months mo left join (
        select x."month", sum(x.revenue_cents) revenue, sum(x.mrr_cents) mrr,
          count(*) filter (where x.paying) paying, count(*) filter (where x.is_new) new_clients,
          count(*) filter (where x.churned) churned
        from cm x group by 1) c on c."month" = mo."month"),
    t as (
      select b.*,
        sum(b.rev) over w3 rev3, sum(b.paying) over w3 paying3,
        sum(b.acq) over w3 acq3, sum(b.new_clients) over w3 new3,
        sum(b.acq) over w6 acq6, sum(b.new_clients) over w6 new6,
        sum(b.acq) over w12 acq12, sum(b.new_clients) over w12 new12,
        sum(b.rev) over w6 rev6, sum(b.del) over w6 del6, sum(b.paying) over w6 paying6,
        sum(b.churned) over w6 churned6, sum(b.paying_start) over w6 start6,
        sum(b.rev) over wall rev_to_date, sum(b.del) over wall del_to_date
      from base b
      window w3 as (order by b."month" rows 2 preceding), w6 as (order by b."month" rows 5 preceding),
        w12 as (order by b."month" rows 11 preceding), wall as (order by b."month" rows unbounded preceding)),
    f as (
      select t.*,
        t.acq6::numeric / nullif(t.new6, 0) cac6c,
        (t.rev6 - t.del6)::numeric / nullif(t.paying6, 0) margin6,
        t.churned6::numeric / nullif(t.start6, 0) churn6,
        (t.rev_to_date - t.del_to_date)::numeric / nullif(t.rev_to_date, 0) gm_to_date
      from t)
    select to_char(f."month", 'YYYY-MM') id, f."month", f."month" = (select m from cur) latest,
      'CAD' currency,
      round(f.spend / 100.0, 2) spend, round(f.acq / 100.0, 2) acquisition,
      round(f.del / 100.0, 2) delivery, round(f.ovh / 100.0, 2) overhead,
      round(f.rev / 100.0, 2) revenue, round(f.mrr / 100.0, 2) mrr,
      f.paying::int paying, f.paying_start::int paying_start,
      f.new_clients::int new_clients, f.churned::int churned,
      round(f.rev / 100.0 / nullif(f.paying, 0), 2) arpa,
      round(f.rev3 / 100.0 / nullif(f.paying3, 0), 2) arpa_3,
      round((f.rev - f.del)::numeric / nullif(f.rev, 0), 4) gross_margin,
      round(f.acq3 / 100.0 / nullif(f.new3, 0), 2) cac_3,
      round(f.cac6c / 100.0, 2) cac_6,
      round(f.acq12 / 100.0 / nullif(f.new12, 0), 2) cac_12,
      round(f.churned::numeric / nullif(f.paying_start, 0), 4) logo_churn,
      round((f.mrr_start - coalesce(f.mrr_kept, 0))::numeric / nullif(f.mrr_start, 0), 4) revenue_churn,
      round(f.margin6 / nullif(f.churn6, 0) / 100.0, 2) ltv,
      round(f.margin6 / nullif(f.churn6, 0) / nullif(f.cac6c, 0), 2) ltv_cac,
      round(f.cac6c / case when f.margin6 > 0 then f.margin6 end, 1) payback,
      round(f.gm_to_date * f.churned_revenue / 100.0 / nullif(f.churned_to_date, 0), 2) realized_ltv,
      round(f.gm_to_date * f.rev_to_date / 100.0 / nullif(f.clients_to_date, 0), 2) realized_ltv_all
    from f`);

/**
 * Per channel and month: acquisition spend, each funnel stage and what it cost, new clients,
 * and CAC over trailing 3, 6 and 12 months. Spend on an account with no channel is shared in
 * proportion to the new clients each channel won; with none won, it stays unshared.
 */
export const econChannels = books
  .view("econ_channels", {
    id: text("id"),
    channel: text("channel"),
    month: date("month"),
    latest: boolean("latest"),
    currency: text("currency"),
    spend: numeric("spend", { mode: "number" }),
    leads: integer("leads"),
    sends: integer("sends"),
    replies: integer("replies"),
    interested: integer("interested"),
    booked: integer("booked"),
    newClients: integer("new_clients"),
    perLead: numeric("per_lead", { mode: "number" }),
    perSend: numeric("per_send", { mode: "number" }),
    perReply: numeric("per_reply", { mode: "number" }),
    perInterested: numeric("per_interested", { mode: "number" }),
    perBooked: numeric("per_booked", { mode: "number" }),
    cac3: numeric("cac_3", { mode: "number" }),
    cac6: numeric("cac_6", { mode: "number" }),
    cac12: numeric("cac_12", { mode: "number" }),
  })
  .as(sql`
    with chans as (
      select unnest(array['email', 'sms', 'ads', 'content', 'search', 'reach', 'unknown']) channel),
    spend as (
      select date_trunc('month', e.posted_on)::date "month", a.channel::text channel, sum(l.cad_cents) cents
      from books.lines l join books.entries e on e.id = l.entry_id
      join books.accounts a on a.id = l.account_id
      where a.type = 'expense' and a.bucket = 'acquisition' group by 1, 2),
    news as (
      select x."month", x.channel, count(*) n from books.econ_client_months x where x.is_new group by 1, 2),
    stages as (
      select 'email' channel, l.created_at ts, 'lead' stage from leads l
      union all select 'email', m.sent_at, 'send' from messages m where m.state = 'sent' and m.sent_at is not null
      union all select 'email', te.received_at, 'reply' from thread_events te where te.kind = 'reply'
      union all select 'email', te.received_at, 'interested' from thread_events te
        where te.kind = 'reply' and te.disposition in ('interested', 'meeting_booked')
      union all select 'email', ci.updated_at, 'booked' from call_invites ci where ci.state in ('booked', 'already_booked')
      union all select 'email', cb.booked_at, 'booked' from call_bookings cb
        where cb.state = 'booked' and cb.enrollment_id is not null and not exists (
          select 1 from call_invites ci where ci.enrollment_id = cb.enrollment_id and ci.state in ('booked', 'already_booked'))
      union all select 'sms', c.created_at, 'lead' from sms_contacts c
      union all select 'sms', m.sent_at, 'send' from sms_messages m where m.direction = 'out' and m.sent_at is not null
      union all select 'sms', coalesce(m.received_at, m.created_at), 'reply' from sms_messages m where m.direction = 'in'
      union all select 'sms', coalesce(m.received_at, m.created_at), 'interested' from sms_messages m
        where m.direction = 'in' and m.disposition = 'interested'
      union all select 'reach', c.created_at, 'lead' from reach_contacts c
      union all select 'reach', m.sent_at, 'send' from reach_messages m where m.direction = 'out' and m.sent_at is not null
      union all select 'reach', m.created_at, 'reply' from reach_messages m where m.direction = 'in'),
    funnel as (
      select s.channel, date_trunc('month', s.ts at time zone 'America/Toronto')::date "month",
        count(*) filter (where s.stage = 'lead') leads, count(*) filter (where s.stage = 'send') sends,
        count(*) filter (where s.stage = 'reply') replies,
        count(*) filter (where s.stage = 'interested') interested,
        count(*) filter (where s.stage = 'booked') booked
      from stages s group by 1, 2),
    grid as (
      select mo."month", mo.latest, c.channel,
        coalesce(s.cents, 0) direct, coalesce(sh.cents, 0) shared,
        coalesce(n.n, 0) new_clients, coalesce(nt.n, 0) new_total,
        coalesce(fu.leads, 0) leads, coalesce(fu.sends, 0) sends, coalesce(fu.replies, 0) replies,
        coalesce(fu.interested, 0) interested, coalesce(fu.booked, 0) booked
      from books.econ_months mo cross join chans c
      left join spend s on s."month" = mo."month" and s.channel = c.channel
      left join spend sh on sh."month" = mo."month" and sh.channel is null
      left join news n on n."month" = mo."month" and n.channel = c.channel
      left join (select x."month", sum(x.n) n from news x group by 1) nt on nt."month" = mo."month"
      left join funnel fu on fu."month" = mo."month" and fu.channel = c.channel),
    t as (
      select g.*,
        g.direct + case when g.new_total > 0 then g.shared * g.new_clients::numeric / g.new_total else 0 end cents,
        sum(g.direct) over w3 direct3, sum(g.shared) over w3 shared3,
        sum(g.new_clients) over w3 new3, sum(g.new_total) over w3 total3,
        sum(g.direct) over w6 direct6, sum(g.shared) over w6 shared6,
        sum(g.new_clients) over w6 new6, sum(g.new_total) over w6 total6,
        sum(g.direct) over w12 direct12, sum(g.shared) over w12 shared12,
        sum(g.new_clients) over w12 new12, sum(g.new_total) over w12 total12
      from grid g
      window w3 as (partition by g.channel order by g."month" rows 2 preceding),
        w6 as (partition by g.channel order by g."month" rows 5 preceding),
        w12 as (partition by g.channel order by g."month" rows 11 preceding))
    select t.channel || '/' || to_char(t."month", 'YYYY-MM') id, t.channel, t."month", t.latest,
      'CAD' currency, round(t.cents / 100.0, 2) spend,
      t.leads::int leads, t.sends::int sends, t.replies::int replies,
      t.interested::int interested, t.booked::int booked, t.new_clients::int new_clients,
      round(t.cents / 100.0 / nullif(t.leads, 0), 2) per_lead,
      round(t.cents / 100.0 / nullif(t.sends, 0), 4) per_send,
      round(t.cents / 100.0 / nullif(t.replies, 0), 2) per_reply,
      round(t.cents / 100.0 / nullif(t.interested, 0), 2) per_interested,
      round(t.cents / 100.0 / nullif(t.booked, 0), 2) per_booked,
      round((t.direct3 + t.shared3 * t.new3::numeric / nullif(t.total3, 0)) / 100.0 / nullif(t.new3, 0), 2) cac_3,
      round((t.direct6 + t.shared6 * t.new6::numeric / nullif(t.total6, 0)) / 100.0 / nullif(t.new6, 0), 2) cac_6,
      round((t.direct12 + t.shared12 * t.new12::numeric / nullif(t.total12, 0)) / 100.0 / nullif(t.new12, 0), 2) cac_12
    from t`);

/**
 * Clients by the month they first paid, per month since: how many still pay, and the revenue
 * kept against their first month. Setup fees are left out, so month 0 isn't inflated by them.
 */
export const econCohorts = books
  .view("econ_cohorts", {
    id: text("id"),
    cohort: date("cohort"),
    monthsSince: integer("months_since"),
    currency: text("currency"),
    clients: integer("clients"),
    paying: integer("paying"),
    stillPaying: numeric("still_paying", { mode: "number" }),
    revenue: numeric("revenue", { mode: "number" }),
    revenueKept: numeric("revenue_kept", { mode: "number" }),
  })
  .as(sql`
    with c as (
      select x.first_month cohort,
        ((extract(year from x."month") - extract(year from x.first_month)) * 12
          + extract(month from x."month") - extract(month from x.first_month))::int months_since,
        count(*) clients, count(*) filter (where x.paying) paying, sum(x.kept_cents) kept
      from books.econ_client_months x group by 1, 2)
    select to_char(c.cohort, 'YYYY-MM') || '/' || c.months_since id, c.cohort, c.months_since,
      'CAD' currency, c.clients::int clients, c.paying::int paying,
      round(c.paying::numeric / c.clients, 4) still_paying, round(c.kept / 100.0, 2) revenue,
      round(c.kept::numeric / nullif(first_value(c.kept) over (partition by c.cohort order by c.months_since), 0), 4) revenue_kept
    from c`);
