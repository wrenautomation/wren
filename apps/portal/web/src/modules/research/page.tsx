/**
 * Research › History (designs/2026-11-05-research-web.md, 11-08): every weaver run as a list, in
 * folders (designs/2026-11-08-folders.md, kind "run").
 * One run opens full width as its graph (round 13: claims, sources, searches, dropped hits) and
 * the back and forth (every decision with its why and who made it). Picked runs, or all of them,
 * open on one graph. Read only: the agent and the CLI write. Live: serve sends an event per change.
 */
import {
  Button,
  cx,
  dragItem,
  Empty,
  FolderMoveMenu,
  type FolderNode,
  FolderTree,
  Icon,
  LoadFailed,
  Loading,
  money,
  relative,
  Seg,
  StateMark,
  UnfiledDrop,
  useRowsPick,
} from "@wren/ui";
import type { LayId } from "@wren/ui/research/run";
import { type ReactNode, useMemo, useState } from "react";
import { embedOf, embedSite, youtubeId } from "../../embeds.js";
import { useFolders } from "../../folders.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { PlayerSlot } from "../../player/index.js";
import { href, navigate, useRoute } from "../../route.js";
import { QUIET } from "../work/bits.js";
import { RowsPanel } from "../work/rows-panel.js";
import { RunsCanvas } from "./canvas.js";
import {
  type Moment,
  pageOf,
  type RunDocument,
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

type Tab = "graph" | "talk";
type Go = (p: Record<string, string | null>) => void;

const TABS = [
  { value: "graph", label: "Graph" },
  { value: "talk", label: "Back and forth" },
] as const;
const LAYS: readonly LayId[] = ["web", "tree", "lanes"];
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

export function HistoryPage({ params, team }: PageProps) {
  const here = `/${useRoute().path.join("/")}`;
  const runs = useCall("research:runs", runsOf, { kept: false });
  const filed = useFolders("run", team);
  const rows = runs.data ?? [];
  const open = params.get("run");
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const pick = useRowsPick(
    rows.map((r) => r.run),
    picked,
    (next) => setPicked(next),
  );
  useLive(() => runs.retry());
  const askOf = useMemo(() => new Map(rows.map((r) => [r.run, r.ask])), [rows]);
  if (runs.error && !runs.data) return <NoServe error={runs.error} onRetry={runs.retry} />;
  if (open && (open !== "all" || runs.data))
    return <Opened key={open} open={open} rows={rows} params={params} here={here} />;
  if (!runs.data) return <Loading shape="rows" lines={5} />;
  if (!rows.length) return <Empty>No runs in this ledger yet.</Empty>;
  const openRuns = (run: string) => navigate(href(here, { run, open: null, lay: null }, params));
  const folders = filed.folders;
  const row = (r: RunRow) => (
    <RunItem
      r={r}
      from={r.parent ? (askOf.get(r.parent) ?? r.parent) : null}
      to={href(here, { run: r.run, open: null }, params)}
      picked={pick.picked(r.run)}
      anyPicked={picked.size > 0}
      onPick={(range) => pick.toggle(r.run, range)}
      folders={folders}
      filed={filed}
    />
  );
  const loose = folders ? rows.filter((r) => filed.folderOf(r.run) == null) : rows;
  return (
    <div className="grid min-w-0 gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="dense" tone="secondary" onClick={() => openRuns("all")}>
          All runs on one graph
        </Button>
        {picked.size > 1 ? (
          <Button
            size="dense"
            onClick={() => openRuns(runsIn([...picked].join(","), rows).join(","))}
          >
            Open {picked.size} runs together
          </Button>
        ) : null}
        <span className={cx("text-[12.5px]", QUIET)}>
          {picked.size ? `${picked.size} picked` : "Pick runs to draw them on one graph."}
        </span>
      </div>
      <div className="grid max-w-[860px] min-w-0 gap-5">
        {folders ? (
          <FolderTree
            id="runs"
            folders={folders}
            items={rows}
            keyOf={(r) => r.run}
            folderOf={(r) => filed.folderOf(r.run)}
            renderItem={row}
            acts={filed.acts}
            noun={(n) => (n === 1 ? "run" : "runs")}
          />
        ) : null}
        <UnfiledDrop acts={filed.acts} className="grid gap-px">
          {folders?.length && loose.length ? (
            <h3 className="m-0 px-2.5 pb-1 text-[12px] font-medium text-(--ui-ink-3)">No folder</h3>
          ) : null}
          <ul className="m-0 grid list-none gap-px p-0">
            {loose.map((r) => (
              <li key={r.run} {...(folders ? dragItem(r.run) : {})}>
                {row(r)}
              </li>
            ))}
          </ul>
        </UnfiledDrop>
      </div>
    </div>
  );
}

/** One run: pick box, its ask (opens it), where it came from, its counts and state; ⋯ files it. */
function RunItem({
  r,
  from,
  to,
  picked,
  anyPicked,
  onPick,
  folders,
  filed,
}: {
  r: RunRow;
  from: string | null;
  to: string;
  picked: boolean;
  anyPicked: boolean;
  onPick: (range: boolean) => void;
  folders: readonly FolderNode[] | null;
  filed: ReturnType<typeof useFolders>;
}) {
  const ask = r.ask || r.run;
  return (
    <div className="group/run flex items-center gap-2.5 rounded-[8px] py-2 pr-1 pl-2.5 transition-[background-color] duration-150 hover:bg-(--ui-fill)">
      <input
        type="checkbox"
        aria-label={`Pick ${ask}`}
        checked={picked}
        onChange={() => {}}
        onClick={(e) => onPick(e.shiftKey)}
        className={cx(
          // gutter box, as the rows part: hover, focus or any pick shows it; touch always
          "mt-[3px] flex-none self-start transition-opacity duration-150 focus-visible:opacity-100 pointer-coarse:opacity-100",
          anyPicked
            ? "opacity-100"
            : "opacity-0 group-hover/run:opacity-100 group-focus-within/run:opacity-100",
        )}
      />
      <a href={to} className="min-w-0 flex-1 no-underline focus-visible:outline-offset-2">
        <span className="block text-[13.5px]/[1.4] font-medium wrap-anywhere text-(--ui-ink)">
          {ask}
        </span>
        {from ? (
          <span className="block text-[12px] wrap-anywhere text-(--ui-ink-3)">From: {from}</span>
        ) : null}
        <span className="block text-[12px] text-(--ui-ink-3) tabular-nums">
          Round {r.round} · {plural(r.hits, "hit")} · {r.kept} kept · {usd(r.usd)}
          {r.updated ? ` · ${relative(new Date(r.updated))}` : ""}
        </span>
      </a>
      <span className="flex-none text-[12.5px]">
        <StateMark state={stateOf(r)} />
      </span>
      {folders ? (
        <FolderMoveMenu
          title={ask}
          folders={folders}
          current={filed.folderOf(r.run)}
          acts={filed.acts}
          itemKey={r.run}
          className="opacity-0 group-hover/run:opacity-100 group-focus-within/run:opacity-100 data-[popup-open]:opacity-100 pointer-coarse:opacity-100"
        />
      ) : null}
    </div>
  );
}

export const stateOf = (r: RunRow) =>
  r.next
    ? { label: r.next.step, tone: "good" as const }
    : { label: "Stopped", tone: "neutral" as const };

/** One run, or several on one graph. */
function Opened({
  open,
  rows,
  params,
  here,
}: {
  open: string;
  rows: readonly RunRow[];
  params: URLSearchParams;
  here: string;
}) {
  const ids = useMemo(() => runsIn(open, rows), [open, rows]);
  const lay = LAYS.find((l) => l === params.get("lay"));
  const go = (p: Record<string, string | null>) => navigate(href(here, p, params), true);
  const back = (
    <a
      href={href(here, { run: null, tab: null, open: null, lay: null }, params)}
      className="inline-flex items-center gap-1 text-[13px] text-(--ui-ink-2) no-underline hover:text-(--ui-ink)"
    >
      <Icon name="back" size={14} />
      All runs
    </a>
  );
  const [one] = ids;
  if (ids.length === 1 && one)
    return (
      <OneRun
        run={one}
        row={rows.find((r) => r.run === one) ?? null}
        params={params}
        go={go}
        back={back}
      />
    );
  return (
    <div className="grid min-w-0 gap-4">
      {back}
      <RunsCanvas
        runs={ids}
        rows={rows}
        title={open === "all" ? "All runs" : `${ids.length} runs together`}
        lay={lay}
        onLay={(l) => go({ lay: l })}
      />
    </div>
  );
}

function OneRun({
  run,
  row,
  params,
  go,
  back,
}: {
  run: string;
  row: RunRow | null;
  params: URLSearchParams;
  go: Go;
  back: ReactNode;
}) {
  const tab: Tab = params.get("tab") === "talk" ? "talk" : "graph";
  const lay = LAYS.find((l) => l === params.get("lay"));
  const card = params.get("open");
  const ids = useMemo(() => [run], [run]);
  const rows = useMemo(() => (row ? [row] : []), [row]);
  const got = useViews(ids);
  const view = got.views?.[0];
  return (
    <div className="grid min-w-0 gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {back}
        <Seg
          label="What to show"
          items={TABS}
          value={tab}
          onChange={(t) => go({ tab: t, open: null })}
        />
      </div>
      {tab === "graph" ? (
        <RunsCanvas runs={ids} rows={rows} title="" lay={lay} onLay={(l) => go({ lay: l })} />
      ) : got.error && !view ? (
        <LoadFailed error={got.error} onRetry={got.retry} />
      ) : !view ? (
        <Loading lines={8} />
      ) : (
        <>
          <RunHead view={view} row={row} />
          <Talk view={view} card={card} go={go} />
        </>
      )}
    </div>
  );
}

function RunHead({ view, row }: { view: RunView; row: RunRow | null }) {
  const kept = view.findings.filter((f) => f.kept).length;
  const total = view.spend.reduce((a, s) => a + s.usd, 0);
  return (
    <header className="grid gap-1.5">
      <h2 className="m-0 text-[18px] leading-[1.35] font-semibold wrap-anywhere">
        {row?.ask || view.run}
      </h2>
      <p className={cx("m-0 text-[13px] tabular-nums", QUIET)}>
        {plural(view.queries.length, "query", "queries")} · {plural(view.hits.length, "hit")} ·{" "}
        {plural(view.documents.length, "page")} read · {kept} kept of{" "}
        {plural(view.findings.length, "finding")} · {usd(total)}
        {row?.next ? ` · next: round ${row.next.round} ${row.next.step}` : " · stopped"}
        {row?.note ? ` (${row.note})` : ""}
      </p>
      {view.spend.length ? (
        <p className={cx("m-0 text-[12.5px] tabular-nums", QUIET)}>
          {view.spend
            .map(
              (s) =>
                `${s.source} ${s.op} ${s.calls}${s.failed ? ` (${s.failed} failed)` : ""} ${usd(s.usd)}`,
            )
            .join(" · ")}
        </p>
      ) : null}
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
  const findings = view.findings.filter((f) => f.document === d.id);
  const kept = keptBy(view).get(d.id) ?? 0;
  const person = d.person ? view.brief.people?.find((p) => p.id === d.person) : undefined;
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const show = async () => {
    setBusy(true);
    setFailed(null);
    try {
      setText((await pageOf(view.run, d.id)).text);
    } catch (err) {
      setFailed(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
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
        d.class,
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
      <PostEmbed id={d.id} url={d.url} title={d.title} />
      {findings.length ? (
        <ol className="m-0 grid list-none gap-2 p-0">
          {findings.map((f) => (
            <li
              key={f.id}
              className={cx(
                "grid gap-1 border-l-2 pl-2.5",
                f.kept ? "border-(--ui-good)" : "border-(--ui-hair)",
              )}
            >
              <span className={cx("text-[13.5px]", !f.kept && "opacity-70")}>
                {f.text}
                {f.date ? <span className={QUIET}> ({f.date})</span> : null}
              </span>
              {f.quote ? <q className={cx("text-[12.5px] italic", QUIET)}>{f.quote}</q> : null}
              <span className="text-[12px]">
                {f.kept ? "Kept" : "Not kept"}
                {f.class ? ` · ${f.class}` : ""} · <Who x={f} />
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
      )}
      {text !== null ? (
        <pre className={PRE}>{text}</pre>
      ) : (
        <span className="flex flex-wrap items-center gap-3">
          <Button size="dense" tone="secondary" busy={busy} onClick={() => void show()}>
            Show the stored copy
          </Button>
          {failed ? <span className="text-[12.5px] text-(--ui-bad)">{failed}</span> : null}
        </span>
      )}
    </Box>
  );
}

/** A video or post in its own player, where the CSP lets one in; else nothing (the link is above). */
function PostEmbed(d: { id: string; url: string; title?: string | undefined }) {
  const vid = youtubeId(d.url);
  if (vid)
    return (
      <PlayerSlot
        className="aspect-video w-full max-w-[720px]"
        item={{
          id: `research:${d.id}`,
          kind: "youtube",
          src: vid,
          title: d.title ?? d.url,
          ratio: 16 / 9,
        }}
      />
    );
  const site = embedSite(d.url);
  const e = site ? embedOf(site, d.url) : null;
  if (!e) return null;
  return (
    <PlayerSlot
      className={cx("w-full border border-(--ui-hair) bg-(--ui-paper)", e.box)}
      item={{ id: `research:${d.id}`, kind: "embed", src: e.src, title: d.title ?? `${site} post` }}
    />
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
