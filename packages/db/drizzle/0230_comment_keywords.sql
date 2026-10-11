CREATE TABLE "comment_keywords" (
	"id" serial NOT NULL,
	"keyword" varchar(40) NOT NULL,
	"platform" varchar(16),
	"post" varchar(200),
	"dm" text NOT NULL,
	"reply" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "pk_comment_keywords" PRIMARY KEY("id")
);
--> statement-breakpoint
CREATE TABLE "keyword_hits" (
	"id" serial NOT NULL,
	"keyword_id" integer NOT NULL,
	"comment_id" integer NOT NULL,
	"platform" varchar(16) NOT NULL,
	"author" varchar(120) NOT NULL,
	"state" varchar(16) DEFAULT 'queued' NOT NULL,
	"why" text,
	"ref" varchar(200),
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "pk_keyword_hits" PRIMARY KEY("id"),
	CONSTRAINT "uq_keyword_hits_comment_id" UNIQUE("comment_id"),
	CONSTRAINT "uq_keyword_hits_person" UNIQUE("keyword_id","platform","author"),
	CONSTRAINT "ck_keyword_hits_state" CHECK (("state")::text = ANY ((ARRAY['queued'::character varying, 'sent'::character varying, 'failed'::character varying])::text[]))
);
--> statement-breakpoint
ALTER TABLE "keyword_hits" ADD CONSTRAINT "fk_keyword_hits_keyword_id" FOREIGN KEY ("keyword_id") REFERENCES "public"."comment_keywords"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_comment_keywords_scope" ON "comment_keywords" USING btree ("keyword",coalesce("platform", ''),coalesce("post", ''));--> statement-breakpoint
CREATE VIEW "public"."comment_keyword_records" AS (
  select k.id::text as id, k.keyword, coalesce(k.platform, 'any') as platform,
    coalesce(k.post, 'every post') as post, k.dm, k.reply,
    case when k.active then 'on' else 'off' end as state,
    count(h.id)::int as caught,
    count(h.id) filter (where h.state = 'sent')::int as sent,
    count(h.id) filter (where h.state = 'failed')::int as failed,
    max(h.at) as last_at, k.updated_at, k.updated_by
  from comment_keywords k
  left join keyword_hits h on h.keyword_id = k.id
  group by k.id);--> statement-breakpoint
CREATE VIEW "public"."keyword_hit_records" AS (
  select h.id::text as id, k.keyword, h.platform, h.author, c.body as comment,
    c.post_title as post, c.url, h.state, h.why, h.at, h.sent_at
  from keyword_hits h
  join comment_keywords k on k.id = h.keyword_id
  left join comments c on c.id = h.comment_id);