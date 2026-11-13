/**
 * Weaver in Explorer (designs/2026-11-12-explorer.md): the preview of a run, a page, a finding and
 * a query, read from `weaver serve` on this Mac. Each links to its card in Research.
 */
import { segments, type Whole } from "@wren/core/paths";
import type {
  WeaverDocument,
  WeaverFinding,
  WeaverQuery,
  WeaverRun,
} from "@wren/paths/weaver-tree";
import { num, relative, Tag, type TagTone } from "@wren/ui";
import { href } from "../../route.js";

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

const runHref = (run: string, open?: string) => href("/research/runs", { run, open: open ?? null });

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

const plural = (n: number, one: string, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;

export function WeaverPreview({ w }: { w: Whole }) {
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
      <div className="flex max-w-[72ch] flex-col gap-4">
        <Facts
          items={[
            plural(d.queries, "query", "queries"),
            `${plural(d.findings, "finding")} in all`,
            d.run.updated ? `changed ${relative(new Date(d.run.updated))}` : null,
          ]}
        />
        <a href={runHref(run)} className="self-start">
          Open in Research
        </a>
      </div>
    );
  }
  if (w.kind === "page") {
    // its findings are its rows (the column, or the rows under this at narrow): said once there
    const doc = (w.data as { document: WeaverDocument }).document;
    return (
      <div className="flex max-w-[72ch] flex-col gap-4">
        {doc.date ? <Facts items={[doc.date]} /> : null}
        <a href={doc.url} target="_blank" rel="noreferrer" className="self-start">
          {doc.media === "video" ? "Open the video" : "Open the page"}
        </a>
        {w.body ? (
          <section className="flex flex-col gap-2">
            <h3 className="m-0 text-[13px] font-medium text-(--ui-ink-2)">The page as read</h3>
            <Text text={w.body} />
          </section>
        ) : null}
        <a href={runHref(run, `d:${doc.id}`)} className="self-start">
          Open in Research
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
            Open its page in Research
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
          Open in Research
        </a>
      </div>
    );
  }
  return w.body ? <Text text={w.body} /> : null;
}
