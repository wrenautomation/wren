DROP VIEW "learn"."item_records";--> statement-breakpoint
DROP VIEW "learn"."saved_records";--> statement-breakpoint
DROP VIEW "learn"."source_records";--> statement-breakpoint
ALTER TABLE "learn"."items" DROP CONSTRAINT "uq_learn_items_url";--> statement-breakpoint
ALTER TABLE "learn"."sources" DROP CONSTRAINT "uq_learn_sources_url";--> statement-breakpoint
-- Every row so far is Wren's own: backfilled to its owner id, then required.
ALTER TABLE "learn"."collections" ADD COLUMN "client" varchar(40);--> statement-breakpoint
ALTER TABLE "learn"."seen" ADD COLUMN "client" varchar(40);--> statement-breakpoint
ALTER TABLE "learn"."sources" ADD COLUMN "client" varchar(40);--> statement-breakpoint
UPDATE "learn"."items" SET "client" = 'wren' WHERE "client" IS NULL;--> statement-breakpoint
UPDATE "learn"."collections" SET "client" = 'wren' WHERE "client" IS NULL;--> statement-breakpoint
UPDATE "learn"."seen" SET "client" = 'wren' WHERE "client" IS NULL;--> statement-breakpoint
UPDATE "learn"."sources" SET "client" = 'wren' WHERE "client" IS NULL;--> statement-breakpoint
ALTER TABLE "learn"."items" ALTER COLUMN "client" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "learn"."collections" ALTER COLUMN "client" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "learn"."seen" ALTER COLUMN "client" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "learn"."sources" ALTER COLUMN "client" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "ix_learn_collections_client" ON "learn"."collections" USING btree ("client");--> statement-breakpoint
ALTER TABLE "learn"."seen" DROP CONSTRAINT "pk_seen";
--> statement-breakpoint
ALTER TABLE "learn"."seen" ADD CONSTRAINT "pk_seen" PRIMARY KEY("client","email");--> statement-breakpoint
ALTER TABLE "learn"."items" ADD CONSTRAINT "uq_learn_items_client_url" UNIQUE("client","url");--> statement-breakpoint
ALTER TABLE "learn"."sources" ADD CONSTRAINT "uq_learn_sources_client_url" UNIQUE("client","url");--> statement-breakpoint
CREATE VIEW "learn"."item_records" AS (
    select i.id, i.title, i.kind::text kind, i.type::text type, i.creator,
      coalesce(s.name, 'Saved') source, s.kind::text source_kind, i.source_id,
      i.score::int score, i.summary,
      (select string_agg(c, ', ') from jsonb_array_elements_text(i.changes) c) changes,
      i.why, i.verdict::text verdict,
      case when i.archived_at is not null then 'archived'
        when i.read_at is null and i.read_failure is not null then 'failed'
        when i.read_at is null and i.needs_mac is not null then 'mac'
        when i.read_at is null then 'reading'
        when i.verdict is null then 'scoring'
        when i.verdict = 'show' then 'show' when i.verdict = 'hold' then 'hold'
        else 'drop' end state,
      case when i.archived_at is not null then 'archived' when i.opened_at is not null then 'read'
        else 'unread' end status,
      i.read_failure failure,
      (select string_agg(t.tag, ', ' order by t.tag) from learn.item_tags t
        where t.item_id = i.id) tags,
      col.name collection, i.starred_at is not null starred, i.later_at is not null later,
      i.duration,
      (select string_agg(x.sop, ', ' order by x.sop) from learn.sop_sources x
        where x.item_id = i.id) sops,
      coalesce(i.published_at, i.created_at) at, i.saved_at, i.saved_via::text saved_via,
      i.created_at, i.url open,
      length(coalesce(i.transcript, i.text))::int chars
    from learn.items i left join learn.sources s on s.id = i.source_id
      left join learn.collections col on col.id = i.collection_id
    where i.client = 'wren');--> statement-breakpoint
CREATE VIEW "learn"."saved_records" AS (select * from (
    select i.id, i.title, i.kind::text kind, i.type::text type, i.creator,
      coalesce(s.name, 'Saved') source, s.kind::text source_kind, i.source_id,
      i.score::int score, i.summary,
      (select string_agg(c, ', ') from jsonb_array_elements_text(i.changes) c) changes,
      i.why, i.verdict::text verdict,
      case when i.archived_at is not null then 'archived'
        when i.read_at is null and i.read_failure is not null then 'failed'
        when i.read_at is null and i.needs_mac is not null then 'mac'
        when i.read_at is null then 'reading'
        when i.verdict is null then 'scoring'
        when i.verdict = 'show' then 'show' when i.verdict = 'hold' then 'hold'
        else 'drop' end state,
      case when i.archived_at is not null then 'archived' when i.opened_at is not null then 'read'
        else 'unread' end status,
      i.read_failure failure,
      (select string_agg(t.tag, ', ' order by t.tag) from learn.item_tags t
        where t.item_id = i.id) tags,
      col.name collection, i.starred_at is not null starred, i.later_at is not null later,
      i.duration,
      (select string_agg(x.sop, ', ' order by x.sop) from learn.sop_sources x
        where x.item_id = i.id) sops,
      coalesce(i.published_at, i.created_at) at, i.saved_at, i.saved_via::text saved_via,
      i.created_at, i.url open,
      length(coalesce(i.transcript, i.text))::int chars
    from learn.items i left join learn.sources s on s.id = i.source_id
      left join learn.collections col on col.id = i.collection_id
    where i.client = 'wren') x where x.saved_at is not null);--> statement-breakpoint
CREATE VIEW "learn"."source_records" AS (
    select s.id, s.name, s.url, s.page, s.kind::text kind, s.avatar_url, s.tell::text tell,
      case when s.stopped_at is not null then 'stopped' when s.failure is not null then 'failing'
        else 'following' end state,
      count(i.id)::int items, (count(i.id) filter (where i.verdict = 'show'))::int shown,
      s.fetched_at, s.failure, s.by::text by, s.created_at
    from learn.sources s left join learn.items i on i.source_id = s.id
    where s.client = 'wren'
    group by s.id);