CREATE TABLE "heat_days" (
	"day" date NOT NULL,
	"page" varchar(200) NOT NULL,
	"width" varchar(8) NOT NULL,
	"path" varchar(300) NOT NULL,
	"cell" integer NOT NULL,
	"clicks" integer NOT NULL,
	"rage" integer NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_heat_days" PRIMARY KEY("day","page","width","path","cell"),
	CONSTRAINT "ck_heat_days_width" CHECK (("width")::text = ANY ((ARRAY['phone'::character varying, 'tablet'::character varying, 'laptop'::character varying, 'wide'::character varying])::text[]))
);
--> statement-breakpoint
CREATE TABLE "scroll_days" (
	"day" date NOT NULL,
	"page" varchar(200) NOT NULL,
	"width" varchar(8) NOT NULL,
	"band" integer NOT NULL,
	"views" integer NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_scroll_days" PRIMARY KEY("day","page","width","band"),
	CONSTRAINT "ck_scroll_days_width" CHECK (("width")::text = ANY ((ARRAY['phone'::character varying, 'tablet'::character varying, 'laptop'::character varying, 'wide'::character varying])::text[]))
);
--> statement-breakpoint
CREATE VIEW "public"."marketing_heat_records" AS (
  select w.name || ':' || x.width || ':' || x.page id, w.name "window", x.page::text page,
    x.width::text width, sum(x.views)::int views, sum(x.clicks)::int clicks, sum(x.rage)::int rage
  from (
    select day, page, width, coalesce(s.views, 0) views, coalesce(h.clicks, 0) clicks,
      coalesce(h.rage, 0) rage
    from (select day, page, width, views from scroll_days where band = 0) s
    full join (select day, page, width, sum(clicks) clicks, sum(rage) rage from heat_days
      group by day, page, width) h using (day, page, width)
  ) x
  join (values ('7d', 7), ('30d', 30)) w(name, days) on x.day > current_date - w.days
  group by w.name, x.page, x.width);