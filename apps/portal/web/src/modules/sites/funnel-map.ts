/** The Funnel's rows as a graph: sources, pages, forms, bookings. Pure, so it's tested alone. */
import type { Row } from "@wren/core/records/serve";
import type { GraphEdge, GraphNode } from "@wren/ui";

const SOURCES: Record<string, string> = {
  ads: "Ads",
  organic: "Organic",
  outreach: "Outreach",
  referral: "Referral",
  direct: "Direct",
  other: "Other",
};
const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** The funnel's rows (a page per source) as nodes and wires. */
export function funnelGraph(rows: readonly Row[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const sources = new Map<string, number>();
  const pages = new Map<string, { title: string; views: number; forms: number; books: number }>();
  const edges: GraphEdge[] = [];
  for (const r of rows) {
    const views = n(r.views);
    if (!views && !n(r.forms)) continue;
    const src = String(r.channel ?? "other");
    const page = String(r.page ?? r.title ?? "");
    sources.set(src, (sources.get(src) ?? 0) + views);
    const p = pages.get(page) ?? { title: String(r.title ?? "Page"), views: 0, forms: 0, books: 0 };
    p.views += views;
    p.forms += n(r.forms);
    p.books += n(r.books);
    pages.set(page, p);
    edges.push({ from: `src:${src}`, to: `page:${page}`, count: { value: views } });
  }
  const forms = [...pages.values()].reduce((s, p) => s + p.forms, 0);
  const books = [...pages.values()].reduce((s, p) => s + p.books, 0);
  const nodes: GraphNode[] = [
    ...[...sources].map(
      ([src, views]): GraphNode => ({
        id: `src:${src}`,
        kind: "account",
        dashed: true,
        label: SOURCES[src] ?? src,
        number: { value: views, label: "visits" },
        facets: { Source: SOURCES[src] ?? src },
      }),
    ),
    ...[...pages].map(
      ([id, p]): GraphNode => ({
        id: `page:${id}`,
        kind: "record",
        label: p.title,
        number: { value: p.views, label: "visits" },
        href: /^[0-9a-f-]{36}$/.test(id) ? `/sites/pages/${id}` : undefined,
      }),
    ),
    { id: "forms", kind: "step", label: "Form sent", number: { value: forms, label: "forms" } },
    { id: "books", kind: "step", label: "Booked", number: { value: books, label: "calls" } },
  ];
  for (const [id, p] of pages)
    if (p.forms)
      edges.push({
        from: `page:${id}`,
        to: "forms",
        count: { value: p.forms },
        rate: { from: p.views, to: p.forms },
      });
  if (books)
    edges.push({
      from: "forms",
      to: "books",
      count: { value: books },
      rate: { from: forms, to: books },
    });
  return { nodes, edges };
}
