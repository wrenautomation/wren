/**
 * The pipeline as a widget tree over two console views: the funnel (`pipeline_funnel`) and the
 * leaks (`pipeline_leaks`), one row per niche. Every widget exports its view as CSV.
 */
import type { Cell, ViewTable } from "@wren/core/console";
import { type Node, num, PageTree, type Source, Stat, StatStrip, type WidgetProps } from "@wren/ui";
import { BarChart } from "@wren/ui/chart";
import { DataTable } from "@wren/ui/data-table";
import { call } from "../../api.js";
import type { PageProps } from "../../module.js";

const STAGES = [
  { key: "in_play", label: "In play" },
  { key: "with_domain", label: "With a domain" },
  { key: "crawled", label: "Crawled" },
  { key: "named_person", label: "Named person" },
  { key: "verified_named_lead", label: "Verified lead" },
];

const LEAKS = [
  { key: "niche", label: "Niche" },
  { key: "catch_all_leads", label: "Catch-all", numeric: true },
  { key: "risky_leads", label: "Risky", numeric: true },
  { key: "queued_firms", label: "Waiting to resolve", numeric: true },
  { key: "crawled_no_person_firms", label: "Crawled, no person", numeric: true },
];

const records = (t: ViewTable) =>
  t.rows.map((r) => Object.fromEntries(t.columns.map((c, i) => [c, r[i] ?? null])));

const total = (t: ViewTable, key: string) =>
  records(t).reduce((n, r) => n + (typeof r[key] === "number" ? r[key] : 0), 0);

const PAGE: Node = {
  kind: "group",
  layout: "stack",
  children: [
    {
      kind: "widget",
      id: "pipeline.funnel",
      title: "Funnel, every niche",
      source: { view: "pipeline_funnel" },
      size: "full",
      View: ({ data }: WidgetProps<ViewTable>) => (
        <StatStrip className="mb-0">
          {STAGES.map((s) => (
            <Stat key={s.key} label={s.label} value={num(total(data, s.key))} />
          ))}
        </StatStrip>
      ),
    },
    {
      kind: "widget",
      id: "pipeline.by-niche",
      title: "Funnel by niche",
      source: { view: "pipeline_funnel" },
      size: "full",
      View: ({ data }: WidgetProps<ViewTable>) => (
        <BarChart data={records(data)} x="niche" series={STAGES} />
      ),
    },
    {
      kind: "widget",
      id: "pipeline.leaks",
      title: "Leaks",
      source: { view: "pipeline_leaks" },
      size: "full",
      View: ({ data }: WidgetProps<ViewTable>) => (
        <DataTable
          columns={LEAKS}
          rows={records(data) as Record<string, Cell>[]}
          sortBy="crawled_no_person_firms"
        />
      ),
    },
  ],
};

const load = (s: Source) =>
  "view" in s ? call<ViewTable>("console/view", { view: s.view }) : call(s.handler, s.input);

async function csv(view: string) {
  const answer = await call<{ csv: string }>("console/view", { view, format: "csv" });
  const url = URL.createObjectURL(new Blob([answer.csv], { type: "text/csv" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `${view}.csv` });
  a.click();
  URL.revokeObjectURL(url);
}

export default function Pipeline({ team, demo }: PageProps) {
  return <PageTree node={PAGE} viewer={{ team, demo }} load={load} csv={csv} />;
}
