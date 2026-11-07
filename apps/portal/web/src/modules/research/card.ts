/**
 * A run's records as its chat card shows them (`@wren/ui` `ResearchRun`): pages grouped into
 * sources, each with its kept findings. The ledger holds no claims, so the card has none
 * (designs/2026-11-05-research-web.md, Log 11-05).
 */
import {
  type IconName,
  money,
  type ResearchRun,
  type ResearchSource,
  type SourceRead,
} from "@wren/ui";
import type { RunDocument, RunRow, RunView } from "./serve.js";
import { host } from "./tree.js";

/** The run a view part names (`::view research.run {"run":"…"}`). */
export function runOf(data: unknown): string | null {
  const run = (data as { run?: unknown } | null)?.run;
  return typeof run === "string" && run ? run : null;
}

/** The islands: a page's class, the agent's first, then the judge's best guess. */
const KINDS: Record<string, { name: string; icon: IconName }> = {
  primary_data: { name: "Data and studies", icon: "chart" },
  survey: { name: "Data and studies", icon: "chart" },
  practitioner: { name: "Practitioners", icon: "user" },
  forum: { name: "Forums", icon: "chat" },
  news: { name: "News", icon: "news" },
  vendor: { name: "Vendors", icon: "building" },
};
const OTHER = { name: "Other", icon: "globe" } as const;

const best = (guess: Record<string, number> | undefined) =>
  Object.entries(guess ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0];

const YOUTUBE = /(^|\.)(youtube\.com|youtu\.be)$/;
const REDDIT = /(^|\.)reddit\.com$/;

/** A source is who published: a YouTube channel, a subreddit, else a site. */
function sourceOf(d: RunDocument): { id: string; name: string; icon?: IconName } {
  const h = host(d.url);
  if (d.channel && YOUTUBE.test(h))
    return { id: `yt:${d.channel}`, name: d.channel, icon: "video" };
  const sub = REDDIT.test(h) ? /\/r\/([^/]+)/.exec(d.url)?.[1] : undefined;
  return sub ? { id: `rd:${sub.toLowerCase()}`, name: `r/${sub}` } : { id: `site:${h}`, name: h };
}

type Draft = Omit<ResearchSource, "kind" | "findings"> & {
  findings: { text: string }[];
  classes: Map<string, number>;
};

function sourcesOf(view: RunView): ResearchSource[] {
  const made = new Map<string, Draft>();
  const of = new Map<string, Draft>();
  for (const d of view.documents) {
    const at = sourceOf(d);
    const s = made.get(at.id) ?? { ...at, cut: 0, findings: [], classes: new Map() };
    const c = d.class ?? best(d.judge?.class);
    if (c) s.classes.set(c, (s.classes.get(c) ?? 0) + 1);
    made.set(at.id, s);
    of.set(d.id, s);
  }
  for (const f of view.findings) {
    const s = of.get(f.document);
    if (!s) continue;
    if (f.kept) s.findings.push({ text: f.text });
    else s.cut += 1;
  }
  return [...made.values()].map(({ classes, ...s }) => {
    const top = [...classes].sort((a, b) => b[1] - a[1])[0]?.[0];
    const kind = (top && KINDS[top]) || OTHER;
    return { ...s, kind: kind.name, icon: s.icon ?? kind.icon };
  });
}

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

const usd = (view: RunView) =>
  money(
    view.spend.reduce((a, s) => a + s.usd, 0),
    "USD",
    false,
  );

const hrefOf = (run: string) => `/research/runs?run=${encodeURIComponent(run)}`;

/** `row` = the run's line in the list: its ask and start. None while the list loads. */
export function runCard(view: RunView, row: RunRow | null): ResearchRun {
  return {
    id: view.run,
    name: row?.ask || view.run,
    meta: [row ? day(row.started) : null, usd(view)].filter(Boolean).join(" · "),
    searches: view.queries.length,
    hits: view.hits.length,
    pages: view.documents.length,
    claims: [],
    sources: sourcesOf(view),
    href: hrefOf(view.run),
  };
}

const MEDIA: Record<string, string> = { video: "Video", pdf: "PDF" };

/** A run that read one page and searched nothing: the page itself, not a graph of one dot. */
export function sourceRead(view: RunView): SourceRead | null {
  const [d, more] = view.documents;
  if (!d || more || view.queries.length) return null;
  const [source] = sourcesOf(view);
  if (!source) return null;
  return {
    source: { ...source, name: d.title || source.name },
    by: d.channel ?? host(d.url),
    meta: `${MEDIA[d.media] ?? "Page"} · ${usd(view)}`,
    href: hrefOf(view.run),
    // the wider job a channel's one item opens; the card sends it as his turn
    ...(d.channel ? { asks: ["Research the whole channel"] } : {}),
  };
}
