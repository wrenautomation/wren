import type { ReactNode } from "react";
import { Ico, vars } from "./marks.js";
import {
  cap,
  EV_ALPHA,
  EV_ORDER,
  EVIDENCE,
  evCounts,
  type GNode,
  type Indexed,
  pl,
  SPEAKER_ORDER,
  SPEAKERS,
  stepAt,
} from "./model.js";
import type { Pick } from "./panel.js";

export type LayId = "web" | "tree" | "lanes";
export const LAYS: { id: LayId; name: string; key: string }[] = [
  {
    id: "web",
    name: "Claim web",
    key: "Each tinted card is a claim. A source links to each claim it backs; a thicker line carries more findings. Click any node to open what it holds. Sources whose findings back no claim sit on the shelf below.",
  },
  {
    id: "tree",
    name: "Search tree",
    key: "The run's searches, by round. Each search shows the sources it found first: the top three, the rest on a click.",
  },
  {
    id: "lanes",
    name: "Lanes",
    key: "One lane per speaker on the left, the claims on the right. Follow a line to see who backs a claim.",
  },
];
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
  const H = ({ h, v, t }: { h: string; v: number; t: string }) => (
    <button type="button" aria-pressed={hole === h} onClick={() => setHole(h)}>
      <b>{v}</b>
      <span>{t}</span>
    </button>
  );
  return (
    <div className="rg-sum">
      <div className="sm">
        <p>
          Who speaks <small>{pl(L.nodes.length, "source")}</small>
        </p>
        <div className="stk">
          {ks.map(([k, n]) => (
            <button
              key={k}
              type="button"
              className={`k-${k}`}
              style={{ flex: n }}
              aria-label={`${SPEAKERS[k].many}: ${n}`}
              aria-pressed={hole === `k:${k}`}
              onClick={() => setHole(`k:${k}`)}
            />
          ))}
        </div>
        <div className="lg">
          {ks.map(([k, n]) => (
            <button
              key={k}
              type="button"
              className={`kd k-${k}`}
              aria-pressed={hole === `k:${k}`}
              onClick={() => setHole(`k:${k}`)}
            >
              <i />
              {SPEAKERS[k].many} <em>{n}</em>
            </button>
          ))}
        </div>
      </div>
      <div className="sm">
        <p>
          Evidence <small>{pl(tot, "finding")}, strong to weak</small>
        </p>
        <div className="stk ev">
          {EV_ORDER.map((e, i) =>
            ev[i] ? (
              <button
                key={e}
                type="button"
                style={vars({ "--o": EV_ALPHA[i] ?? 1 }, { flex: ev[i] })}
                aria-label={`${EVIDENCE[e]}: ${ev[i]}`}
                aria-pressed={hole === `e:${e}`}
                onClick={() => setHole(`e:${e}`)}
              />
            ) : null,
          )}
        </div>
        <div className="lg">
          {EV_ORDER.map((e, i) =>
            ev[i] ? (
              <button
                key={e}
                type="button"
                className="ev"
                aria-pressed={hole === `e:${e}`}
                onClick={() => setHole(`e:${e}`)}
              >
                <i style={vars({ "--o": EV_ALPHA[i] ?? 1 })} />
                {EVIDENCE[e]} <em>{ev[i]}</em>
              </button>
            ) : null,
          )}
        </div>
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

export function Side({
  r,
  L,
  chips,
  tab,
  setTab,
  pick,
  F,
  queue,
  copied,
  onCopy,
  onClear,
  onPick,
  onHover,
}: {
  r: React.RefObject<HTMLDivElement | null>;
  L: Indexed;
  chips: boolean;
  tab: "c" | "q" | "d";
  setTab: (t: "c" | "q" | "d") => void;
  pick: Pick | null;
  F: Focus | null;
  queue: ReadonlySet<string>;
  cmd: string;
  copied: boolean;
  onCopy: () => void;
  onClear: () => void;
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
  else if (tab === "q") {
    let r0 = 0;
    list = L.run.searches.flatMap((q) => {
      const out: ReactNode[] = [];
      if (L.rounds.length > 1 && q.r !== r0 && !chips) {
        r0 = q.r;
        out.push(
          <h5 key={`r${q.r}`}>
            {stepAt(L.run, q.r, true)}
            {L.run.runs ? `: ${L.run.runs[q.r - 1]?.t ?? ""}` : ""}
          </h5>,
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
        <p className="dn">
          The run read none of these. Pick a reason to see its hits, then mark any to read.
        </p>
        {L.why.map((g, i) => {
          const n = g.ds.filter((d) => queue.has(d.id)).length;
          return (
            <button
              key={g.w}
              type="button"
              className={cls("dg", pick?.t === "D" && pick.g === i && "pk")}
              onClick={() => onPick({ t: "D", g: i })}
            >
              <b>{cap(g.w)}</b>
              <small>
                {pl(g.ds.length, "hit")}
                {n ? ` · ${n} to read` : ""}
              </small>
            </button>
          );
        })}
      </>
    );
  return (
    <div ref={r} className={cls("rg-side", chips && "chips")} onPointerLeave={() => onHover(null)}>
      <div className="tabs" role="tablist">
        <T k="c" t="Claims" n={L.claims.length} />
        <T k="q" t="Searches" n={L.run.searches.length} />
        <T k="d" t="Dropped" n={L.run.dropped.length} />
      </div>
      <div className="rg-ls">{list}</div>
      <div className="qbar" hidden={!queue.size}>
        {queue.size ? (
          <>
            <span>
              <b>{pl(queue.size, "hit")}</b> to read{L.run.runs ? "" : " next round"}
            </span>
            <button type="button" onClick={onCopy}>
              {copied ? "Copied" : "Copy the command"}
            </button>
            <button type="button" onClick={onClear}>
              Clear
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}

export function Key({ lay }: { lay: LayId }) {
  const K = ({ i, t }: { i: ReactNode; t: string }) => (
    <span className="kk">
      {i}
      {t}
    </span>
  );
  if (lay === "web")
    return (
      <div className="rg-key">
        <p>
          <K i={<i className="kcc" />} t="Claim" />
          <K i={<i className="kc" />} t="Card: a top source that backs a claim" />
          <K i={<i className="kch" />} t="Chip: a source with findings" />
          <K i={<i className="kpg" />} t="Page" />
          <K i={<i className="kfd" />} t="Finding, its bar shows how strong" />
          <K i={<i className="kxp">+4</i>} t="What a node holds" />
          <K i={<i className="kln" />} t="Line: thicker is more findings for that claim" />
        </p>
        <p className="hint">
          Click a node to open it: a claim into its findings, a source into its pages and searches,
          a page into its findings, a finding into its quote. Click again to close it.
        </p>
      </div>
    );
  return (
    <div className="rg-key">
      <p>
        <K i={<i className="kc" />} t="Card: a top source that backs a claim" />
        <K i={<i className="kch" />} t="Chip: a source with findings" />
        <K i={<i className="kdt" />} t="Read, no finding" />
        <K i={<i className="kdt gh" />} t="Kept, not read" />
        <K i={<i className="kev" />} t="Bar: its evidence, strong to weak" />
        {lay !== "tree" ? (
          <K i={<i className="kln" />} t="Line: thicker is more findings for that claim" />
        ) : null}
      </p>
      <p className="hint">
        Hover a node to see its neighbours. Click for detail. Drag to move. Pinch, or Ctrl and
        scroll, to zoom.
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
  const rows = L.nodes.slice().sort((a, b) => {
    const x = val(a, k);
    const y = val(b, k);
    return (
      (typeof x === "string" ? x.localeCompare(String(y)) : x - (y as number)) * d ||
      b.s.kept - a.s.kept ||
      a.id - b.id
    );
  });
  return (
    <div className="rg-tbl" onPointerLeave={() => onHover(null)}>
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
        <tbody>
          {rows.map((n) => {
            const on = !!F && F.S.has(n.id);
            return (
              <tr
                key={n.id}
                className={cls(`k-${n.k}`, on && "on", !!F && picked && !on && "off")}
                onPointerOver={(e) => {
                  if (e.pointerType === "mouse") onHover(n.id);
                }}
              >
                <th scope="row">
                  <button type="button" onClick={() => onPick(n)}>
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
      </table>
    </div>
  );
}
