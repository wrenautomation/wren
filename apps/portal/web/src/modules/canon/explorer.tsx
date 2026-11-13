/**
 * Canon › Explorer: the whole brain as one tree (designs/2026-11-12-explorer.md, step 2). Explorer
 * over PathsConsole's Canon tree; the address holds where it stands (`?at=`) and the view
 * (`?view=`). The root shows what needs a look beside its rows; an item opens whole in the preview.
 */
import {
  type Column,
  homeOf,
  type Item,
  type Page,
  type Shown,
  segments,
  type Whole,
} from "@wren/core/paths";
import type { ReferenceWhole } from "@wren/research/canon-console";
import type {
  FileWhole,
  Home,
  Link,
  RecordWhole,
  RuleLine,
  RuleSet,
  TopicWhole,
} from "@wren/research/canon-library";
import {
  Empty,
  EXPLORER_VIEWS,
  Explorer,
  type ExplorerRead,
  type ExplorerView,
  LoadFailed,
  Loading,
  num,
  Tag,
  type TagTone,
  useSeen,
} from "@wren/ui";
import { call } from "../../api.js";
import { PORTAL, useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { href, navigate } from "../../route.js";
import { Markdown, Section, splitFrontmatter, typeName, withoutTitle } from "./parts.js";
import { Code, FileBody, RecordBody } from "./record.js";
import { Poster, ReferenceBody } from "./references.js";

const HERE = "/canon/explorer";
const ROOT = "canon";

const READ: ExplorerRead = {
  columns: (route) => call<Shown>("paths/columns", { route }),
  children: (path, after) => call<Page>("paths/children", { path, ...(after ? { after } : {}) }),
  find: (q, under) => call<{ items: Item[] }>("paths/find", { q, under }).then((r) => r.items),
};

/** A row's mark: a rule line's backing, a record's status. A line from his own source has none. */
const MARKS: Record<string, { label: string; tone?: TagTone }> = {
  none: { label: "No source", tone: "warn" },
  agent: { label: "Agent source" },
  unknown: { label: "Source unknown" },
  retired: { label: "Retired" },
  draft: { label: "Draft" },
  missing: { label: "Not in Canon", tone: "bad" },
};

const ERRORS = {
  "not-indexed": (
    <>
      Canon reaches this page after the first sync: <code>wren canon sync</code>.
    </>
  ),
};

const viewOf = (v: string | null): ExplorerView =>
  EXPLORER_VIEWS.includes(v as ExplorerView) ? (v as ExplorerView) : "columns";

/** A route's address: the root and Columns are the page's own. */
export const explorerHref = (route: string, view: ExplorerView = "columns") =>
  href(HERE, { at: route === ROOT ? null : route, view: view === "columns" ? null : view });

export function ExplorerPage({ params }: PageProps) {
  const route = params.get("at") || ROOT;
  const view = viewOf(params.get("view"));
  useSeen("list", { label: "Canon", icon: "book", text: `Canon, at ${route}` });
  return (
    <Explorer
      route={route}
      view={view}
      name="Canon"
      hrefFor={(r, v) => explorerHref(r, v ?? view)}
      onRoute={(r, v) => navigate(explorerHref(r, v ?? view))}
      read={READ}
      scope={PORTAL}
      marks={MARKS}
      errorText={ERRORS}
      preview={(w) => <Preview w={w} view={view} />}
      folderPage={(c: Column) => (c.route === ROOT ? <RootPage view={view} /> : undefined)}
    />
  );
}

// --- the root ------------------------------------------------------------------------------------

/** Beside the root's rows: what needs a look, the sets topics share, direction, records by type. */
function RootPage({ view }: { view: ExplorerView }) {
  const got = useCall("canon-home", () => call<Home>("canon/home", {}));
  if (got.error && !got.data) return <LoadFailed error={got.error} onRetry={got.retry} />;
  if (!got.data) return <Loading shape="rows" lines={6} />;
  const h = got.data;
  if (!h.topics.length && !h.types.length)
    return (
      <Empty title="Nothing in Canon yet" waits>
        Sources and topics reach this page after the next sync: wren source add, then wren canon
        sync.
      </Empty>
    );
  const to = (route: string) => explorerHref(route, view);
  const titles = new Map(h.topics.map((t) => [t.name, t.title]));
  const stale = new Map<string, Home["stale"]>();
  for (const s of h.stale) stale.set(s.id, [...(stale.get(s.id) ?? []), s]);
  return (
    <div className="flex max-w-[72ch] flex-col gap-6">
      <Section title={`Needs a look (${stale.size + h.conflicts.length})`}>
        {stale.size || h.conflicts.length ? (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {h.conflicts.map((c) => (
              <li key={c.id} className="flex flex-col text-[14px] leading-snug">
                <a href={to(`${ROOT}/records/conflict/${c.id}`)} className="wrap-anywhere">
                  {c.title ?? c.id}
                </a>
                <span className="text-[12.5px] text-(--ui-ink-3)">Open conflict</span>
              </li>
            ))}
            {[...stale.values()].map((group) => {
              const first = group[0];
              if (!first) return null;
              return (
                <li key={first.id} className="flex flex-col text-[14px] leading-snug">
                  <a
                    href={to(`${ROOT}/records/${first.type}/${first.id}`)}
                    className="wrap-anywhere"
                  >
                    {first.title}
                  </a>
                  <span className="text-[12.5px] text-(--ui-ink-3) wrap-anywhere">
                    {typeName(first.type)}: {reasons(group)}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="m-0 text-[13.5px] text-(--ui-ink-3)">Every record is current.</p>
        )}
      </Section>

      {h.shared.length > 0 && (
        <Section
          title={`Shared rule sets (${h.shared.length})`}
          about="Sets one topic owns and other topics load. A change here reaches each of them."
        >
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {h.shared.map((s) => (
              <li key={s.id} className="flex flex-col text-[14px] leading-snug">
                <a
                  href={to(
                    s.owner
                      ? `${ROOT}/topics/${s.owner}/sets/${s.id}`
                      : `${ROOT}/records/rule/${s.id}`,
                  )}
                  className="wrap-anywhere"
                >
                  {s.title}
                </a>
                <span className="text-[12.5px] text-(--ui-ink-3)">
                  {s.owner ? `${titles.get(s.owner) ?? s.owner}'s, loaded by ` : "Loaded by "}
                  {s.users.map((u, i) => (
                    <span key={u}>
                      {i > 0 && ", "}
                      <a href={to(`${ROOT}/topics/${u}`)}>{titles.get(u) ?? u}</a>
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {h.direction.length > 0 && (
        <Section title="Direction">
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {h.direction.map((d) => (
              <li key={d.path} className="flex flex-col text-[14px] leading-snug">
                <a href={to(`${ROOT}/files/${d.path}`)} className="wrap-anywhere">
                  {d.title}
                </a>
                <span className="text-[12px] text-(--ui-ink-3)">
                  {/^direction\/(\d{4}-\d{2}-\d{2})/.exec(d.path)?.[1] ?? d.path}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Records by type">
        <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
          {h.types.map((t) => (
            <li key={t.value}>
              <a href={to(`${ROOT}/records/${t.value}`)} className="no-underline">
                <Tag>
                  {typeName(t.value, t.n !== 1)} <b className="tabular-nums">{num(t.n)}</b>
                </Tag>
              </a>
            </li>
          ))}
        </ul>
      </Section>

      {h.head && (
        <p className="m-0 text-[12px] text-(--ui-ink-3)">
          Indexed at Canon commit <code>{h.head.slice(0, 8)}</code>
        </p>
      )}
    </div>
  );
}

const WHY: Record<string, (ids: string) => string> = {
  missing: (ids) => `cites ${ids}, not in Canon`,
  retired: (ids) => `cites ${ids}, retired`,
  changed: (ids) => `evidence changed in ${ids}`,
};

/** One phrase per reason, its cites listed once: "evidence changed in a, b". */
function reasons(group: readonly { why: string; cites: string }[]) {
  const by = new Map<string, string[]>();
  for (const s of group) by.set(s.why, [...(by.get(s.why) ?? []), s.cites]);
  return [...by]
    .map(([why, ids]) => WHY[why]?.(ids.join(", ")) ?? `${why}: ${ids.join(", ")}`)
    .join("; ");
}

// --- the preview ---------------------------------------------------------------------------------

/**
 * Where a cite goes: its row's home among the item's links, else its record by type; a cite with
 * neither opens in the Library.
 */
function citeHref(w: Whole, cites: readonly Link[], view: ExplorerView) {
  const homes = new Map<string, string>();
  for (const l of w.links)
    for (const i of l.items) {
      const home = homeOf(i);
      const last = segments(home).at(-1);
      if (last) homes.set(last, home);
      if (i.sub) homes.set(i.sub, home);
    }
  const types = new Map(cites.map((c) => [c.id, c.type]));
  return (id: string) => {
    const type = types.get(id);
    const at = homes.get(id) ?? (type ? `${ROOT}/records/${type}/${id}` : null);
    return at ? explorerHref(at, view) : href("/canon/library", { r: id });
  };
}

/** An item's body by its home: the tree gives each kind of home its own `data`. */
function Preview({ w, view }: { w: Whole; view: ExplorerView }) {
  const [, area, a, layer, set, line] = segments(w.path);
  const body = w.body ?? "";
  if (area === "topics" && a) {
    if (!layer) return <TopicSummary t={w.data as TopicWhole} view={view} />;
    if (layer === "guide") {
      const cites = (w.data as TopicWhole["guide"])?.cites ?? [];
      return <Markdown text={withoutTitle(body)} cites={cites} open={citeHref(w, cites, view)} />;
    }
    if (layer === "sets" && set && !line) {
      const s = w.data as RuleSet;
      return (
        <Markdown text={withoutTitle(body)} cites={s.cites} open={citeHref(w, s.cites, view)} />
      );
    }
    if (layer === "sets" && line) {
      const l = (w.data as { line?: RuleLine; setTitle: string }).line;
      return (
        <div className="flex max-w-[72ch] flex-col gap-2">
          <p className="m-0 text-[15px] leading-normal text-pretty wrap-anywhere">{body}</p>
          {l && MARKS[l.backing] ? (
            <span className="text-[12.5px] text-(--ui-ink-3)">{MARKS[l.backing]?.label}</span>
          ) : null}
        </div>
      );
    }
    if (layer === "skill") {
      const { head, body: rest } = splitFrontmatter(body);
      return (
        <div className="flex max-w-[72ch] flex-col gap-4">
          {head && <Code text={head} />}
          <Markdown text={rest} />
        </div>
      );
    }
    if (layer === "notes") return <Markdown text={body} className="max-w-[72ch]" />;
    if (w.data) return <FileBody f={w.data as FileWhole} bare />;
  }
  if (area === "references" && w.data) return <ReferenceBody r={w.data as ReferenceWhole} bare />;
  if (area === "records" && w.data) {
    const r = w.data as RecordWhole;
    return <RecordBody r={r} open={citeHref(w, r.cites, view)} bare />;
  }
  if (area === "files" && w.data) return <FileBody f={w.data as FileWhole} bare />;
  return body ? <Markdown text={body} className="max-w-[72ch]" /> : null;
}

/** A topic at a glance: its layers' sizes, its references' posters, the way to the whole page. */
function TopicSummary({ t, view }: { t: TopicWhole; view: ExplorerView }) {
  const lines = t.sets.reduce((n, s) => n + s.lines, 0);
  const facts = [
    `${t.sets.length} ${t.sets.length === 1 ? "rule set" : "rule sets"}, ${num(lines)} lines`,
    t.borrowed.length ? `${t.borrowed.length} borrowed` : null,
    `${num(t.references.length)} references`,
    `${num(t.evidence.length)} other sources`,
    // skill and notes: the column beside lists them
    t.guide ? null : "no guide",
  ].filter(Boolean);
  return (
    <div className="flex max-w-[72ch] flex-col gap-4">
      {t.description && (
        <p className="m-0 text-[14px] leading-normal text-pretty">{t.description}</p>
      )}
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-(--ui-ink-3)">
        {facts.map((f) => (
          <span key={f}>{f}</span>
        ))}
        {t.conflicts.length > 0 && (
          <Tag tone="warn">
            {t.conflicts.length} open {t.conflicts.length === 1 ? "conflict" : "conflicts"}
          </Tag>
        )}
      </span>
      {t.references.length > 0 && (
        <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(72px,1fr))] gap-2 p-0">
          {t.references.slice(0, 12).map((r) => (
            <li key={r.id} className="min-w-0">
              <a
                href={explorerHref(`${ROOT}/references/${r.id}`, view)}
                aria-label={r.title}
                className="block transition-opacity duration-150 hover:opacity-90"
              >
                <Poster r={r} small />
              </a>
            </li>
          ))}
        </ul>
      )}
      <a href={href("/canon/topic", { t: t.name })} className="self-start text-[14px]">
        Open the whole topic
      </a>
    </div>
  );
}
