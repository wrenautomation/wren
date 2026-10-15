DROP VIEW "public"."client_records";--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "sandbox" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "ck_clients_sandbox_quiet" CHECK (NOT "clients"."sandbox" OR ("clients"."sends" = '{}' AND NOT "clients"."buys_ok" AND "clients"."accounts" = '{}'::jsonb AND NOT "clients"."demo"));--> statement-breakpoint
CREATE VIEW "public"."client_records" AS (
  select c.id::text id, c.name,
    case when c.demo then 'demo' when c.sandbox then 'sandbox' else 'client' end kind,
    (select string_agg(k, ', ' order by k) from jsonb_object_keys(c.products) k) products,
    (select count(*) from client_members m where m.client_id = c.id) members,
    case when cardinality(c.sends) = 0 then 'Off. An admin turns them on.'
      else array_to_string(c.sends, ', ') end sends,
    (select max(m.last_seen_at) from client_members m where m.client_id = c.id) last_seen,
    c.created_at added
  from clients c);