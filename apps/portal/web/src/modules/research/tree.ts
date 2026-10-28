/**
 * A run as one drawing: the ask, its facets, every query (a follow from the page it started on),
 * the pages read and the people who wrote them. Hits fold into each query's numbers; `hits` draws
 * each one (807 in a big run: elk takes seconds). Findings stay a count on their page.
 * Ids carry the kind: `q:`, `h:`, `d:`, `p:`, `f:` (a facet), `ask`.
 */
import type { GraphEdge, GraphNode, GraphTone } from "@wren/ui";
import type { RunDocument, RunHit, RunRow, RunView } from "./serve.js";

export type Zoom = "pages" | "hits";

export const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

type Tone = Exclude<GraphTone, "accent">;
const QUALITY: Record<string, Tone> = { rich: "good", thin: "warn", off: "bad", empty: "bad" };

/** A page's tone: its verdict, else whether a kept finding sits on it. */
export function toneOf(d: RunDocument, kept: number): Tone {
  if (d.verdict) return QUALITY[d.verdict.quality] ?? "neutral";
  return kept ? "good" : "neutral";
}

export function keptBy(view: RunView): Map<string, number> {
  const out = new Map<string, number>();
  for (const f of view.findings) if (f.kept) out.set(f.document, (out.get(f.document) ?? 0) + 1);
  return out;
}

export function treeOf(
  view: RunView,
  row: Pick<RunRow, "ask"> | null,
  zoom: Zoom,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const kept = keptBy(view);
  const hitOf = new Map(view.hits.map((h) => [h.id, h]));

  nodes.push({
    id: "ask",
    kind: "account",
    dashed: true,
    label: row?.ask || "The ask",
    number: { value: view.findings.filter((f) => f.kept).length, label: "kept findings" },
  });
  const facets = [...new Set(view.queries.flatMap((q) => (q.facet ? [q.facet] : [])))];
  for (const f of facets) {
    const qs = view.queries.filter((q) => q.facet === f);
    nodes.push({
      id: `f:${f}`,
      kind: "workflow",
      label: f,
      number: { value: qs.length, label: qs.length === 1 ? "query" : "queries" },
      facets: { Kind: "Facet" },
    });
    edges.push({ from: "ask", to: `f:${f}` });
  }

  for (const q of view.queries) {
    const wrote = q.hits.map((id) => hitOf.get(id)).filter((h): h is RunHit => !!h);
    const keep = wrote.filter((h) => h.call?.verdict === "keep").length;
    nodes.push({
      id: `q:${q.id}`,
      kind: "step",
      label: q.follow ? `${q.follow.as} of ${host(q.follow.url)}` : q.terms,
      note: q.site ? `on ${q.site}` : undefined,
      number: { value: q.hits.length, label: "new hits" },
      more: q.again.length ? { value: q.again.length, label: "found again" } : undefined,
      state: keep ? { label: `${keep} kept`, tone: "good" } : undefined,
      stacked: q.hits.length > 1,
      hover: [q.why, `${q.from} · ${q.by}`],
      facets: { Kind: q.follow ? "Follow" : "Query", Round: String(q.round) },
    });
    // A follow hangs off the page it started from; a query off its facet, else the ask.
    const followFrom = q.follow?.document;
    if (followFrom && view.documents.some((d) => d.id === followFrom))
      edges.push({ from: `d:${followFrom}`, to: `q:${q.id}`, kind: "follow", label: "follow" });
    else edges.push({ from: q.facet ? `f:${q.facet}` : "ask", to: `q:${q.id}` });

    if (zoom === "hits")
      for (const h of wrote) {
        nodes.push({
          id: `h:${h.id}`,
          kind: "record",
          label: h.title || host(h.url),
          note: host(h.url),
          dim: h.call?.verdict === "drop",
          state: h.call
            ? { label: h.call.verdict, tone: h.call.verdict === "keep" ? "good" : "neutral" }
            : undefined,
          facets: { Kind: "Hit", Source: h.sources.join(", ") },
        });
        edges.push({ from: `q:${q.id}`, to: `h:${h.id}` });
      }
  }

  for (const d of view.documents) {
    const n = kept.get(d.id) ?? 0;
    const tone = toneOf(d, n);
    nodes.push({
      id: `d:${d.id}`,
      kind: "record",
      label: d.title || host(d.url),
      note: [host(d.url), d.class].filter(Boolean).join(" · "),
      number: { value: n, label: n === 1 ? "kept finding" : "kept findings" },
      state: d.verdict ? { label: d.verdict.quality, tone } : undefined,
      dim: !n && !d.verdict,
      facets: { Kind: "Page", Media: d.media, ...(d.class ? { Class: d.class } : {}) },
    });
    const hit = hitOf.get(d.hit);
    if (zoom === "hits" && hit) edges.push({ from: `h:${hit.id}`, to: `d:${d.id}` });
    else {
      // A page hangs off the query that first found it; a page named by hand, off the ask.
      const q = hit?.queries[0];
      edges.push({ from: q ? `q:${q}` : "ask", to: `d:${d.id}`, label: n ? undefined : "read" });
    }
  }

  for (const p of view.brief.people ?? []) {
    const theirs = view.documents.filter((d) => d.person === p.id);
    if (!theirs.length) continue;
    nodes.push({
      id: `p:${p.id}`,
      kind: "account",
      label: p.name,
      number: { value: theirs.length, label: theirs.length === 1 ? "page" : "pages" },
      facets: { Kind: "Person" },
    });
    for (const d of theirs) edges.push({ from: `d:${d.id}`, to: `p:${p.id}`, kind: "person" });
  }
  return { nodes, edges };
}
