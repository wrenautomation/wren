/** The detail panel: a source, claim, search, page, finding or the dropped hits. */
import { useDeferredValue, useState } from "react";
import { Glyph, Ico, Kd } from "./marks.js";
import {
  atQuote,
  cap,
  clock,
  day,
  EVIDENCE,
  type GNode,
  type GraphDrop,
  type GraphFinding,
  type GraphSearch,
  type GraphSource,
  headOf,
  type Indexed,
  pl,
  SPEAKERS,
  type Speaker,
  stepAt,
  unit,
} from "./model.js";
import { Chev, cls } from "./side.js";
import { parse } from "./web.js";

export type Pick =
  | { t: "c"; i: number }
  | { t: "q"; i: number }
  | { t: "s"; id: number }
  | { t: "n"; key: string }
  | { t: "D"; g: number };

export interface PanelCtx {
  L: Indexed;
  pick: (p: Pick, center?: boolean) => void;
  close: () => void;
  /** hide the panel to a tab; the pick stays */
  min: () => void;
  queue: ReadonlySet<string>;
  toggleQ: (id: string) => void;
  dq: string;
  setDq: (v: string) => void;
}

const Out = ({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
}) => (
  <a className={className} href={href} target="_blank" rel="noopener">
    {children}
  </a>
);

const X = ({ c }: { c: PanelCtx }) => (
  <>
    <button
      type="button"
      className="x mn"
      aria-label="Hide the panel"
      title="Hide the panel"
      onClick={c.min}
    >
      <Chev dir="r" />
    </button>
    <button type="button" className="x" aria-label="Close" onClick={c.close}>
      ×
    </button>
  </>
);

/** A media frame: the picture when there is one, else the site's mark on its kind's tint. */
function Frame({
  img,
  icon,
  fmt,
  kind,
  len,
  sm,
}: {
  img?: string | null | undefined;
  icon?: string | null | undefined;
  fmt: string;
  kind: Speaker;
  len?: number;
  sm?: boolean;
}) {
  const [bad, setBad] = useState(false);
  const [ibad, setIbad] = useState(false);
  return (
    <span className={cls("fr", `k-${kind}`, sm && "sm")}>
      {img && !bad ? (
        <img
          className="pic"
          src={img}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setBad(true)}
        />
      ) : (
        <span className="pst">
          {icon && !ibad ? (
            <img
              className="ic"
              src={icon}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={() => setIbad(true)}
            />
          ) : (
            <Glyph f={fmt} />
          )}
        </span>
      )}
      {len ? <i className="len">{clock(len)}</i> : null}
    </span>
  );
}

const picOf = (s: GraphSource) => s.thumb ?? s.og;

/** A source as a tile: its frame first, then its name, kind and yield. */
function Tile({ c, n }: { c: PanelCtx; n: GNode }) {
  const s = n.s;
  return (
    <button type="button" className="tile" onClick={() => c.pick({ t: "s", id: s.id }, true)}>
      <Frame img={picOf(s)} icon={s.icon} fmt={s.fmt} kind={s.kind} />
      <b>{s.name}</b>
      <small>
        <Kd k={s.kind} />
        <span>
          {s.pages.length ? (s.kept ? pl(s.kept, "finding") : "no finding") : "not read yet"}
        </span>
      </small>
    </button>
  );
}

const Tiles = ({ c, ns }: { c: PanelCtx; ns: GNode[] }) => (
  <div className="tiles">
    {ns.map((n) => (
      <Tile key={n.id} c={c} n={n} />
    ))}
  </div>
);

function Tag({ c, i }: { c: PanelCtx; i: number }) {
  const n = c.L.run.claims[i]?.n;
  return (
    <button type="button" className="tag" onClick={() => c.pick({ t: "c", i }, true)}>
      <i className="no">{n}</i>Claim {n}
    </button>
  );
}

const Checked = ({ f }: { f: GraphFinding }) => (
  <span>
    {f.ok === 1 ? "Checked" : f.ok === 0 ? "Check failed" : "Not checked"}
    {f.ok !== -1 && f.why ? `: ${f.why}` : ""}
  </span>
);

function Finding({
  c,
  s,
  f,
  claim,
  page,
}: {
  c: PanelCtx;
  s: GraphSource;
  f: GraphFinding;
  claim?: boolean;
  page?: boolean;
}) {
  const pg = s.pages[f.p];
  const aq = pg && atQuote(pg.u, f.q);
  return (
    <div className="fd">
      <p>{f.t}</p>
      {f.q ? <blockquote>“{f.q}”</blockquote> : null}
      <p className="fm">
        <span className="ev">{EVIDENCE[f.e] ?? "Other"}</span>
        {claim ? f.c >= 0 ? <Tag c={c} i={f.c} /> : <span>In no claim</span> : null}
        {aq ? (
          <Out className="aq" href={aq}>
            Open at the quote
          </Out>
        ) : null}
        {page && pg ? <Out href={pg.u}>{pg.t}</Out> : null}
        <Checked f={f} />
      </p>
    </div>
  );
}

function QChip({ c, q }: { c: PanelCtx; q: GraphSearch }) {
  return (
    <button type="button" className="chip" onClick={() => c.pick({ t: "q", i: q.i }, true)}>
      <i className="no q">{q.i + 1}</i>
      <span>
        {q.t}
        <small> · {stepAt(c.L.run, q.r)}</small>
      </span>
    </button>
  );
}

const Unread = ({ c, s }: { c: PanelCtx; s: GraphSource }) =>
  s.unread.length ? (
    <>
      <p className="lbl">Kept from a search, not read yet</p>
      <ul className="ur">
        {s.unread.map((p) => (
          <li key={p.u}>
            <Out href={p.u}>{p.t}</Out> <small>{stepAt(c.L.run, p.r)}</small>
          </li>
        ))}
      </ul>
    </>
  ) : null;

/** A source's evidence: the kinds of its findings, most first. */
function evMix(s: GraphSource) {
  const m = new Map<string, number>();
  for (const f of s.fs) m.set(f.e, (m.get(f.e) ?? 0) + 1);
  const c = [...m].sort((a, b) => b[1] - a[1]);
  return c.length
    ? c
        .map(([e, k]) => `${k} ${(EVIDENCE[e as keyof typeof EVIDENCE] ?? "Other").toLowerCase()}`)
        .join(", ")
    : "";
}

function SourcePanel({ c, n }: { c: PanelCtx; n: GNode }) {
  const { L } = c;
  const s = n.s;
  const u = unit(s);
  const pages = s.pages.map((p, i) => ({
    p,
    i,
    fs: s.fs.filter((f) => f.p === i).sort((a, b) => +(b.c >= 0) - +(a.c >= 0)),
  }));
  const used = (x: (typeof pages)[number]) => x.fs.filter((f) => f.c >= 0).length;
  const told = pages
    .filter((x) => x.fs.length)
    .sort((a, b) => used(b) - used(a) || b.fs.length - a.fs.length);
  const quiet = pages.filter((x) => !x.fs.length);
  const backs = Object.keys(s.claims)
    .map(Number)
    .sort((a, b) => a - b);
  const qs = (L.reach.get(n.id) ?? [])
    .map((i) => L.byQ.get(i))
    .filter((q): q is GraphSearch => !!q);
  const mix = evMix(s);
  const qli = quiet.map((x) => (
    <li key={x.p.u}>
      <Out href={x.p.u}>{x.p.t}</Out>
      {x.p.d ? <small> {day(x.p.d)}</small> : null}
    </li>
  ));
  return (
    <>
      <div className={`ph k-${s.kind}`}>
        <X c={c} />
        <div className="hd">
          <Ico s={s} />
          <h4>{s.name}</h4>
        </div>
        <p className="ct">
          <Kd k={s.kind} />
          {mix ? <span>{mix}</span> : null}
          <span>{stepAt(c.L.run, s.r, true)}</span>
          {s.pages.length ? (
            <>
              <span>{pl(s.pages.length, u)} read</span>
              <span>{s.kept ? `${pl(s.kept, "finding")} kept` : "No finding kept"}</span>
              {s.used ? <span>{pl(s.used, "finding")} in claims</span> : null}
            </>
          ) : (
            <span>Not read yet</span>
          )}
          {s.home ? <Out href={s.home}>Open the site</Out> : null}
        </p>
        {backs.length ? (
          <>
            <p className="lbl">Backs {pl(backs.length, "claim")}</p>
            <div className="cl">
              {backs.map((i) => (
                <button
                  key={i}
                  type="button"
                  className="chip"
                  onClick={() => c.pick({ t: "c", i }, true)}
                >
                  <i className="no">{L.run.claims[i]?.n}</i>
                  <span>{L.run.claims[i]?.head}</span>
                </button>
              ))}
            </div>
          </>
        ) : null}
        {qs.length ? (
          <>
            <p className="lbl">Found by {pl(qs.length, "search")}</p>
            <div className="cl">
              {qs.map((q) => (
                <QChip key={q.i} c={c} q={q} />
              ))}
            </div>
          </>
        ) : null}
      </div>
      <div className="pb">
        {picOf(s) ? <Frame img={picOf(s)} icon={s.icon} fmt={s.fmt} kind={s.kind} /> : null}
        {!s.pages.length ? (
          <p className="gh">A search found this and the run kept it, but nothing read it yet.</p>
        ) : null}
        {told.map((x) => (
          <section key={x.i} className="pg">
            <a className="pgh" href={x.p.u} target="_blank" rel="noopener">
              <Frame
                img={x.p.th ?? x.p.og}
                icon={s.icon}
                fmt={x.p.f || s.fmt}
                kind={s.kind}
                len={x.p.len}
                sm
              />
              <span>
                <b>{x.p.t}</b>
                <small>
                  {[
                    day(x.p.d),
                    clock(x.p.len),
                    stepAt(c.L.run, x.p.r),
                    x.p.kept ? pl(x.p.kept, "finding") : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
                <small className="go">
                  {s.site === "youtube" ? "Open the video" : "Open the page"}
                </small>
              </span>
            </a>
            {x.fs.map((f) => (
              <Finding key={s.fs.indexOf(f)} c={c} s={s} f={f} claim />
            ))}
          </section>
        ))}
        {quiet.length ? (
          told.length ? (
            <details>
              <summary>{pl(quiet.length, `more ${u}`)} read, no finding kept</summary>
              <ul>{qli}</ul>
            </details>
          ) : (
            <>
              <p className="lbl">Read. No finding kept.</p>
              <ul>{qli}</ul>
            </>
          )
        ) : null}
        <Unread c={c} s={s} />
      </div>
    </>
  );
}

function ClaimPanel({ c, i }: { c: PanelCtx; i: number }) {
  const cl = c.L.claims[i];
  if (!cl) return null;
  const ss = cl.ss
    .slice()
    .sort((a, b) => (b.s.claims[cl.i] ?? 0) - (a.s.claims[cl.i] ?? 0) || a.rank - b.rank);
  return (
    <>
      <div className="ph">
        <X c={c} />
        <div className="hd">
          <i className="no">{cl.c.n}</i>
          <h4>{cl.c.head}</h4>
        </div>
        {cl.c.rest ? <p className="rest">{cl.c.rest}</p> : null}
        <p className="ct">
          <span>
            {cl.c.findings
              ? `${pl(cl.c.findings, "finding")} from ${pl(ss.length, "source")}. Each quote opens on its page.`
              : "No checked finding backs this claim."}
          </span>
        </p>
      </div>
      <div className="pb">
        {ss.map((n) => {
          const s = n.s;
          const fs = s.fs.filter((f) => f.c === cl.i);
          return (
            <section key={s.id} className="pg">
              <button
                type="button"
                className="pgh"
                onClick={() => c.pick({ t: "s", id: s.id }, true)}
              >
                <Frame img={picOf(s)} icon={s.icon} fmt={s.fmt} kind={s.kind} sm />
                <span>
                  <b>{s.name}</b>
                  <small>
                    <Kd k={s.kind} /> · {pl(fs.length, "finding")} for this claim, {s.kept} kept
                  </small>
                </span>
              </button>
              {fs.map((f) => (
                <Finding key={s.fs.indexOf(f)} c={c} s={s} f={f} page />
              ))}
            </section>
          );
        })}
      </div>
    </>
  );
}

/** A dropped hit: what the run saw, why it said no, and the button to overrule it. */
function DropRow({ c, d }: { c: PanelCtx; d: GraphDrop }) {
  const on = c.queue.has(d.id);
  const art = d.f && /^[aeiou]/i.test(d.f[0]) ? "an" : "a";
  return (
    <div className="dr">
      <Frame img={d.th} icon={d.ic} fmt={d.f?.[0] ?? "article"} kind={d.k} sm />
      <details>
        <summary>
          <b>{d.t}</b>
          <small>
            <Kd k={d.k} />
            <span>{d.h}</span>
            {d.f ? (
              <span>
                reads as {art} {d.f[0]}
              </span>
            ) : null}
          </small>
          {d.s != null ? (
            <span className="sc" title={`${d.s}% on the subject, by the judge`}>
              <span className="tr">
                <i style={{ width: `${d.s}%` }} />
              </span>
              <em>{d.s}% on the subject</em>
            </span>
          ) : null}
        </summary>
        <div className="db">
          {d.sn ? <p>{d.sn}</p> : null}
          <p className="fm">
            <span>
              Dropped in {stepAt(c.L.run, d.r)}: {d.why}
            </span>
            {d.f ? (
              <span>
                The judge read it as a {d.f[0]} ({d.f[1]}%),{" "}
                {SPEAKERS[d.k]?.one.toLowerCase() ?? "other"} kind.
              </span>
            ) : null}
            <Out href={d.u}>Open the page</Out>
          </p>
          {d.q.length ? (
            <div className="cl">
              {d.q.map((i) => {
                const q = c.L.byQ.get(i);
                return q ? <QChip key={i} c={c} q={q} /> : null;
              })}
            </div>
          ) : null}
        </div>
      </details>
      <button type="button" className="rd" aria-pressed={on} onClick={() => c.toggleQ(d.id)}>
        {on ? "Will read" : "Read it"}
      </button>
    </div>
  );
}

function DropList({ c, groups, q }: { c: PanelCtx; groups: Indexed["why"]; q: string }) {
  const out = groups.map((g) => {
    const ds = q ? g.ds.filter((d) => `${d.t} ${d.h}`.toLowerCase().includes(q)) : g.ds;
    return (
      <div key={g.w}>
        {groups.length > 1 ? (
          <p className="lbl">
            {cap(g.w)} · {ds.length}
          </p>
        ) : null}
        {ds.slice(0, 400).map((d) => (
          <DropRow key={d.id} c={c} d={d} />
        ))}
        {ds.length > 400 ? (
          <p className="gh">{ds.length - 400} more. Filter to find them.</p>
        ) : null}
      </div>
    );
  });
  const any = groups.some((g) =>
    q ? g.ds.some((d) => `${d.t} ${d.h}`.toLowerCase().includes(q)) : g.ds.length,
  );
  return any ? out : <p className="gh">No dropped hit matches.</p>;
}

function DropPanel({ c, g }: { c: PanelCtx; g: number }) {
  const { L } = c;
  const one = g >= 0 ? L.why[g] : undefined;
  const groups = one ? [one] : L.why;
  const n = groups.reduce((s, x) => s + x.ds.length, 0);
  const q = useDeferredValue(c.dq.trim().toLowerCase());
  return (
    <>
      <div className="ph">
        <X c={c} />
        <div className="hd">
          <h4>{one ? cap(one.w) : "Dropped hits"}</h4>
        </div>
        <p className="ct">
          <span>
            {pl(n, "hit")} the run chose not to read. Most on the subject first, by the judge's
            score. Mark any it should read anyway.
          </span>
        </p>
        <input
          // edit-ok: filter box
          className="flt"
          type="search"
          placeholder="Filter by title or site"
          value={c.dq}
          aria-label="Filter the dropped hits"
          onChange={(e) => c.setDq(e.target.value)}
        />
      </div>
      <div className="pb">
        <DropList c={c} groups={groups} q={q} />
      </div>
    </>
  );
}

function SearchPanel({ c, q }: { c: PanelCtx; q: GraphSearch }) {
  const { L } = c;
  const ss = q.ss
    .map((id) => L.byId.get(id))
    .filter((n): n is GNode => !!n)
    .sort((a, b) => b.s.kept - a.s.kept || a.rank - b.rank);
  const dr = L.run.dropped
    .filter((d) => d.q.includes(q.i))
    .sort((a, b) => (b.s ?? -1) - (a.s ?? -1));
  return (
    <>
      <div className="ph">
        <X c={c} />
        <div className="hd">
          <i className="no q">{q.i + 1}</i>
          <h4>{q.t}</h4>
        </div>
        {q.why ? <p className="rest">{q.why}</p> : null}
        <p className="ct">
          <span>{stepAt(c.L.run, q.r, true)}</span>
          {q.f ? <span>{q.f}</span> : null}
          <span>
            {q.hits} hits, {q.kept} kept, {q.read} read, {pl(q.fnd, "finding")}
          </span>
        </p>
      </div>
      <div className="pb">
        {!ss.length ? <p className="gh">The run kept no hit from this search.</p> : null}
        {ss.length ? (
          <h5 className="sh">
            Kept <em>{ss.length}</em>
          </h5>
        ) : null}
        <Tiles c={c} ns={ss} />
        {dr.length ? (
          <>
            <h5 className="sh">
              Dropped <em>{dr.length}</em>
              <small>Most on the subject first. Mark any to read anyway.</small>
            </h5>
            {dr.map((d) => (
              <DropRow key={d.id} c={c} d={d} />
            ))}
          </>
        ) : null}
      </div>
    </>
  );
}

function SrcLink({ c, s }: { c: PanelCtx; s: GraphSource }) {
  return (
    <button type="button" className="lk" onClick={() => c.pick({ t: "s", id: s.id }, true)}>
      {s.name}
    </button>
  );
}

function PagePanel({ c, n, b }: { c: PanelCtx; n: GNode; b: number }) {
  const s = n.s;
  const pg = s.pages[b];
  if (!pg) return null;
  const fs = s.fs.filter((f) => f.p === b);
  return (
    <>
      <div className={`ph k-${s.kind}`}>
        <X c={c} />
        <div className="hd">
          <Ico s={s} />
          <h4>{pg.t}</h4>
        </div>
        <p className="ct">
          <Kd k={s.kind} />
          <SrcLink c={c} s={s} />
          <span>{stepAt(c.L.run, pg.r, true)}</span>
          <span>{fs.length ? pl(fs.length, "finding") : "No finding kept"}</span>
          <Out href={pg.u}>{s.site === "youtube" ? "Open the video" : "Open the page"}</Out>
        </p>
      </div>
      <div className="pb">
        {fs.length ? (
          fs.map((f) => <Finding key={s.fs.indexOf(f)} c={c} s={s} f={f} claim />)
        ) : (
          <p className="gh">The run read this {unit(s)} and kept no finding from it.</p>
        )}
      </div>
    </>
  );
}

function FindingPanel({ c, n, b }: { c: PanelCtx; n: GNode; b: number }) {
  const s = n.s;
  const f = s.fs[b];
  if (!f) return null;
  return (
    <>
      <div className={`ph k-${s.kind}`}>
        <X c={c} />
        <div className="hd">
          <Ico s={s} />
          <h4>Finding</h4>
        </div>
        <p className="ct">
          <Kd k={s.kind} />
          <SrcLink c={c} s={s} />
        </p>
      </div>
      <div className="pb">
        <Finding c={c} s={s} f={f} claim page />
      </div>
    </>
  );
}

/** One run of several: its ask, its note, its searches and the sources it kept findings from. */
function RunPanel({ c, r }: { c: PanelCtx; r: number }) {
  const { L } = c;
  const run = L.run.runs?.[r - 1];
  if (!run || !L.many) return null;
  const qs = (L.many.qs.get(r) ?? []).map((i) => L.byQ.get(i)).filter((q) => !!q);
  const ns = L.many.src.get(r) ?? [];
  return (
    <>
      <div className="ph">
        <X c={c} />
        <div className="hd">
          <i className="no q">{r}</i>
          <h4>{headOf(run.t).t}</h4>
        </div>
        {headOf(run.t).ask ? <p className="rest">{run.t}</p> : null}
        {run.note ? <p className="rest">{run.note}</p> : null}
        <p className="ct">
          <span>{stepAt(L.run, r, true)}</span>
          <span>
            {pl(qs.length, "search")}, {pl(ns.length, "source")} with findings
          </span>
        </p>
      </div>
      <div className="pb">
        {qs.length ? <p className="lbl">Searches · {qs.length}</p> : null}
        {qs.map((q) => (
          <QChip key={q.i} c={c} q={q} />
        ))}
        {ns.length ? <p className="lbl">Sources · {ns.length}</p> : null}
        {!qs.length && !ns.length ? <p className="gh">This run has no search yet.</p> : null}
        <Tiles c={c} ns={ns} />
      </div>
    </>
  );
}

function NodePanel({ c, k }: { c: PanelCtx; k: string }) {
  const { L } = c;
  const [t, a, b] = parse(k);
  if (t === "r") return <RunPanel c={c} r={a} />;
  const n = L.byId.get(a);
  if (t === "p" && n) return <PagePanel c={c} n={n} b={b} />;
  if ((t === "f" || t === "x") && n) return <FindingPanel c={c} n={n} b={b} />;
  const qi = t === "d" ? a : t === "h" ? L.run.dropped[a]?.q[0] : undefined;
  if (qi != null) {
    const q = L.byQ.get(qi);
    return q ? <SearchPanel c={c} q={q} /> : null;
  }
  return n ? <SourcePanel c={c} n={n} /> : null;
}

export function PanelBody({ c, p }: { c: PanelCtx; p: Pick }) {
  const { L } = c;
  if (p.t === "n") return <NodePanel c={c} k={p.key} />;
  if (p.t === "s") {
    const n = L.byId.get(p.id);
    return n ? <SourcePanel c={c} n={n} /> : null;
  }
  if (p.t === "c") return <ClaimPanel c={c} i={p.i} />;
  if (p.t === "q") {
    const q = L.byQ.get(p.i);
    return q ? <SearchPanel c={c} q={q} /> : null;
  }
  return <DropPanel c={c} g={p.g} />;
}
