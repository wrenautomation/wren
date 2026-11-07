/**
 * The research web (designs/2026-11-05-research-web.md): every birdwatch run on one canvas, from
 * serve's `/web` (positions are the engine's). Search, hover, click to see a dot, double click to
 * open it. A run opens in the runs view.
 */
import { Button, cx, Icon, Input, Loading, WebCanvas, type WebDot, type WebHandle } from "@wren/ui";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { href, navigate, useRoute } from "../../route.js";
import { QUIET } from "../work/bits.js";
import { NoServe, PostEmbed } from "./page.js";
import { type ResearchWeb, useLive, type WebNode, webOf } from "./serve.js";

/** One cue per ask kind, so a run's color says what it asked. */
const CUE: Record<string, number> = { web: 1, video: 2, channel: 3, people: 4, social: 5 };
const cueOf = (kind = "web") =>
  `--ui-cue-${CUE[kind] ?? ([...kind].reduce((a, c) => a + c.charCodeAt(0), 0) % 8) + 1}`;

const COLOR: Record<WebNode["kind"], (n: WebNode) => string> = {
  run: (n) => cueOf(n.ask),
  query: () => "--ui-ink-2",
  source: () => "--ui-ink-3",
  hub: () => "--ui-accent",
  page: () => "--ui-ink",
  finding: (n) => (n.kept ? "--ui-good" : "--ui-bad"),
};

const KIND: Record<WebNode["kind"], string> = {
  run: "Run",
  query: "Query",
  source: "Site or channel",
  hub: "Shared source",
  page: "Page",
  finding: "Finding",
};

/** Search hits shown at once; the count says how many more. */
const SHOWN = 12;
/** World units a fly-to frames: a run's island, or a page with its findings. */
const FRAME = { island: 900, near: 300 };
/** A burst of live events refetches the web once. */
const SETTLE_MS = 3000;

interface Index {
  byId: Map<string, WebNode>;
  /** Tree children and hub links, both ways. */
  out: Map<string, string[]>;
  into: Map<string, string[]>;
}

function indexOf(m: ResearchWeb): Index {
  const byId = new Map(m.nodes.map((n) => [n.id, n]));
  const out = new Map<string, string[]>();
  const into = new Map<string, string[]>();
  for (const e of m.edges) {
    out.set(e.source, [...(out.get(e.source) ?? []), e.target]);
    into.set(e.target, [...(into.get(e.target) ?? []), e.source]);
  }
  return { byId, out, into };
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

export function WebPage({ params }: PageProps) {
  const here = `/${useRoute().path.join("/")}`;
  const got = useCall("research:web", webOf, { kept: false });
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  useLive(() => {
    if (settle.current) clearTimeout(settle.current);
    settle.current = setTimeout(got.retry, SETTLE_MS);
  });
  const web = useRef<WebHandle>(null);
  const [q, setQ] = useState("");
  const at = params.get("at");
  const m = got.data;
  const ix = useMemo(() => (m ? indexOf(m) : null), [m]);
  const drawn = useMemo(() => {
    if (!m) return null;
    const dots: WebDot[] = m.nodes.map((n) => ({
      id: n.id,
      x: n.x,
      y: n.y,
      size: n.size,
      label: n.label,
      color: COLOR[n.kind](n),
      faint: n.kind === "page" && !n.read,
    }));
    return { dots, links: m.edges };
  }, [m]);
  // sigma's camera ratio 1 frames the whole web
  const span = useMemo(() => {
    if (!m?.nodes.length) return 1;
    const xs = m.nodes.map((n) => n.x);
    const ys = m.nodes.map((n) => n.y);
    return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1);
  }, [m]);
  const found = useMemo(() => {
    const words = q.trim().toLowerCase();
    if (!m || words.length < 2) return null;
    const hits = m.nodes.filter(
      (n) => n.label.toLowerCase().includes(words) || n.url?.toLowerCase().includes(words),
    );
    // runs first, then by kind order on the web
    const rank = ["run", "hub", "source", "query", "page", "finding"];
    return hits.sort((a, b) => rank.indexOf(a.kind) - rank.indexOf(b.kind));
  }, [m, q]);
  const match = useMemo(() => (found ? new Set(found.map((n) => n.id)) : null), [found]);
  const pick = (id: string | null) => navigate(href(here, { at: id }, params), true);
  const clear = useRef(() => pick(null));
  clear.current = () => pick(null);
  useEffect(() => {
    if (!at) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !(e.target instanceof HTMLInputElement)) clear.current();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [at]);
  const go = (id: string) => {
    pick(id);
    const kind = ix?.byId.get(id)?.kind;
    const frame = kind === "run" || kind === "hub" ? FRAME.island : FRAME.near;
    void web.current?.flyTo(id, Math.min(1, frame / span));
  };
  const open = (id: string) => {
    const n = ix?.byId.get(id);
    if (!n) return;
    if (n.kind === "run") navigate(href("/research/runs", { run: n.id }));
    else if (n.url) window.open(n.url, "_blank", "noopener");
  };

  if (got.error && !m) return <NoServe error={got.error} onRetry={got.retry} />;
  if (!m || !ix || !drawn) return <Loading lines={8} />;
  const picked = at ? (ix.byId.get(at) ?? null) : null;
  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(360px,62vh)_auto] gap-4 @min-[840px]/main:grid-cols-[minmax(0,1fr)_360px] @min-[840px]/main:grid-rows-1">
      <div className="relative min-h-0 overflow-hidden border border-(--ui-hair) bg-(--ui-canvas)">
        <WebCanvas
          dots={drawn.dots}
          links={drawn.links}
          label={`Research web: ${count(m, "run")} runs, ${count(m, "page")} pages`}
          selected={at}
          match={match}
          onSelect={pick}
          onOpen={open}
          handle={web}
          className="h-full w-full"
        />
        <Button
          size="dense"
          tone="secondary"
          className="absolute right-2 bottom-2"
          onClick={() => void web.current?.whole()}
        >
          Whole web
        </Button>
      </div>
      <aside
        aria-label="Search and details"
        className="grid min-h-0 content-start gap-4 overflow-auto"
      >
        {/* edit-ok: search box */}
        <Input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find an ask, a site, a channel, a finding"
          aria-label="Find on the web"
          className="h-9 text-[14px]"
        />
        {found ? (
          <Found nodes={found} ix={ix} go={go} />
        ) : picked ? (
          <Picked n={picked} ix={ix} go={go} />
        ) : (
          <Whole m={m} />
        )}
        {found && picked ? <Picked n={picked} ix={ix} go={go} /> : null}
      </aside>
    </div>
  );
}

const count = (m: ResearchWeb, kind: WebNode["kind"]) =>
  m.nodes.filter((n) => n.kind === kind).length;

const LEGEND: [string, string][] = [
  ["Run", "--ui-cue-1"],
  ["Query", "--ui-ink-2"],
  ["Page", "--ui-ink"],
  ["Shared source", "--ui-accent"],
  ["Kept", "--ui-good"],
  ["Cut", "--ui-bad"],
];

function Whole({ m }: { m: ResearchWeb }) {
  const read = m.nodes.filter((n) => n.kind === "page" && n.read).length;
  const kept = m.nodes.filter((n) => n.kind === "finding" && n.kept).length;
  return (
    <div className="grid gap-2 text-[14px] text-(--ui-ink)">
      <p className="m-0 tabular-nums">
        {count(m, "run")} runs · {count(m, "query")} queries · {read} pages read · {kept} findings
        kept · {count(m, "hub")} shared sources
      </p>
      <ul className="m-0 flex list-none flex-wrap gap-x-3 gap-y-1 p-0 text-[13px] text-(--ui-ink-2)">
        {LEGEND.map(([name, color]) => (
          <li key={name} className="flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ background: `var(${color})` }} />
            {name}
          </li>
        ))}
      </ul>
      <p className={cx("m-0 text-[13px]", QUIET)}>
        Click a dot to see it. Esc lets it go. Double click opens it: a run in the runs view, a page
        in a new tab.
      </p>
    </div>
  );
}

function Found({ nodes, ix, go }: { nodes: WebNode[]; ix: Index; go: (id: string) => void }) {
  if (!nodes.length) return <p className={cx("m-0 text-[14px]", QUIET)}>Nothing on the web.</p>;
  return (
    <div className="grid gap-1">
      <p className={cx("m-0 text-[13px] tabular-nums", QUIET)}>{nodes.length} found</p>
      <ul className="m-0 grid list-none gap-0.5 p-0">
        {nodes.slice(0, SHOWN).map((n) => (
          <li key={n.id}>
            <button
              type="button"
              onClick={() => go(n.id)}
              className="grid w-full gap-0.5 rounded-(--ui-radius) px-2 py-1.5 text-left hover:bg-(--ui-hover)"
            >
              <span className="text-[14px] wrap-anywhere text-(--ui-ink)">{n.label}</span>
              <span className={cx("text-[12px]", QUIET)}>
                {KIND[n.kind]}
                {n.run && n.kind !== "run" ? ` · ${ix.byId.get(n.run)?.label ?? n.run}` : ""}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {nodes.length > SHOWN ? (
        <p className={cx("m-0 text-[13px] tabular-nums", QUIET)}>
          {nodes.length - SHOWN} more: add a word to narrow it.
        </p>
      ) : null}
    </div>
  );
}

const LINK = "inline-flex items-center gap-1 wrap-anywhere text-(--ui-ink) underline";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <span className={cx("text-[12px]", QUIET)}>{label}</span>
      <span className="text-[14px] wrap-anywhere text-(--ui-ink)">{children}</span>
    </div>
  );
}

function Picked({ n, ix, go }: { n: WebNode; ix: Index; go: (id: string) => void }) {
  const run = n.run ? ix.byId.get(n.run) : undefined;
  const kids = (ix.out.get(n.id) ?? []).map((id) => ix.byId.get(id)).filter((x) => !!x);
  const parents = (ix.into.get(n.id) ?? []).map((id) => ix.byId.get(id)).filter((x) => !!x);
  const jump = (x: WebNode) => (
    <button key={x.id} type="button" className={cx(LINK, "text-left")} onClick={() => go(x.id)}>
      {x.label}
    </button>
  );
  return (
    <section aria-label={KIND[n.kind]} className="grid gap-3 border-t border-(--ui-hair) pt-3">
      <div className="grid gap-1">
        <span className={cx("text-[12px]", QUIET)}>{KIND[n.kind]}</span>
        <h2 className="m-0 text-[16px] leading-snug font-medium wrap-anywhere text-(--ui-ink)">
          {n.label}
        </h2>
      </div>
      {n.url ? (
        <a className={LINK} href={n.url} target="_blank" rel="noreferrer">
          {n.kind === "page" ? hostOf(n.url) : n.url}
          <Icon name="external" size={14} />
        </a>
      ) : null}
      {n.kind === "page" && n.url ? <PostEmbed id={n.id} url={n.url} title={n.label} /> : null}
      {n.kind === "run" ? (
        <>
          <p className={cx("m-0 text-[13px] tabular-nums", QUIET)}>
            {n.group ? `${n.group} · ` : ""}
            {kids.length} queries
          </p>
          <a className={LINK} href={href("/research/runs", { run: n.id })}>
            Open run
          </a>
        </>
      ) : null}
      {n.kind === "page" ? (
        <Row label={n.read ? "Read" : "Listed, not read"}>
          {kids.length ? (
            <ul className="m-0 grid gap-2 pl-4">
              {kids.map((f) => (
                <li key={f.id}>
                  {f.label}
                  <span
                    className={cx(
                      "ml-1 text-[12px]",
                      f.kept ? "text-(--ui-good)" : "text-(--ui-bad)",
                    )}
                  >
                    {f.kept ? "kept" : "cut"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            "No findings."
          )}
        </Row>
      ) : null}
      {n.kind === "finding" ? (
        <Row label={n.kept ? "Kept" : "Cut"}>{parents.length ? parents.map(jump) : "No page."}</Row>
      ) : null}
      {n.kind === "hub" ? (
        <Row label={`Used by ${n.runs ?? 0} runs`}>
          <span className="grid gap-1">
            {[...new Set(kids.map((k) => k.run).filter((r) => !!r))].map((r) => {
              const x = ix.byId.get(r as string);
              return x ? jump(x) : null;
            })}
          </span>
        </Row>
      ) : null}
      {n.kind === "query" || n.kind === "source" ? (
        <Row label={n.kind === "query" ? "Found" : "Pages"}>{kids.length}</Row>
      ) : null}
      {run && n.kind !== "run" ? <Row label="Run">{jump(run)}</Row> : null}
    </section>
  );
}
