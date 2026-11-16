/**
 * Weaver in Explorer (designs/2026-11-12-explorer.md): the preview of a run, a page, a finding and
 * a query, read from `weaver serve` on this Mac. Each opens its run whole here, at its card (WA-1373).
 */
import { segments, type Whole } from "@wren/core/paths";
import type {
  WeaverDocument,
  WeaverFinding,
  WeaverQuery,
  WeaverRun,
} from "@wren/paths/weaver-tree";
import type { FeedPost } from "@wren/research/canon-console";
import {
  ButtonLink,
  cx,
  Img,
  LoadFailed,
  num,
  relative,
  Skeleton,
  Tag,
  type TagTone,
} from "@wren/ui";
import { type ReactNode, useMemo } from "react";
import { useCall } from "../../load.js";
import { CountRow, times, usePicture, usualWords } from "../canon/post-parts.js";
import { wholeHref } from "../explorer/href.js";
import { boardPages, byScore, Thumb } from "./board.js";
import { viewOf } from "./serve.js";

/** Weaver's row marks: a finding its check dropped. */
export const WEAVER_MARKS: Record<string, { label: string; tone?: TagTone }> = {
  dropped: { label: "Dropped" },
};

/** What fills Weaver's root: a run started from Research's chat. */
export const weaverFills = (route: string) =>
  route === "weaver" ? (
    <>
      Start a run from the chat in <a href="/research/runs">Research</a>.
    </>
  ) : undefined;

const runHref = (run: string, open?: string) => wholeHref(`weaver/${run}`, { open: open ?? null });

const Facts = ({ items }: { items: (string | null | false | undefined)[] }) => (
  <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-(--ui-ink-3)">
    {items.filter(Boolean).map((f) => (
      <span key={String(f)}>{f}</span>
    ))}
  </span>
);

const Text = ({ text }: { text: string }) => (
  <p className="m-0 text-[14.5px] leading-normal whitespace-pre-wrap text-pretty wrap-anywhere">
    {text}
  </p>
);

/** A finding and its quote; a dropped one says so. `bare`: the header shows its text already. */
function Finding({ f, bare = false }: { f: WeaverFinding; bare?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      {bare ? null : (
        <p className="m-0 text-[14.5px] leading-normal text-pretty wrap-anywhere">{f.text}</p>
      )}
      {f.quote ? (
        <p className="m-0 text-[13.5px] text-(--ui-ink-2) italic wrap-anywhere">“{f.quote}”</p>
      ) : null}
      {f.kept ? null : (
        <span>
          <Tag>Dropped</Tag>
        </span>
      )}
    </div>
  );
}

/** The run's read pages, by id; the preview and the whole view share one load. */
function useBoard(run: string) {
  const got = useCall(`research:view:${run}`, () => viewOf(run), { kept: false });
  const pages = useMemo(() => (got.data ? boardPages(got.data) : undefined), [got.data]);
  return { got, pages };
}

const SHOWN = 6;

/** The run at a glance: its top picks' pictures by rank; no picks yet, its best-scored pages. */
function RunMosaic({ run }: { run: string }) {
  const { got, pages } = useBoard(run);
  if (got.error && !got.data) return <LoadFailed error={got.error} onRetry={got.retry} />;
  if (!pages)
    return (
      <div role="status" className="grid grid-cols-3 gap-1.5">
        <span className="sr-only">Loading the run's picks</span>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="aspect-square" />
        ))}
      </div>
    );
  const all = [...pages.values()];
  const picks = all
    .filter((x) => x.pick)
    .sort((a, b) => (a.pick?.rank ?? 999) - (b.pick?.rank ?? 999));
  const top = (picks.length ? picks : all.sort((a, b) => byScore(a.s, b.s))).slice(0, SHOWN);
  if (!top.length) return null;
  return (
    <section aria-labelledby="run-mosaic" className="grid gap-2">
      <h3 id="run-mosaic" className="m-0 text-[13px] font-medium text-(--ui-ink-2)">
        {picks.length > top.length
          ? `Top ${top.length} of ${plural(picks.length, "pick")}`
          : picks.length
            ? plural(picks.length, "pick")
            : `No picks yet: the ${top.length} best-scored pages`}
      </h3>
      <ul
        className={cx(
          "m-0 grid list-none gap-1.5 p-0 [animation:ui-fade_.15s_both]",
          // four as a square, never three and an orphan
          top.length === 4 ? "grid-cols-2" : "grid-cols-3",
        )}
      >
        {top.map((x) => (
          <li key={x.s.id} className="min-w-0">
            <Thumb p={x} open={runHref(run, `d:${x.s.id}`)} className="aspect-square w-full" />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A page's picture and its numbers, as the run's board has them. */
function PageFace({ run, id }: { run: string; id: string }) {
  const { pages } = useBoard(run);
  const p = pages?.get(id);
  if (!p) return null;
  const m = p.r.multiple;
  return (
    <div className="flex flex-col gap-2">
      {p.r.src ? <Poster r={p.r} /> : null}
      <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-(--ui-ink-2)">
        <CountRow r={p.r} only={["views", "likes"]} />
        {m != null ? (
          <span className="tabular-nums">
            {times(m)} {usualWords(p.r)}
          </span>
        ) : null}
      </span>
    </div>
  );
}

function Poster({ r }: { r: FeedPost }) {
  const pic = usePicture(r, true);
  return pic.src ? (
    <Img
      src={pic.src}
      alt=""
      decoding="async"
      onError={pic.fail}
      className="block max-h-[320px] w-full rounded-[4px_8px_4px_8px] bg-(--ui-hover) object-cover"
    />
  ) : null;
}

const plural = (n: number, one: string, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;

export function WeaverPreview({ w, file }: { w: Whole; file?: ReactNode }) {
  const [, run, area] = segments(w.path);
  if (!run || !w.data) return w.body ? <Text text={w.body} /> : null;
  if (!area) {
    const d = w.data as {
      run: WeaverRun;
      queries: number;
      pages: number;
      findings: number;
      kept: number;
    };
    // the header holds its ask, its id, its pages and kept count
    return (
      <div className="flex min-w-0 flex-col gap-4">
        <RunMosaic run={run} />
        <Facts
          items={[
            plural(d.queries, "query", "queries"),
            `${plural(d.findings, "finding")} in all`,
            d.run.updated ? `changed ${relative(new Date(d.run.updated))}` : null,
          ]}
        />
        <span className="flex items-center gap-2">
          <ButtonLink tone="secondary" size="dense" icon="expand" href={runHref(run)}>
            Open the whole run
          </ButtonLink>
          {file}
        </span>
      </div>
    );
  }
  if (w.kind === "page") {
    // its findings are its rows (the column, or the rows under this at narrow): said once there
    const doc = (w.data as { document: WeaverDocument }).document;
    return (
      <div className="flex max-w-[72ch] flex-col gap-4">
        <PageFace run={run} id={doc.id} />
        {doc.date ? <Facts items={[doc.date]} /> : null}
        <a href={doc.url} target="_blank" rel="noreferrer" className="self-start">
          {doc.media === "video" ? "Open the video" : "Open the page"}
        </a>
        {/* no page body: a wall of text on each move (William 11-16); the run's panel holds it */}
        <a href={runHref(run, `d:${doc.id}`)} className="self-start">
          Open in its run
        </a>
      </div>
    );
  }
  if (w.kind === "finding") {
    const d = w.data as { finding?: WeaverFinding; document?: WeaverDocument };
    return (
      <div className="flex max-w-[72ch] flex-col gap-4">
        {d.finding ? <Finding f={d.finding} bare /> : null}
        {d.document ? <Facts items={[d.document.title ?? d.document.url]} /> : null}
        {d.document ? (
          <a href={runHref(run, `d:${d.document.id}`)} className="self-start">
            Open its page in the run
          </a>
        ) : null}
      </div>
    );
  }
  if (w.kind === "query") {
    // the header holds its terms, site, round and hits
    const q = w.data as WeaverQuery;
    return (
      <div className="flex max-w-[72ch] flex-col gap-4">
        {q.why ? <Text text={q.why} /> : null}
        <a href={runHref(run, `q:${q.id}`)} className="self-start">
          Open in its run
        </a>
      </div>
    );
  }
  return w.body ? <Text text={w.body} /> : null;
}
