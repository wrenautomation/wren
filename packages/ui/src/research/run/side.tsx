import { type ReactNode, useDeferredValue, useMemo, useRef } from "react";
import { Ico, vars } from "./marks.js";
import {
  cap,
  EV_ALPHA,
  EV_ORDER,
  EVIDENCE,
  evCounts,
  type GNode,
  headOf,
  type Indexed,
  pl,
  SPEAKER_ORDER,
  SPEAKERS,
  stepAt,
} from "./model.js";
import type { Pick } from "./panel.js";

export type Focus = { S: Set<number>; C: Set<number>; Q: Set<number>; K?: Set<string> };
export const cls = (...xs: (string | false | undefined | null)[]) => xs.filter(Boolean).join(" ");

const COLS: [string, string, boolean][] = [
  ["name", "Source", true],
  ["kind", "Kind", true],
  ["r", "", false],
  ["read", "Read", false],
  ["unread", "Not read", false],
  ["kept", "Findings", false],
  ["used", "In claims", false],
];
const val = (n: GNode, k: string): string | number =>
  k === "name"
    ? n.s.name
    : k === "kind"
      ? SPEAKERS[n.k].many
      : k === "read"
        ? n.s.pages.length
        : k === "unread"
          ? n.s.unread.length
          : k === "r"
            ? n.s.r
            : k === "kept"
              ? n.s.kept
              : n.s.used;

/** One row a part: its bar is its findings on one scale, the dark share those in claims. */
function Yield({
  rows,
  max,
  lg,
}: {
  rows: { key: string; label: string; n?: number; v: number; u: number; cls: string; o?: number }[];
  max: number;
  lg: (k: string) => object;
}) {
  return (
    <div className="yd">
      {rows.map((x) => (
        <button
          key={x.key}
          type="button"
          className={`yr ${x.cls}`}
          style={x.o != null ? vars({ "--o": x.o }) : undefined}
          {...lg(x.key)}
        >
          <span className="yl">
            <i />
            {x.label}
            {x.n != null ? <em>{x.n}</em> : null}
          </span>
          <span className="yb" aria-hidden="true">
            <span style={{ width: `${max ? (x.v / max) * 100 : 0}%` }}>
              <i style={{ width: `${x.v ? (x.u / x.v) * 100 : 0}%` }} />
            </span>
          </span>
          <span className="yn">
            {x.v ? (
              <>
                <b>{x.v}</b>
                {x.u ? ` · ${x.u} in claims` : ""}
              </>
            ) : (
              "none"
            )}
          </span>
        </button>
      ))}
    </div>
  );
}

export function Summary({
  L,
  hole,
  setHole,
}: {
  L: Indexed;
  hole: string | null;
  setHole: (h: string) => void;
}) {
  const f = L.run.funnel;
  const ks = SPEAKER_ORDER.map((k) => [k, L.nodes.filter((n) => n.k === k).length] as const).filter(
    (x) => x[1],
  );
  const ev = evCounts(L.nodes.flatMap((n) => n.s.fs));
  const tot = ev.reduce((a, b) => a + b, 0);
  const noC = L.nodes.filter((n) => n.s.kept && !n.nc);
  const sum = (k: string, f: "kept" | "used") =>
    L.nodes.reduce((a, n) => a + (n.k === k ? n.s[f] : 0), 0);
  const inC = evCounts(L.nodes.flatMap((n) => n.s.fs.filter((x) => x.c >= 0)));
  const lg = (k: string) => ({
    "aria-pressed": hole === k,
    onClick: () => setHole(k),
  });
  const H = ({ h, v, t }: { h: string; v: number; t: string }) => (
    <button type="button" aria-pressed={hole === h} onClick={() => setHole(h)}>
      <b>{v}</b>
      <span>{t}</span>
    </button>
  );
  return (
    <div className="rg-sum">
      <div className="sm ys">
        <p>
          Who speaks <small>{pl(L.nodes.length, "source")}; bar: findings, dark: in claims</small>
        </p>
        <Yield
          lg={lg}
          max={Math.max(1, ...ks.map(([k]) => sum(k, "kept")))}
          rows={ks.map(([k, n]) => ({
            key: `k:${k}`,
            label: SPEAKERS[k].many,
            n,
            v: sum(k, "kept"),
            u: sum(k, "used"),
            cls: `kd k-${k}`,
          }))}
        />
      </div>
      <div className="sm ys">
        <p>
          Evidence <small>{pl(tot, "finding")}, strong to weak</small>
        </p>
        <Yield
          lg={lg}
          max={Math.max(1, ...ev)}
          rows={EV_ORDER.flatMap((e, i) =>
            ev[i]
              ? [
                  {
                    key: `e:${e}`,
                    label: EVIDENCE[e],
                    v: ev[i] ?? 0,
                    u: inC[i] ?? 0,
                    cls: "ev",
                    o: EV_ALPHA[i] ?? 1,
                  },
                ]
              : [],
          )}
        />
      </div>
      <div className="sm hl">
        <p>
          Holes <small>pick one to light it</small>
        </p>
        <div className="hb">
          <H h="nr" v={f.kept - f.read} t="kept, not read" />
          <H h="rn" v={f.read - f.withF} t="read, no finding" />
          <H
            h="nc"
            v={f.findings - f.used}
            t={`findings in no claim, from ${pl(noC.length, "source")}`}
          />
        </div>
      </div>
    </div>
  );
}

/** A chevron for fold and unfold buttons. */
export const Chev = ({ dir }: { dir: "l" | "r" }) => (
  <svg
    viewBox="0 0 16 16"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {dir === "l" ? <path d="M10 3.5 5.5 8l4.5 4.5" /> : <path d="M6 3.5 10.5 8 6 12.5" />}
  </svg>
);

export function Side({
  r,
  L,
  chips,
  fold,
  onFold,
  tab,
  setTab,
  pick,
  F,
  onPick,
  onHover,
}: {
  r: React.RefObject<HTMLDivElement | null>;
  L: Indexed;
  chips: boolean;
  /** folded to a rail: counts only */
  fold: boolean;
  /** none in the dock: the dock hides the pane */
  onFold?: (() => void) | undefined;
  tab: "c" | "q" | "d";
  setTab: (t: "c" | "q" | "d") => void;
  pick: Pick | null;
  F: Focus | null;
  onPick: (p: Pick) => void;
  onHover: (p: Pick | null) => void;
}) {
  const T = ({ k, t, n }: { k: "c" | "q" | "d"; t: string; n: number }) => (
    <button type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
      {t} <span>{n}</span>
    </button>
  );
  const hov = (p: Pick) => ({
    onPointerOver: (e: React.PointerEvent) => {
      if (e.pointerType === "mouse") onHover(p);
    },
  });
  if (fold)
    return (
      <div ref={r} className="rg-side fold">
        <button
          type="button"
          className="unf"
          aria-label="Show the list"
          title="Show the list"
          onClick={onFold}
        >
          <Chev dir="r" />
        </button>
        {(
          [
            ["c", "Claims", L.claims.length],
            ["q", "Searches", L.run.searches.length],
            ["d", "Dropped", L.run.dropped.length],
          ] as const
        ).map(([k, t, n]) => (
          <button
            key={k}
            type="button"
            className="ft"
            aria-label={`${t}: ${n}`}
            title={t}
            onClick={() => {
              setTab(k);
              onFold?.();
            }}
          >
            <b>{n}</b>
            <small>{t}</small>
          </button>
        ))}
      </div>
    );
  let list: ReactNode;
  if (tab === "c")
    list = L.claims.map(({ c, ss }) => (
      <button
        key={c.i}
        type="button"
        className={cls(pick?.t === "c" && pick.i === c.i && "pk", F?.C.has(c.i) && "on")}
        aria-label={`Claim ${c.n}: ${c.head}`}
        onClick={() => onPick({ t: "c", i: c.i })}
        {...hov({ t: "c", i: c.i })}
      >
        <span className="no">{c.n}</span>
        <b>{c.head}</b>
        <small>
          {c.findings
            ? `${pl(c.findings, "finding")}, ${pl(ss.length, "source")}`
            : "No checked finding backs it"}
        </small>
      </button>
    ));
  // a phone's chips with several runs: one chip a run, not one a search
  else if (tab === "q" && chips && L.run.runs)
    list = L.run.runs.map((run, i) => {
      const p: Pick = { t: "n", key: `r${i + 1}` };
      return (
        <button
          key={run.rid}
          type="button"
          className={cls("sq", pick?.t === "n" && pick.key === p.key && "pk")}
          aria-label={`Run ${i + 1}: ${headOf(run.t).t}`}
          onClick={() => onPick(p)}
        >
          <span className="no">{i + 1}</span>
          <b>{headOf(run.t).t}</b>
        </button>
      );
    });
  else if (tab === "q") {
    let r0 = 0;
    list = L.run.searches.flatMap((q) => {
      const out: ReactNode[] = [];
      if (L.rounds.length > 1 && q.r !== r0 && !chips) {
        r0 = q.r;
        out.push(
          <p key={`r${q.r}`} className="rd">
            {stepAt(L.run, q.r, true)}
            {L.run.runs ? `: ${L.run.runs[q.r - 1]?.t ?? ""}` : ""}
          </p>,
        );
      }
      out.push(
        <button
          key={q.i}
          type="button"
          className={cls("sq", pick?.t === "q" && pick.i === q.i && "pk", F?.Q.has(q.i) && "on")}
          aria-label={`Search: ${q.t}`}
          onClick={() => onPick({ t: "q", i: q.i })}
          {...hov({ t: "q", i: q.i })}
        >
          <span className="no">{q.i + 1}</span>
          <b>{q.t}</b>
          <small>
            {q.hits} hits · {q.kept} kept · {q.read} read{q.fnd ? ` · ${pl(q.fnd, "finding")}` : ""}
          </small>
        </button>,
      );
      return out;
    });
  } else if (chips)
    list = (
      <button type="button" className="dg one" onClick={() => onPick({ t: "D", g: -1 })}>
        <b>See the {L.run.dropped.length} dropped hits</b>
      </button>
    );
  else
    list = (
      <>
        <p className="dn">The run read none of these. Pick a reason to see its hits.</p>
        {L.why.map((g, i) => {
          return (
            <button
              key={g.w}
              type="button"
              className={cls("dg", pick?.t === "D" && pick.g === i && "pk")}
              onClick={() => onPick({ t: "D", g: i })}
            >
              <b>{cap(g.w)}</b>
              <small>{pl(g.ds.length, "hit")}</small>
            </button>
          );
        })}
      </>
    );
  return (
    <div ref={r} className={cls("rg-side", chips && "chips")} onPointerLeave={() => onHover(null)}>
      <div className="srow">
        <div className="tabs" role="tablist">
          <T k="c" t="Claims" n={L.claims.length} />
          {chips && L.run.runs ? (
            <T k="q" t="Runs" n={L.run.runs.length} />
          ) : (
            <T k="q" t="Searches" n={L.run.searches.length} />
          )}
          <T k="d" t="Dropped" n={L.run.dropped.length} />
        </div>
        {chips || !onFold ? null : (
          <button
            type="button"
            className="fo"
            aria-label="Hide the list"
            title="Hide the list"
            onClick={onFold}
          >
            <Chev dir="l" />
          </button>
        )}
      </div>
      <div className="rg-ls">{list}</div>
    </div>
  );
}

export function Key({ runs }: { runs: boolean }) {
  const K = ({ i, t }: { i: ReactNode; t: string }) => (
    <span className="kk">
      {i}
      {t}
    </span>
  );
  return (
    <div className="rg-key">
      <p>
        {runs ? <K i={<i className="kcc" />} t="Run: its ask and its note" /> : null}
        <K i={<i className="kcc" />} t="Search, with its best finding as the answer" />
        <K i={<i className="kc" />} t="Card: a top source with findings" />
        <K i={<i className="kch" />} t="Chip: another source with findings" />
        {runs ? (
          <>
            <K i={<i className="kdt" />} t="Read, no finding" />
            <K i={<i className="kdt gh" />} t="Kept, not read" />
          </>
        ) : (
          <>
            <K i={<i className="kch gy" />} t="Gray chip: not read yet" />
            <K i={<i className="kch gy sm" />} t="Small gray chip: read, no finding" />
          </>
        )}
        <K i={<i className="kev" />} t="Bar: its evidence, strong to weak" />
        <K i={<i className="kxp">+4</i>} t="What a node holds" />
        <K i={<i className="kln" />} t="Line: thicker is more findings" />
      </p>
      <p className="hint">
        {runs ? "Click a run to open its searches. " : ""}A source found by several searches sits
        between them. Click a search to open{" "}
        {runs
          ? "the hits it kept with no finding and the hits it dropped; "
          : "the hits it dropped; "}
        a source into its pages; a page into its findings; a finding into its quote. Ctrl and
        scroll, or pinch, to zoom.
      </p>
    </div>
  );
}

export function Table({
  L,
  F,
  picked,
  sort,
  onSort,
  onHover,
  onPick,
}: {
  L: Indexed;
  F: Focus | null;
  picked: boolean;
  sort: [string, number];
  onSort: (k: string) => void;
  onHover: (id: number | null) => void;
  onPick: (n: GNode) => void;
}) {
  const [k, d] = sort;
  const rows = useMemo(
    () =>
      L.nodes.slice().sort((a, b) => {
        const x = val(a, k);
        const y = val(b, k);
        return (
          (typeof x === "string" ? x.localeCompare(String(y)) : x - (y as number)) * d ||
          b.s.kept - a.s.kept ||
          a.id - b.id
        );
      }),
    [L, k, d],
  );
  // a pick paints the panel first; the rows' marks follow a frame later
  const cb = useRef({ onHover, onPick });
  cb.current = { onHover, onPick };
  const f = useDeferredValue(F);
  const pk = useDeferredValue(picked);
  const body = useMemo(
    () => (
      <tbody>
        {rows.map((n) => {
          const on = !!f && f.S.has(n.id);
          return (
            <tr
              key={n.id}
              className={cls(`k-${n.k}`, on && "on", !!f && pk && !on && "off")}
              onPointerOver={(e) => {
                if (e.pointerType === "mouse") cb.current.onHover(n.id);
              }}
            >
              <th scope="row">
                <button type="button" onClick={() => cb.current.onPick(n)}>
                  <Ico s={n.s} />
                  <span>{n.s.name}</span>
                </button>
              </th>
              <td>
                <span className="kd">
                  <i />
                  {SPEAKERS[n.k].one}
                </span>
              </td>
              <td className="n">{n.s.r}</td>
              <td className="n">{n.s.pages.length}</td>
              <td className="n">{n.s.unread.length || ""}</td>
              <td className="n">{n.s.kept || ""}</td>
              <td className="n">{n.s.used || ""}</td>
            </tr>
          );
        })}
      </tbody>
    ),
    [rows, f, pk],
  );
  return (
    <div className="rg-tbl" onPointerLeave={() => cb.current.onHover(null)}>
      {/* table-ok: the graph's own source table, rows light their marks; artifact LdYvUurK */}
      <table>
        <caption>{pl(L.nodes.length, "source")}. Pick a row to find it in the graph.</caption>
        <thead>
          <tr>
            {COLS.map(([c, t0, txt]) => (
              <th
                key={c}
                scope="col"
                className={txt ? undefined : "n"}
                aria-sort={c === k ? (d > 0 ? "ascending" : "descending") : "none"}
              >
                <button type="button" onClick={() => onSort(c)}>
                  {t0 || (L.run.runs ? "Run" : "Round")}
                  {c === k ? (d > 0 ? " ▴" : " ▾") : ""}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        {body}
      </table>
    </div>
  );
}
