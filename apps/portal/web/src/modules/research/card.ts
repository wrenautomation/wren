/**
 * A run as its chat card: the Research page's own graph data (`runGraphOf`), its link and the
 * agent's next asks; a run of one page is that page (designs/2026-11-05-research-web.md).
 */
import { money } from "@wren/ui";
import type { NextAsk, RunCardProps, SourceRead } from "@wren/ui/research/run";
import { runGraphOf } from "./graph.js";
import type { RunRow, RunView } from "./serve.js";
import { host } from "./tree.js";

/** The run a view part names (`::view research.run {"run":"…"}`). */
export function runOf(data: unknown): string | null {
  const run = (data as { run?: unknown } | null)?.run;
  return typeof run === "string" && run ? run : null;
}

const hrefOf = (run: string) => `/research/runs?run=${encodeURIComponent(run)}`;

/** `row` = the run's line in the list: its ask and start. None while the list loads. */
export function runCard(view: RunView, row: RunRow | null): RunCardProps {
  return { run: runGraphOf(view, row), href: hrefOf(view.run), asks: asksOf(view) };
}

/** The agent's asks; `extra` = fixed ones the card adds, dropped when the agent named the same. */
function asksOf(view: RunView, extra: string[] = []): NextAsk[] {
  const got = (view.asks ?? []).map((a) => ({ ask: a.ask, why: a.why }));
  const named = new Set(got.map((a) => a.ask.toLowerCase()));
  return [...got, ...extra.filter((e) => !named.has(e.toLowerCase())).map((ask) => ({ ask }))];
}

const MEDIA: Record<string, string> = { video: "Video", pdf: "PDF" };

/** A run that read one page and searched nothing: the page itself, not a graph of one dot. */
export function sourceRead(view: RunView): SourceRead | null {
  const [d, more] = view.documents;
  if (!d || more || view.queries.length) return null;
  const fs = view.findings.filter((f) => f.document === d.id);
  const usd = money(
    view.spend.reduce((a, s) => a + s.usd, 0),
    "USD",
    false,
  );
  return {
    name: d.title || host(d.url),
    by: d.channel ?? host(d.url),
    meta: `${MEDIA[d.media] ?? "Page"} · ${usd}`,
    findings: fs.filter((f) => f.kept).map((f) => ({ text: f.text })),
    cut: fs.filter((f) => !f.kept).length,
    href: hrefOf(view.run),
    // a channel's one item always opens the whole channel
    asks: asksOf(view, d.channel ? ["Research the whole channel"] : []),
  };
}
