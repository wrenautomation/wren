DROP VIEW "public"."email_firm_records";--> statement-breakpoint
DROP INDEX "ix_companies_firm_records";--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "crawled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "named_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "lead_at" timestamp with time zone;--> statement-breakpoint
-- The firsts, exact: any change to documents, people or leads recomputes the firms it touched
-- (one index lookup each), per statement, so a bulk insert updates each firm once. A firm whose
-- firsts did not move is not written.
CREATE FUNCTION company_firsts_refresh(ids integer[]) RETURNS void LANGUAGE sql AS $$
  update companies c set crawled_at = f.crawled, named_at = f.named, lead_at = f.lead
  from (
    select i.id,
      (select min(fetched_at) from documents d where d.company_id = i.id) crawled,
      (select min(created_at) from people p where p.company_id = i.id) named,
      (select min(created_at) from leads l where l.company_id = i.id and l.status = 'verified'
        and l.first_name is not null) lead
    from (select distinct unnest(ids) id) i where i.id is not null) f
  where c.id = f.id and (c.crawled_at, c.named_at, c.lead_at) is distinct from (f.crawled, f.named, f.lead)
$$;--> statement-breakpoint
CREATE FUNCTION company_firsts_sync() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM company_firsts_refresh(array(select company_id from new_rows));
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM company_firsts_refresh(array(select company_id from old_rows));
  ELSE
    PERFORM company_firsts_refresh(array(
      select company_id from new_rows union select company_id from old_rows));
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER company_firsts_ins AFTER INSERT ON documents REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION company_firsts_sync();--> statement-breakpoint
CREATE TRIGGER company_firsts_upd AFTER UPDATE ON documents REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION company_firsts_sync();--> statement-breakpoint
CREATE TRIGGER company_firsts_del AFTER DELETE ON documents REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION company_firsts_sync();--> statement-breakpoint
CREATE TRIGGER company_firsts_ins AFTER INSERT ON people REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION company_firsts_sync();--> statement-breakpoint
CREATE TRIGGER company_firsts_upd AFTER UPDATE ON people REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION company_firsts_sync();--> statement-breakpoint
CREATE TRIGGER company_firsts_del AFTER DELETE ON people REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION company_firsts_sync();--> statement-breakpoint
CREATE TRIGGER company_firsts_ins AFTER INSERT ON leads REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION company_firsts_sync();--> statement-breakpoint
CREATE TRIGGER company_firsts_upd AFTER UPDATE ON leads REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION company_firsts_sync();--> statement-breakpoint
CREATE TRIGGER company_firsts_del AFTER DELETE ON leads REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION company_firsts_sync();--> statement-breakpoint
UPDATE companies c SET crawled_at = d.first FROM (select company_id, min(fetched_at) first from documents group by company_id) d WHERE d.company_id = c.id;--> statement-breakpoint
UPDATE companies c SET named_at = p.first FROM (select company_id, min(created_at) first from people group by company_id) p WHERE p.company_id = c.id;--> statement-breakpoint
UPDATE companies c SET lead_at = l.first FROM (select company_id, min(created_at) first from leads where status = 'verified' and first_name is not null group by company_id) l WHERE l.company_id = c.id;--> statement-breakpoint
CREATE INDEX "ix_companies_firm_records" ON "companies" USING btree ("id","niche","decline_reason","domain","created_at","name","crawled_at","named_at","lead_at") WHERE niche is not null;--> statement-breakpoint
CREATE VIEW "public"."email_firm_records" AS (
  select c.id, coalesce(c.name, c.domain, '?')::text "name", c.domain::text domain,
    c.niche::text niche,
    case when c.decline_reason is not null then 'declined' when c.lead_at is not null then 'lead'
      when c.named_at is not null then 'named' when c.crawled_at is not null then 'crawled'
      when c.domain is not null then 'domain' else 'found' end stage,
    c.decline_reason::text declined, c.created_at added, c.crawled_at crawled, c.named_at named,
    c.lead_at lead
  from companies c
  where c.niche is not null);