CREATE TABLE "books"."card_lines" (
	"id" serial NOT NULL,
	"card" varchar(4) NOT NULL,
	"on" date NOT NULL,
	"description" text NOT NULL,
	"descriptor" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"source" varchar(16) NOT NULL,
	"fingerprint" text NOT NULL,
	"document_id" integer NOT NULL,
	"vendor_id" integer,
	"personal" boolean DEFAULT false NOT NULL,
	"bill_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_card_lines" PRIMARY KEY("id"),
	CONSTRAINT "uq_card_lines_fingerprint" UNIQUE("fingerprint"),
	CONSTRAINT "ck_card_lines_source" CHECK (("source")::text = ANY ((ARRAY['statement'::character varying, 'alert'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "books"."card_rules" (
	"descriptor" text NOT NULL,
	"vendor_id" integer,
	"personal" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_card_rules" PRIMARY KEY("descriptor")
);
--> statement-breakpoint
CREATE TABLE "books"."subscription_ends" (
	"vendor_id" integer NOT NULL,
	"plan" text DEFAULT '' NOT NULL,
	"ended_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_subscription_ends" PRIMARY KEY("vendor_id","plan")
);
--> statement-breakpoint
ALTER TABLE "books"."alerts" DROP CONSTRAINT "ck_alerts_kind";--> statement-breakpoint
ALTER TABLE "books"."card_lines" ADD CONSTRAINT "fk_card_lines_document_id_documents" FOREIGN KEY ("document_id") REFERENCES "books"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "books"."card_lines" ADD CONSTRAINT "fk_card_lines_vendor_id_vendors" FOREIGN KEY ("vendor_id") REFERENCES "books"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "books"."card_lines" ADD CONSTRAINT "fk_card_lines_bill_id_bills" FOREIGN KEY ("bill_id") REFERENCES "books"."bills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "books"."card_rules" ADD CONSTRAINT "fk_card_rules_vendor_id_vendors" FOREIGN KEY ("vendor_id") REFERENCES "books"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "books"."subscription_ends" ADD CONSTRAINT "fk_subscription_ends_vendor_id_vendors" FOREIGN KEY ("vendor_id") REFERENCES "books"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_card_lines_document_id" ON "books"."card_lines" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "ix_card_lines_vendor_id" ON "books"."card_lines" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "ix_card_lines_bill_id" ON "books"."card_lines" USING btree ("bill_id");--> statement-breakpoint
CREATE INDEX "ix_card_lines_on" ON "books"."card_lines" USING btree ("on");--> statement-breakpoint
CREATE INDEX "ix_card_rules_vendor_id" ON "books"."card_rules" USING btree ("vendor_id");--> statement-breakpoint
ALTER TABLE "books"."alerts" ADD CONSTRAINT "ck_alerts_kind" CHECK (("kind")::text = ANY ((ARRAY['capture'::character varying, 'held'::character varying, 'unread'::character varying, 'new_subscription'::character varying, 'renewal'::character varying, 'lapsed'::character varying, 'spike'::character varying, 'card'::character varying])::text[]));--> statement-breakpoint
CREATE VIEW "books"."card_records" AS (
    select l.id, l."on", l.description, l.descriptor, l.amount_cents / 100.0 amount,
      l.currency::text currency, l.card::text card, v.name vendor,
      case when l.personal then 'personal' when l.amount_cents < 0 then 'credit'
        when l.vendor_id is null then 'to_sort'
        when b.number like 'card:%' then 'card_only' when b.id is not null then 'billed'
        else 'waiting' end state,
      b.number bill, l.source::text source
    from books.card_lines l
    left join books.vendors v on v.id = l.vendor_id
    left join books.bills b on b.id = l.bill_id);--> statement-breakpoint
-- Same columns, so it is replaced in place; subscription_records reads it.
CREATE OR REPLACE VIEW "books"."subscriptions" AS (SELECT s.* FROM (SELECT DISTINCT ON (c.vendor_id, (CASE WHEN c.plan IS NULL AND c.cycle::text = 'yearly'::text THEN c.bill_id::text ELSE lower(COALESCE(c.plan, ''::text)) END)) c.vendor_id, c.vendor, c.vendor_name, c.plan, c.cycle, c.currency, c.total_cents AS last_total_cents, c.cad_cents AS last_cad_cents, c.issued_on AS last_billed_on, (c.issued_on + CASE WHEN c.cycle::text = 'yearly'::text THEN '1 year'::interval ELSE '1 mon'::interval END)::date AS renews_on, CASE WHEN c.cycle::text = 'yearly'::text THEN round(c.cad_cents::numeric / 12.0)::bigint ELSE c.cad_cents END AS monthly_cad_cents, (SELECT min(b2.issued_on) FROM books.bills b2 WHERE b2.vendor_id = c.vendor_id AND (CASE WHEN c.plan IS NULL AND c.cycle::text = 'yearly'::text THEN b2.id = c.bill_id ELSE lower(COALESCE(b2.plan, ''::text)) = lower(COALESCE(c.plan, ''::text)) END) AND (b2.review::text <> ALL (ARRAY['personal'::character varying, 'void'::character varying]::text[]))) AS since, (SELECT count(*)::integer FROM books.bills b2 WHERE b2.vendor_id = c.vendor_id AND (CASE WHEN c.plan IS NULL AND c.cycle::text = 'yearly'::text THEN b2.id = c.bill_id ELSE lower(COALESCE(b2.plan, ''::text)) = lower(COALESCE(c.plan, ''::text)) END) AND (b2.review::text <> ALL (ARRAY['personal'::character varying, 'void'::character varying]::text[]))) AS bills FROM books.bill_costs c WHERE (c.cycle::text = ANY (ARRAY['monthly'::character varying, 'yearly'::character varying]::text[])) AND (c.review::text <> ALL (ARRAY['personal'::character varying, 'void'::character varying]::text[])) AND c.total_cents > 0 ORDER BY c.vendor_id, (CASE WHEN c.plan IS NULL AND c.cycle::text = 'yearly'::text THEN c.bill_id::text ELSE lower(COALESCE(c.plan, ''::text)) END), c.issued_on DESC, c.bill_id DESC) s WHERE NOT EXISTS (SELECT 1 FROM books.subscription_ends e WHERE e.vendor_id = s.vendor_id AND e.plan = lower(COALESCE(s.plan, ''::text)) AND e.ended_on >= s.last_billed_on));