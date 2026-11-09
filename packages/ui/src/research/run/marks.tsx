/** The graph's marks: icons, the evidence bar, source tiers, claim cards and the web's node kinds. */
import { type CSSProperties, type ReactNode, useState } from "react";
import {
  answerOf,
  atQuote,
  countOf,
  EV_ALPHA,
  EV_ORDER,
  EVIDENCE,
  evCounts,
  evIndex,
  type GNode,
  type GraphSource,
  headOf,
  type Indexed,
  pic,
  pl,
  SPEAKER_ORDER,
  SPEAKERS,
  type Speaker,
  spokesOf,
  stepAt,
  unit,
} from "./model.js";
import { parse } from "./web.js";

/** A css custom property in a style prop. */
export const vars = (v: Record<string, string | number>, base?: CSSProperties) =>
  ({ ...base, ...v }) as CSSProperties;

const GL: Record<string, ReactNode> = {
  video: (
    <>
      <rect x="1.5" y="3.5" width="13" height="9" rx="2" />
      <path d="M6.6 6v4l3.4-2z" fill="currentColor" stroke="none" />
    </>
  ),
  thread: (
    <>
      <rect x="1.5" y="2.5" width="9" height="5.5" rx="1.6" />
      <rect x="5.5" y="8.5" width="9" height="5.5" rx="1.6" />
    </>
  ),
  paper: (
    <>
      <rect x="3" y="1.5" width="10" height="13" rx="1" />
      <path d="M5.5 4.5h5M5 7.5h2.5M8.5 7.5H11M5 10h2.5M8.5 10H11M5 12.3h2.5M8.5 12.3H11" />
    </>
  ),
  docs: (
    <>
      <rect x="1.5" y="2" width="13" height="12" rx="1.5" />
      <path d="M5.5 2v12M7.8 5.5h4.4M7.8 8h4.4M7.8 10.5h3" />
    </>
  ),
  list: (
    <>
      <path d="M6 4h8M6 8h8M6 12h8" />
      <circle cx="3" cy="4" r=".8" fill="currentColor" />
      <circle cx="3" cy="8" r=".8" fill="currentColor" />
      <circle cx="3" cy="12" r=".8" fill="currentColor" />
    </>
  ),
  article: (
    <>
      <rect x="2.5" y="1.5" width="11" height="13" rx="1.2" />
      <rect
        x="4.5"
        y="3.5"
        width="7"
        height="4"
        rx=".6"
        fill="currentColor"
        stroke="none"
        opacity=".35"
      />
      <path d="M4.5 10h7M4.5 12.3h4.5" />
    </>
  ),
};

function Glyph({ f }: { f: string }) {
  const k = f === "post" ? "thread" : f === "directory" ? "list" : f;
  return (
    <svg
      className="ic g"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.25}
      strokeLinecap="round"
      aria-hidden="true"
    >
      {GL[k] ?? GL.article}
    </svg>
  );
}

const Mag = () => (
  <svg
    className="ic g"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.4}
    strokeLinecap="round"
    aria-hidden="true"
  >
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.4 10.4 14 14" />
  </svg>
);

/** The site's icon; its glyph when there is none or it fails. Same box either way. */
export function Ico({ s }: { s: GraphSource }) {
  const [bad, setBad] = useState(false);
  return s.icon && !bad ? (
    <img
      className="ic"
      src={s.icon}
      alt=""
      referrerPolicy="no-referrer"
      onError={() => setBad(true)}
    />
  ) : (
    <Glyph f={s.fmt} />
  );
}

/** An image that hides itself on a failed load; its box keeps its size. */
export function Img({ src, className }: { src: string; className?: string }) {
  const [bad, setBad] = useState(false);
  return (
    <img
      className={className}
      src={src}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      style={bad ? { visibility: "hidden" } : undefined}
      onError={() => setBad(true)}
    />
  );
}

const evTitle = (c: number[]) =>
  EV_ORDER.map((e, i) => (c[i] ? `${c[i]} ${EVIDENCE[e].toLowerCase()}` : ""))
    .filter(Boolean)
    .join(", ");

export function EvBar({ c }: { c: number[] }) {
  if (!c.some(Boolean)) return null;
  return (
    <span className="evb" title={evTitle(c)}>
      {EV_ORDER.map((e, i) =>
        c[i] ? <i key={e} style={vars({ "--o": EV_ALPHA[i] ?? 1 }, { flex: c[i] })} /> : null,
      )}
    </span>
  );
}

export const Kd = ({ k }: { k: Speaker }) => (
  <span className={`kd k-${k}`}>
    <i />
    {SPEAKERS[k].one}
  </span>
);

export type Tier = "card" | "chip" | "dot";
/** The top sources with findings by rank get a card, the rest a chip, gray while it has none. */
export const tierOf = (n: GNode, wide: boolean): Tier =>
  n.lr >= 0 && n.lr < (wide ? 12 : 4) ? "card" : "chip";

/** Shared by every mark you can pick: role, focus, its state classes. */
export interface MarkProps {
  cls?: string;
  /** focus, pick, open, new, gone, late, sh */
  on?: boolean;
  pk?: boolean;
  onClick?: (e: React.MouseEvent<HTMLElement>) => void;
  onKey?: (e: React.KeyboardEvent<HTMLElement>) => void;
  onHover?: (e: React.PointerEvent<HTMLElement>) => void;
  reg?: ((el: HTMLElement | null) => void) | undefined;
  n?: string;
  expanded?: boolean | undefined;
  badge?: ReactNode;
}

const cls = (...xs: (string | false | undefined | null)[]) => xs.filter(Boolean).join(" ");

function Mark({
  className,
  label,
  children,
  m,
}: {
  className: string;
  label: string;
  children?: ReactNode;
  m: MarkProps;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a positioned card holding links and blocks; a button can't hold those
    <div
      ref={m.reg}
      className={cls(className, m.cls, m.on && "on", m.pk && "pk")}
      data-n={m.n}
      role="button"
      tabIndex={0}
      aria-label={label.slice(0, 200)}
      aria-expanded={m.expanded}
      onClick={m.onClick}
      onKeyDown={m.onKey}
      onPointerOver={m.onHover}
    >
      {children}
      {m.badge}
    </div>
  );
}

export function SourceMark({ n, tier, m }: { n: GNode; tier: Tier; m: MarkProps }) {
  const s = n.s;
  const label = `${s.name}: ${countOf(n)}`;
  if (tier === "card") {
    const p = pic(s);
    return (
      <Mark className={`nd cd k-${n.k}`} label={label} m={m}>
        {p ? (
          <span className={cls("mi", s.site === "youtube" && "v")}>
            <Img src={p} />
          </span>
        ) : null}
        <span className="nm">
          <Ico s={s} />
          <b>{s.name}</b>
        </span>
        <small>{countOf(n)}</small>
        <EvBar c={evCounts(s.fs)} />
      </Mark>
    );
  }
  if (tier === "chip")
    return (
      <Mark
        className={cls(`nd ch k-${n.k}`, !s.kept && (s.pages.length ? "rej" : "pend"))}
        label={label}
        m={m}
      >
        <Ico s={s} />
        <b>{s.name}</b>
        {s.kept ? <em>{s.kept}</em> : null}
      </Mark>
    );
  return <Mark className={cls(`nd dt k-${n.k}`, !s.pages.length && "gh")} label={label} m={m} />;
}

/** A search as a hub: the query, its answer, then counts, evidence and who speaks. */
function HubMark({ L, i, m }: { L: Indexed; i: number; m: MarkProps }) {
  const q = L.byQ.get(i);
  if (!q) return null;
  const ans = answerOf(L, i);
  const sp = spokesOf(L, i).sort((a, b) => SPEAKER_ORDER.indexOf(a.k) - SPEAKER_ORDER.indexOf(b.k));
  const sub = `${q.hits} hits · ${q.kept} kept · ${q.fnd ? pl(q.fnd, "finding") : "no finding"}`;
  return (
    <Mark
      className={cls("nd hq", !ans && "na")}
      label={`Search ${q.i + 1}: ${q.t}. ${ans ? `Answer: ${ans.f.t}` : "No answer"}. ${sub}`}
      m={m}
    >
      <span className="cn">
        <i>{q.i + 1}</i>
        <Mag />
        {stepAt(L.run, q.r)}
      </span>
      <b>{q.t}</b>
      {ans ? (
        <p className="an">{ans.f.t}</p>
      ) : (
        <p className="an gh">{q.kept ? "No finding yet" : "Kept no hit"}</p>
      )}
      <small>{sub}</small>
      <EvBar c={evCounts(sp.flatMap((n) => n.s.fs))} />
      {sp.length ? (
        <span className="spk">
          {sp.map((n) => (
            <i key={n.id} className={`k-${n.k}`} />
          ))}
        </span>
      ) : null}
    </Mark>
  );
}

/** A run of several as a hub: its ask, its note, then counts, evidence and who speaks. */
function RunMark({ L, r, m }: { L: Indexed; r: number; m: MarkProps }) {
  const run = L.run.runs?.[r - 1];
  if (!run || !L.many) return null;
  const nq = L.many.qs.get(r)?.length ?? 0;
  const sp = (L.many.src.get(r) ?? [])
    .slice()
    .sort((a, b) => SPEAKER_ORDER.indexOf(a.k) - SPEAKER_ORDER.indexOf(b.k));
  const sub = `${pl(nq, "search")} · ${pl(sp.length, "source")} · ${pl(
    sp.reduce((s, n) => s + n.s.kept, 0),
    "finding",
  )}`;
  return (
    <Mark
      className={cls("nd hq hr", !run.note && "na")}
      label={`Run ${r}: ${run.t}. ${run.note ? `Note: ${run.note}` : "No note"}. ${sub}`}
      m={m}
    >
      <span className="cn">
        <i>{r}</i>
        Run {r}
      </span>
      <b>{headOf(run.t).t}</b>
      {run.note ? <p className="an">{run.note}</p> : null}
      <small>{sub}</small>
      <EvBar c={evCounts(sp.flatMap((n) => n.s.fs))} />
      {sp.length ? (
        <span className="spk">
          {sp.map((n) => (
            <i key={n.id} className={`k-${n.k}`} />
          ))}
        </span>
      ) : null}
    </Mark>
  );
}

/** One node of the query web, by its key (web.ts). */
export function WebMark({
  L,
  k,
  wide,
  left,
  m,
}: {
  L: Indexed;
  k: string;
  wide: boolean;
  /** for "m": how many wait */
  left: number;
  m: MarkProps;
}) {
  const [t, a, b] = parse(k);
  const g = L.byId.get(a);
  if (t === "m")
    return (
      <Mark
        className="nd gpn more"
        label={`Show ${Math.min(left, wide ? 8 : 6)} more`}
        m={{ ...m, badge: null }}
      >
        {left} more
      </Mark>
    );
  if (t === "s" && g) return <SourceMark n={g} tier={tierOf(g, wide)} m={m} />;
  if ((t === "p" || t === "v") && g) {
    const s = g.s;
    const pg = t === "p" ? s.pages[b] : s.unread[b];
    if (!pg) return null;
    const nf = t === "p" ? s.fs.filter((f) => f.p === b).length : 0;
    const im = t === "p" ? (s.pages[b]?.th ?? s.pages[b]?.og ?? null) : null;
    const sub =
      t === "v"
        ? `Not read · ${stepAt(L.run, pg.r)}`
        : `${nf ? pl(nf, "finding") : "No finding"} · ${stepAt(L.run, pg.r)}`;
    return (
      <Mark className={cls(`nd pgn k-${g.k}`, t === "v" && "ur")} label={`${pg.t} ${sub}`} m={m}>
        {im ? <Img className="pt" src={im} /> : <Glyph f={(t === "p" && s.pages[b]?.f) || s.fmt} />}
        <span>
          <b>{pg.t}</b>
          <small>{sub}</small>
        </span>
      </Mark>
    );
  }
  if (t === "f" && g) {
    const f = g.s.fs[b];
    if (!f) return null;
    const sub = `${EVIDENCE[f.e] ?? "Other"}${f.c >= 0 ? ` · claim ${L.run.claims[f.c]?.n}` : " · in no claim"}${f.ok === 0 ? " · check failed" : ""}`;
    return (
      <Mark className={cls("nd fdn", f.c >= 0 && "inc")} label={`${f.t} ${sub}`} m={m}>
        <i className="et" style={vars({ "--o": Math.max(0.25, EV_ALPHA[evIndex(f.e)] ?? 1) })} />
        <p>{f.t}</p>
        <small>{sub}</small>
      </Mark>
    );
  }
  if (t === "x" && g) {
    const s = g.s;
    const f = s.fs[b];
    if (!f) return null;
    const pg = s.pages[f.p];
    const aq = pg && atQuote(pg.u, f.q);
    return (
      <Mark className="nd qn" label={f.q} m={m}>
        <q>{f.q}</q>
        <small>
          {pg ? (
            <a href={aq || pg.u} target="_blank" rel="noopener">
              {aq ? "Open at the quote" : `Open the ${unit(s)}`}
            </a>
          ) : null}
          {f.ok === 1 ? <span>Checked</span> : null}
        </small>
      </Mark>
    );
  }
  if ((t === "n" || t === "u") && g) {
    const s = g.s;
    const c =
      t === "n" ? s.pages.filter((_, i) => !s.fs.some((f) => f.p === i)).length : s.unread.length;
    const txt = `${pl(c, unit(s))} ${t === "n" ? "read, no finding" : "kept, not read"}`;
    return (
      <Mark className={`nd gpn k-${g.k}`} label={txt} m={m}>
        {txt}
      </Mark>
    );
  }
  if (t === "q") return <HubMark L={L} i={a} m={m} />;
  if (t === "r") return <RunMark L={L} r={a} m={m} />;
  if (t === "d") {
    const txt = `${pl((L.drops.get(a) ?? []).length, "hit")} dropped`;
    return (
      <Mark className="nd gpn" label={txt} m={m}>
        {txt}
      </Mark>
    );
  }
  if (t === "h") {
    const d = L.run.dropped[a];
    if (!d) return null;
    return (
      <Mark className="nd hn" label={`${d.t} ${d.h} · ${d.why}`} m={m}>
        <b>{d.t}</b>
        <small>
          {d.h} · {d.why}
        </small>
      </Mark>
    );
  }
  return null;
}

/** The "+N" a node shows when it holds more; "−" once open. */
export const Badge = ({ open, n }: { open: boolean; n: number }) =>
  n ? (
    <span className="xp" aria-hidden="true">
      {open ? "−" : `+${n}`}
    </span>
  ) : null;
