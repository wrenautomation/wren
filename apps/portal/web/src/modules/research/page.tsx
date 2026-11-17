/**
 * A weaver run whole (designs/2026-11-05-research-web.md, 11-08, 11-10), opened from Explorer ›
 * Weaver (WA-1373); the list and its folders are Explorer's now.
 * One run opens on its references, best first (WA-1404: reference first), else its graph (round
 * 13: claims, sources, searches, dropped hits); the back and forth holds every decision with its
 * why and who made it. Picked runs, or all of them, open on one graph. Read only: the agent and the CLI write. Live: serve sends an event per change.
 */

import {
  Button,
  cx,
  Empty,
  Facts,
  Icon,
  LoadFailed,
  Loading,
  money,
  Seg,
  StateMark,
} from "@wren/ui";
import { type ReactNode, useMemo, useState } from "react";
import { useCall } from "../../load.js";
import { href, navigate, useRoute } from "../../route.js";
import { usePageRuns } from "../agent/drive.js";
import { GALLERY, Ghosts, Tile } from "../canon/gallery.js";
import { PostDetail, PostPlayer } from "../canon/post-detail.js";
import { PinToBoard } from "../variants/pin-to.js";
import { QUIET } from "../work/bits.js";
import { RowsPanel } from "../work/rows-panel.js";
import { boardPages, Patterns, Splits, Wall } from "./board.js";
import { RunsCanvas } from "./canvas.js";
import {
  type Moment,
  type PageSignals,
  pageOf,
  type ReadPick,
  type RunDocument,
  type RunFinding,
  type RunHit,
  type RunQuery,
  type RunRow,
  type RunView,
  runsOf,
  SERVE,
  useLive,
  useViews,
} from "./serve.js";
import { host, keptBy, toneOf } from "./tree.js";

type Tab = "refs" | "graph" | "talk";
type Go = (p: Record<string, string | null>) => void;
type Link = (p: Record<string, string | null>) => string;

// PT-7: a view is a tab over the same run; references first (WA-1404)
const TABS = [
  { value: "refs", label: "References" },
  { value: "graph", label: "Graph" },
  { value: "talk", label: "Back and forth" },
] as const;
/** The address's tab; none: references when the run has read pages, else the graph. `list`: old links. */
function tabOf(t: string | null, view: RunView | undefined): Tab | null {
  if (t === "talk" || t === "graph") return t;
  if (t === "refs" || t === "list") return "refs";
  if (!view) return null;
  return view.brief.readList?.length || view.brief.unpicked?.length ? "refs" : "graph";
}
const LINK = "inline-flex items-center gap-1 wrap-anywhere text-(--ui-ink) underline";
const PRE =
  "m-0 max-h-[420px] overflow-auto border border-(--ui-hair) bg-(--ui-tile) p-2.5 text-[13px] leading-[1.55] whitespace-pre-wrap wrap-anywhere text-(--ui-ink)";

const when = (iso: string) =>
  iso ? new Date(iso).toLocaleString("en-US", { hour: "numeric", minute: "2-digit" }) : "";
const usd = (n: number) => money(n, "USD", false);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What the page says when serve is off, or Chrome has not let the portal reach it. */
export function NoServe({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <Empty
      title="Can't reach weaver serve"
      action={
        <Button size="dense" tone="secondary" onClick={onRetry}>
          Try again
        </Button>
      }
    >
      <span className="grid gap-1">
        <span>
          Run <code>weaver serve --ledger &lt;a folder&gt; --also &lt;more folders&gt;</code> on
          this Mac. It listens on {SERVE}.
        </span>
        <span>If Chrome asks to let this site reach your local network, allow it.</span>
        <span className={QUIET}>{error instanceof Error ? error.message : String(error)}</span>
      </span>
    </Empty>
  );
}

/** `?run=` names one run, several (comma separated), or `all`. Oldest first: run 1 came first. */
function runsIn(open: string, rows: readonly RunRow[]): string[] {
  if (open !== "all") return open.split(",").filter(Boolean);
  return rows
    .slice()
    .sort((a, b) => a.started.localeCompare(b.started))
    .map((r) => r.run);
}

/**
 * Runs opened whole in Explorer › Weaver (WA-1373): `open` names one run, several (comma
 * separated), or `all`. `back` returns to the tree.
 */
export function RunWhole({
  open,
  params,
  back,
}: {
  open: string;
  params: URLSearchParams;
  back: ReactNode;
}) {
  const here = `/${useRoute().path.join("/")}`;
  const runs = useCall("research:runs", runsOf, { kept: false });
  useLive(() => runs.retry());
  if (runs.error && !runs.data) return <NoServe error={runs.error} onRetry={runs.retry} />;
  if (open === "all" && !runs.data) return <Loading shape="rows" lines={5} />;
  return (
    <Opened key={open} open={open} rows={runs.data ?? []} params={params} here={here} back={back} />
  );
}

/** One run, or several on one graph. */
function Opened({
  open,
  rows,
  params,
  here,
  back,
}: {
  open: string;
  rows: readonly RunRow[];
  params: URLSearchParams;
  here: string;
  back: ReactNode;
}) {
  const ids = useMemo(() => runsIn(open, rows), [open, rows]);
  const link: Link = (p) => href(here, p, params);
  const go: Go = (p) => navigate(link(p), true);
  const [one] = ids;
  if (ids.length === 1 && one)
    return (
      <OneRun
        run={one}
        row={rows.find((r) => r.run === one) ?? null}
        params={params}
        go={go}
        link={link}
        back={back}
      />
    );
  return <ManyRuns ids={ids} rows={rows} open={open} back={back} />;
}

/** Several runs on one graph. */
function ManyRuns({
  ids,
  rows,
  open,
  back,
}: {
  ids: string[];
  rows: readonly RunRow[];
  open: string;
  back: ReactNode;
}) {
  usePageRuns(ids);
  return (
    <div className="grid min-w-0 gap-4">
      <div className="justify-self-start">{back}</div>
      <RunsCanvas
        runs={ids}
        rows={rows}
        title={open === "all" ? "All runs" : `${ids.length} runs together`}
      />
    </div>
  );
}

function OneRun({
  run,
  row,
  params,
  go,
  link,
  back,
}: {
  run: string;
  row: RunRow | null;
  params: URLSearchParams;
  go: Go;
  link: Link;
  back: ReactNode;
}) {
  const card = params.get("open");
  const ids = useMemo(() => [run], [run]);
  const rows = useMemo(() => (row ? [row] : []), [row]);
  const got = useViews(ids);
  const view = got.views?.[0];
  const tab = tabOf(params.get("tab"), view);
  // only the graph tab draws a graph
  usePageRuns(tab === "graph" ? ids : undefined);
  return (
    <div className="grid min-w-0 gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {back}
        <Seg
          label="What to show"
          items={TABS}
          value={tab ?? "refs"}
          onChange={(t) => go({ tab: t, open: null })}
        />
      </div>
      {view ? <RunHead view={view} row={row} /> : null}
      {tab === "graph" ? (
        <RunsCanvas runs={ids} rows={rows} title="" />
      ) : got.error && !view ? (
        <LoadFailed error={got.error} onRetry={got.retry} />
      ) : !view ? (
        tab === "talk" ? (
          <Loading lines={8} />
        ) : (
          <Ghosts label="Loading the run" />
        )
      ) : tab === "refs" ? (
        <References view={view} card={card} go={go} link={link} />
      ) : (
        <Talk view={view} card={card} go={go} />
      )}
    </div>
  );
}

/** the brief's question, for a run the list has no row for */
const askOf = (view: RunView) => {
  const ask = view.brief.ask as { text?: unknown } | undefined;
  return typeof ask?.text === "string" ? ask.text : null;
};

function RunHead({ view, row }: { view: RunView; row: RunRow | null }) {
  const kept = view.findings.filter((f) => f.kept).length;
  const total = view.spend.reduce((a, s) => a + s.usd, 0);
  const picks = view.brief.readList?.length;
  // the rows are cost detail: a tap opens them, at 390 too
  const spend: ReactNode = view.spend.length ? (
    <details>
      <summary className="cursor-pointer">{usd(total)}</summary>
      <ul className={cx("m-0 mt-1 grid list-none gap-0.5 p-0 text-[12.5px]", QUIET)}>
        {view.spend.map((s) => (
          <li key={`${s.source} ${s.op}`}>
            {s.source} {s.op}: {plural(s.calls, "call")}
            {s.failed ? ` (${s.failed} failed)` : ""}, {usd(s.usd)}
          </li>
        ))}
      </ul>
    </details>
  ) : (
    usd(total)
  );
  const items: [string, ReactNode][] = [
    ["Picks", picks ?? 0],
    ["Pages read", view.documents.length],
    ["Searches", view.queries.length],
    ["Findings", `${kept} kept of ${view.findings.length}`],
    ["Spend", spend],
    [
      "Status",
      `${row?.next ? `next: round ${row.next.round} ${row.next.step}` : "stopped"}${row?.note ? ` (${row.note})` : ""}`,
    ],
  ];
  return (
    <header className="grid gap-2.5">
      <h2 className="m-0 text-[18px] leading-[1.35] font-semibold wrap-anywhere">
        {row?.ask || askOf(view) || view.run}
      </h2>
      {/* two short columns side by side: the posters stay near the top, at 390 too */}
      <div className="flex flex-wrap gap-x-6 gap-y-1.5">
        <Facts items={items.slice(0, 3)} className="tabular-nums" />
        <Facts items={items.slice(3)} className="tabular-nums" />
      </div>
    </header>
  );
}

/** What a node or row opens: a query, a hit, a page, a person, a facet. */
function Card({ view, id, go }: { view: RunView; id: string; go: Go }) {
  const [kind, ...rest] = id.split(":");
  const key = rest.join(":");
  if (kind === "q") {
    const q = view.queries.find((x) => x.id === key);
    return q ? <QueryCard view={view} q={q} go={go} /> : null;
  }
  if (kind === "h") {
    const h = view.hits.find((x) => x.id === key);
    return h ? <HitCard view={view} h={h} go={go} /> : null;
  }
  if (kind === "d") {
    const d = view.documents.find((x) => x.id === key);
    return d ? <PageCard view={view} d={d} go={go} /> : null;
  }
  if (kind === "p") {
    const p = view.brief.people?.find((x) => x.id === key);
    if (!p) return null;
    return (
      <Box title={p.name} sub="One author across sites">
        <Links urls={p.profiles ?? []} />
        <HitList
          view={view}
          hits={view.documents.filter((d) => d.person === p.id).map((d) => d.hit)}
          go={go}
        />
      </Box>
    );
  }
  if (kind === "f") {
    const qs = view.queries.filter((q) => q.facet === key);
    return (
      <Box title={key} sub={`A facet of the ask: ${plural(qs.length, "query", "queries")}`}>
        <ul className="m-0 grid list-none gap-1 p-0 text-[13.5px]">
          {qs.map((q) => (
            <li key={q.id}>
              <button
                type="button"
                className={cx(LINK, "cursor-pointer")}
                onClick={() => go({ open: `q:${q.id}` })}
              >
                {q.terms}
              </button>
            </li>
          ))}
        </ul>
      </Box>
    );
  }
  return null;
}

function Box({ title, sub, children }: { title: ReactNode; sub?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid min-w-0 gap-2.5 border border-(--ui-hair) bg-(--ui-paper) p-3">
      <header className="grid gap-0.5">
        <h3 className="m-0 text-[14px] font-semibold wrap-anywhere">{title}</h3>
        {sub ? <span className={cx("text-[12.5px] wrap-anywhere", QUIET)}>{sub}</span> : null}
      </header>
      {children}
    </section>
  );
}

const Who = ({ x }: { x: { from: string; by: string } }) => (
  <span className={QUIET}>
    {x.from} · {x.by}
  </span>
);

function Links({ urls }: { urls: readonly string[] }) {
  if (!urls.length) return null;
  return (
    <ul className="m-0 grid list-none gap-1 p-0 text-[13px]">
      {urls.map((u) => (
        <li key={u}>
          <a href={u} target="_blank" rel="noreferrer" className={LINK}>
            {u} <Icon name="external" size={12} />
          </a>
        </li>
      ))}
    </ul>
  );
}

function QueryCard({ view, q, go }: { view: RunView; q: RunQuery; go: Go }) {
  return (
    <Box
      title={q.follow ? `Follow ${q.follow.as} of ${q.follow.url}` : q.terms}
      sub={
        <>
          Round {q.round} · {when(q.at)}
          {q.site ? ` · on ${q.site}` : ""}
          {q.facet ? ` · ${q.facet}` : ""} · <Who x={q} />
        </>
      }
    >
      <p className="m-0 text-[13.5px]">Why: {q.why}</p>
      {q.follow ? <Links urls={[q.follow.url]} /> : null}
      <HitList view={view} hits={q.hits} go={go} />
      {q.again.length ? (
        <>
          <span className={cx("text-[12.5px]", QUIET)}>Found again</span>
          <HitList view={view} hits={q.again} go={go} />
        </>
      ) : null}
    </Box>
  );
}

/** Hits as links out, each with its call; the name opens its card. */
function HitList({ view, hits, go }: { view: RunView; hits: readonly string[]; go: Go }) {
  const of = useMemo(() => new Map(view.hits.map((h) => [h.id, h])), [view]);
  const list = hits.map((id) => of.get(id)).filter((h): h is RunHit => !!h);
  if (!list.length) return <p className={cx("m-0 text-[13px]", QUIET)}>No hits.</p>;
  return (
    <ol className="m-0 grid list-none gap-1.5 p-0 text-[13.5px]">
      {list.map((h) => (
        <li key={h.id} className="grid gap-0.5">
          <span className="flex flex-wrap items-baseline gap-x-2">
            <button
              type="button"
              className={cx(
                LINK,
                "cursor-pointer text-left",
                h.call?.verdict === "drop" && "opacity-60",
              )}
              onClick={() => go({ open: `h:${h.id}` })}
            >
              {h.title || host(h.url)}
            </button>
            {h.call ? (
              <StateMark
                state={{
                  label: h.call.verdict,
                  tone: h.call.verdict === "keep" ? "good" : "neutral",
                }}
              />
            ) : null}
            {h.document ? <span className={cx("text-[12px]", QUIET)}>read</span> : null}
          </span>
          <a
            href={h.url}
            target="_blank"
            rel="noreferrer"
            className={cx("text-[12px] wrap-anywhere", QUIET)}
          >
            {h.url}
          </a>
        </li>
      ))}
    </ol>
  );
}

function HitCard({ view, h, go }: { view: RunView; h: RunHit; go: Go }) {
  const qs = view.queries.filter((q) => h.queries.includes(q.id));
  const d = h.document ? view.documents.find((x) => x.id === h.document) : undefined;
  return (
    <div className="grid gap-3">
      <Box
        title={
          <a href={h.url} target="_blank" rel="noreferrer" className={LINK}>
            {h.title || h.url} <Icon name="external" size={12} />
          </a>
        }
        sub={[host(h.url), h.channel, h.date, `from ${h.sources.join(", ")}`]
          .filter(Boolean)
          .join(" · ")}
      >
        {h.snippet ? <p className="m-0 text-[13.5px]">{h.snippet}</p> : null}
        {h.call ? (
          <p className="m-0 text-[13.5px]">
            {h.call.verdict === "keep" ? "Kept" : "Dropped"}
            {h.call.why ? `: ${h.call.why}` : ""} <Who x={h.call} />
          </p>
        ) : (
          <p className={cx("m-0 text-[13.5px]", QUIET)}>Not called yet.</p>
        )}
        <Judge answers={h.judge} />
        <span className={cx("text-[12.5px]", QUIET)}>Found by</span>
        <ul className="m-0 grid list-none gap-1 p-0 text-[13.5px]">
          {qs.map((q) => (
            <li key={q.id}>
              <button
                type="button"
                className={cx(LINK, "cursor-pointer text-left")}
                onClick={() => go({ open: `q:${q.id}` })}
              >
                {q.follow ? `follow ${q.follow.as} of ${host(q.follow.url)}` : q.terms}
              </button>
            </li>
          ))}
        </ul>
      </Box>
      {d ? <PageCard view={view} d={d} go={go} /> : null}
    </div>
  );
}

/** The judge's answers, as a hint: each question's best answer and its weight. */
function Judge({ answers }: { answers: Record<string, Record<string, number>> | undefined }) {
  if (!answers) return null;
  const lines = Object.entries(answers).map(([q, a]) => {
    const [best, p] = Object.entries(a).sort((x, y) => y[1] - x[1])[0] ?? ["", 0];
    return `${q}: ${best} ${Math.round(p * 100)}%`;
  });
  return <p className={cx("m-0 text-[12.5px]", QUIET)}>Judge: {lines.join(" · ")}</p>;
}

function PageCard({ view, d, go }: { view: RunView; d: RunDocument; go: Go }) {
  // the References player, so a page plays the same on every tab
  const post = useMemo(() => boardPages(view).get(d.id)?.r, [view, d.id]);
  const findings = view.findings.filter((f) => f.document === d.id);
  const kept = keptBy(view).get(d.id) ?? 0;
  const person = d.person ? view.brief.people?.find((p) => p.id === d.person) : undefined;
  return (
    <Box
      title={
        <a href={d.url} target="_blank" rel="noreferrer" className={LINK}>
          {d.title || d.url} <Icon name="external" size={12} />
        </a>
      }
      sub={[
        host(d.url),
        d.media,
        d.channel,
        d.date,
        `${d.speaker.value.replace(/_/g, " ")}, ${d.evidence.value}`,
        `${d.chars.toLocaleString()} characters`,
      ]
        .filter(Boolean)
        .join(" · ")}
    >
      <p className="m-0 flex flex-wrap items-baseline gap-2 text-[13.5px]">
        {d.verdict ? (
          <StateMark state={{ label: d.verdict.quality, tone: toneOf(d, kept) }} />
        ) : null}
        {d.verdict?.gap ? <span>Gap: {d.verdict.gap}</span> : null}
        {person ? (
          <button
            type="button"
            className={cx(LINK, "cursor-pointer")}
            onClick={() => go({ open: `p:${person.id}` })}
          >
            by {person.name}
          </button>
        ) : null}
      </p>
      <Judge answers={d.judge} />
      {post ? <PostPlayer r={post} /> : null}
      <Findings findings={findings} />
      <StoredCopy run={view.run} id={d.id} />
    </Box>
  );
}

/** A page's findings: each with its quote, kept or not, its evidence, who and its checks. */
function Findings({ findings }: { findings: readonly RunFinding[] }) {
  return findings.length ? (
    <ol className="m-0 grid list-none gap-2 p-0">
      {findings.map((f) => (
        <li key={f.id} className="grid gap-1">
          <span className={cx("text-[13.5px]", !f.kept && "opacity-70")}>
            {f.text}
            {f.date ? <span className={QUIET}> ({f.date})</span> : null}
          </span>
          {f.quote ? <q className={cx("text-[12.5px] italic", QUIET)}>{f.quote}</q> : null}
          <span className="text-[12px]">
            {/* state: dot + word, no side stripe */}
            <span
              aria-hidden
              className={cx(
                "mr-1.5 inline-block size-1.5 rounded-full align-middle",
                f.kept ? "bg-(--ui-good)" : "bg-(--ui-hair)",
              )}
            />
            {f.kept ? "Kept" : "Not kept"}
            {` · ${f.evidence.value}`} · <Who x={f} />
            {f.checks.map((c) => (
              <span key={c.at} className={c.ok ? undefined : "text-(--ui-bad)"}>
                {" "}
                · check {c.ok ? "backed" : "failed"}: {c.why}
              </span>
            ))}
          </span>
        </li>
      ))}
    </ol>
  ) : (
    <p className={cx("m-0 text-[13px]", QUIET)}>No findings on this page.</p>
  );
}

/** The text weaver kept of a page, on ask. */
function StoredCopy({ run, id }: { run: string; id: string }) {
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const show = async () => {
    setBusy(true);
    setFailed(null);
    try {
      setText((await pageOf(run, id)).text);
    } catch (err) {
      setFailed(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return text !== null ? (
    <pre className={PRE}>{text}</pre>
  ) : (
    <span className="flex flex-wrap items-center gap-3">
      <Button size="dense" tone="secondary" busy={busy} onClick={() => void show()}>
        Show the stored copy
      </Button>
      {failed ? <span className="text-[12.5px] text-(--ui-bad)">{failed}</span> : null}
    </span>
  );
}

/** The why's "Copy: …" sentence, the tile's line; the whole why opens in the detail. */
export function copyOf(why: string): string | null {
  const m = /\bCopy(?: first)?:\s*(.+)$/s.exec(why);
  return m?.[1] ? `Copy: ${m[1].trim()}` : null;
}

/** seconds; old serves send a string */
const lengthOf = (d: RunDocument | undefined) => {
  const n = Number(d?.length);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

/**
 * The run's references, best first (weaver `brief.readList`, WA-1404): a gallery feed (PT-6, the
 * Outliers tiles). Under it the board (WA-1405): pattern shelves, then every other page read.
 * Any tile opens the post whole, with the agent's why (a pick) and the findings it gave.
 */
function References({
  view,
  card,
  go,
  link,
}: {
  view: RunView;
  card: string | null;
  go: Go;
  link: Link;
}) {
  const list = view.brief.readList;
  const pages = useMemo(() => boardPages(view), [view]);
  const picks = (list ?? []).flatMap((p) => pages.get(p.id) ?? []);
  const rest = useMemo(() => [...pages.values()].filter((x) => !x.pick), [pages]);
  const openId = card?.startsWith("d:") ? card.slice(2) : null;
  const opened = openId ? (pages.get(openId) ?? null) : undefined;
  if (!pages.size)
    return (
      <Empty title="No references yet" waits>
        {list
          ? "The agent has not ranked the pages it read yet. They show here, best first, once it does."
          : "This weaver serve sends no read list. Run weaver 0.79.0 or later."}
      </Empty>
    );
  return (
    <div className="grid gap-8">
      <section aria-labelledby="board-picks" className="grid gap-3">
        <h3 id="board-picks" className="m-0 text-[15px] font-semibold">
          Picks <span className="font-normal text-(--ui-ink-3) tabular-nums">{picks.length}</span>
        </h3>
        {picks.length ? (
          <ul aria-label="References" className={cx("m-0 list-none p-0", GALLERY)}>
            {picks.flatMap(({ pick: p, d, r }) => {
              if (!p) return [];
              return (
                <li key={p.id} className="min-w-0 [animation:ui-fade_.15s_both]">
                  <Tile
                    r={r}
                    canon={null}
                    open={link({ open: `d:${p.id}` })}
                    rank={p.rank}
                    length={lengthOf(d)}
                    note={copyOf(p.why)}
                    // a score comes only from the agent's follow reads, never on its own
                    unscored={null}
                  />
                </li>
              );
            })}
          </ul>
        ) : (
          <p className={cx("m-0 text-[13px]", QUIET)}>The agent has not picked pages yet.</p>
        )}
      </section>
      <Splits view={view} pages={pages} link={link} />
      <Patterns view={view} pages={pages} link={link} />
      <Wall pages={rest} link={link} />
      {opened !== undefined ? (
        <PostDetail
          key={openId ?? ""}
          r={opened?.r ?? null}
          canon={null}
          save={null}
          creatorHref={null}
          face={null}
          also={[]}
          about="A page the run read, whole: the post, its numbers and what it gave."
          onClose={() => go({ open: null })}
        >
          {opened ? (
            <>
              <PinToBoard
                pin={{
                  url: opened.s.url,
                  title: opened.r.title ?? opened.r.text,
                  poster: opened.r.full,
                  from: { weaver: { run: view.run, page: opened.s.id } },
                }}
              />
              <PageWhy view={view} s={opened.s} pick={opened.pick} d={opened.d} />
            </>
          ) : null}
        </PostDetail>
      ) : null}
    </div>
  );
}

/** The detail's own part: a pick's why, the page's verdict, the findings, the stored copy. */
function PageWhy({
  view,
  s,
  pick,
  d,
}: {
  view: RunView;
  s: PageSignals;
  pick: ReadPick | undefined;
  d: RunDocument | undefined;
}) {
  const findings = view.findings.filter((f) => f.document === s.id);
  return (
    <>
      {pick ? (
        <section aria-labelledby="pick-why" className="grid gap-2">
          <h3 id="pick-why" className="m-0 text-[13px] font-semibold text-(--ui-ink-2)">
            Why it's a reference{pick.rank != null ? ` (rank ${pick.rank})` : ""}
          </h3>
          <p className="m-0 text-[14px] leading-[1.5] text-(--ui-ink)">{pick.why}</p>
        </section>
      ) : null}
      {d?.verdict ? (
        <p className={cx("m-0 text-[12.5px]", QUIET)}>
          The page reads {d.verdict.quality}
          {d.verdict.gap ? `; gap: ${d.verdict.gap}` : ""}
        </p>
      ) : null}
      <section aria-labelledby="pick-findings" className="grid gap-2">
        <h3 id="pick-findings" className="m-0 text-[13px] font-semibold text-(--ui-ink-2)">
          Findings ({s.kept} kept of {s.kept + s.dropped})
        </h3>
        <Findings findings={findings} />
        <StoredCopy run={view.run} id={s.id} />
      </section>
    </>
  );
}

/** Every decision in time order, a fold per round: what, why, who. */
function Talk({ view, card, go }: { view: RunView; card: string | null; go: Go }) {
  const groups = useMemo(() => {
    const by = new Map<number, Moment[]>();
    for (const m of view.timeline) by.set(m.round, [...(by.get(m.round) ?? []), m]);
    return [...by].map(([round, rows]) => ({ key: String(round), label: `Round ${round}`, rows }));
  }, [view]);
  const target = (m: Moment): string | null => {
    if (m.type === "query") return `q:${m.id}`;
    if (!m.on) return null;
    if (view.hits.some((h) => h.id === m.on)) return `h:${m.on}`;
    if (view.documents.some((d) => d.id === m.on)) return `d:${m.on}`;
    const f = view.findings.find((x) => x.id === m.on);
    return f ? `d:${f.document}` : null;
  };
  const picked = card?.slice(2) ?? null;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 @min-[1140px]/main:grid-cols-[minmax(0,1fr)_minmax(340px,440px)]">
      <RowsPanel<Moment>
        groups={groups}
        rowKey={(m) => m.id}
        label="the back and forth"
        noun="moment"
        open={{
          id: picked,
          onOpen: (m) => {
            const t = target(m);
            if (t) go({ open: t });
          },
        }}
        name={{
          label: "What",
          icon: "chat",
          title: (m) => m.text,
          sub: (m) =>
            m.why ? (
              <span className={cx("text-[12.5px] whitespace-normal", QUIET)}>{m.why}</span>
            ) : null,
        }}
        columns={[
          {
            key: "type",
            label: "Kind",
            icon: "tag",
            width: 120,
            phone: true,
            cell: (m) => (
              <StateMark
                state={{
                  label: m.type === "done" ? `${m.text} done` : m.type,
                  tone: m.ok === false ? "bad" : m.from === "human" ? "good" : "neutral",
                }}
              />
            ),
          },
          { key: "who", label: "Who", icon: "user", width: 170, cell: (m) => <Who x={m} /> },
          {
            key: "at",
            label: "When",
            icon: "clock",
            width: 90,
            quiet: true,
            cell: (m) => when(m.at),
          },
        ]}
      />
      {card ? <Card view={view} id={card} go={go} /> : null}
    </div>
  );
}
