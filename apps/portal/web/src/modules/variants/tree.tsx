/**
 * A subject's generation tree: rows by batch, a snapshot per sample sized by his call, the
 * strongest line in the middle. Point for a card, select to light a path; arrows walk it.
 * Port of the approved preview (artifact A5xNkRRGMoMZuH8s7mvfRL, pass 5).
 */
import { Button, Seg, useZoomStage, type ZoomBox, type ZoomRoom, ZoomTools } from "@wren/ui";
import {
  type CSSProperties,
  type KeyboardEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { call } from "../../api.js";
import { keep as keepLocal, recall } from "../../local.js";
import { here, href, navigate } from "../../route.js";
import { usePageContext } from "../agent/drive.js";
import { BatchDetail, PIN, Pin, SampleDetail } from "./tree-detail.js";
import {
  type Call,
  G,
  hiddenBy,
  isGood,
  nameLines,
  strong,
  TH,
  type TNode,
  type Tree,
  type TreeBatch,
  type TreeGuide,
  treeOf,
  VERD,
} from "./tree-model.js";
import { CARD_W, f1, HH, OpenCard, Rail, Tip, type View } from "./tree-stage.js";
import "./tree.css";

const LEGEND: readonly Call[] = ["amazing", "good", "okay", "bad", "grew", "unmarked", "open"];
/** a curve one row down, then straight */
const drop = (x1: number, y1: number, x2: number, y2: number, g: number) =>
  y2 - y1 <= g + 1
    ? `M${f1(x1)} ${f1(y1)}C${f1(x1)} ${f1(y1 + (y2 - y1) * 0.55)} ${f1(x2)} ${f1(y1 + (y2 - y1) * 0.45)} ${f1(x2)} ${f1(y2)}`
    : `M${f1(x1)} ${f1(y1)}C${f1(x1)} ${f1(y1 + g * 0.55)} ${f1(x2)} ${f1(y1 + g * 0.45)} ${f1(x2)} ${f1(y1 + g)}V${f1(y2)}`;
const HW = (v: Call) => TH[v][0] / 2;
/** under this stage width the open card is a sheet at the stage's foot */
const SHEET_UNDER = 640;
/** a camera move's length */
const MOVE_MS = 380;
export interface TreeProps {
  subject: { slug: string; name: string; kind: string; brief: string | null };
  batches: readonly TreeBatch[];
  guides: readonly TreeGuide[];
  /** The address: `show`, `branch`, `fold` set the shape. None: the shape kept in this browser. */
  params?: URLSearchParams | undefined;
  /** his live steers; none: no steer controls */
  steers?: readonly TreeSteer[] | undefined;
  /** samples a prune stops: the pruned one and what grew from it */
  pruned?: readonly number[] | undefined;
  /** after a steer or a lift: load the subject again */
  onSteered?: (() => void) | undefined;
}

/** A live steer (vireo D10): his hand on what the next batch may do. */
export interface TreeSteer {
  id: number;
  kind: "pin" | "prune" | "cross" | "width";
  sampleId: number | null;
  otherId: number | null;
  width: string | null;
  why: string | null;
}
const WIDTH_ITEMS = [
  { value: "narrow", label: "Narrow" },
  { value: "normal", label: "Normal" },
  { value: "wide", label: "Wide" },
] as const;
type Width = (typeof WIDTH_ITEMS)[number]["value"];

/** What the tree shows: all or the good line, one sample's line only, folded samples. */
interface Shape {
  mode: "all" | "line";
  branch: number | null;
  fold: number[];
}
const ALL: Shape = { mode: "all", branch: null, fold: [] };
const shapeKey = (slug: string) => `variants:tree:${slug}`;
const ids = (v: unknown): number[] =>
  Array.isArray(v) ? v.filter((n): n is number => Number.isInteger(n) && n > 0) : [];
function shapeOf(slug: string, params: URLSearchParams | undefined): Shape {
  if (params && ["show", "branch", "fold"].some((k) => params.has(k)))
    return {
      mode: params.get("show") === "line" ? "line" : "all",
      branch: Number(params.get("branch")) || null,
      fold: ids((params.get("fold") ?? "").split(",").map(Number)),
    };
  try {
    const k = JSON.parse(recall(shapeKey(slug)) ?? "null") as Partial<Shape> | null;
    if (!k || typeof k !== "object") return ALL;
    return {
      mode: k.mode === "line" ? "line" : "all",
      branch: Number.isInteger(k.branch) ? (k.branch as number) : null,
      fold: ids(k.fold),
    };
  } catch {
    return ALL;
  }
}

export function SubjectTree({
  subject,
  batches,
  guides,
  params,
  steers,
  pruned: prunedIds,
  onSteered,
}: TreeProps) {
  const full = useMemo(() => treeOf(batches, guides), [batches, guides]);
  const [shape, setShapeNow] = useState<Shape>(() => shapeOf(subject.slug, params));
  const mode = shape.mode;
  const setShape = (next: Shape) => {
    setShapeNow(next);
    keepLocal(shapeKey(subject.slug), JSON.stringify(next));
    if (params)
      navigate(
        href(
          here().split("?")[0] ?? "/",
          {
            show: next.mode === "line" ? "line" : null,
            branch: next.branch,
            fold: next.fold.join(",") || null,
          },
          params,
        ),
        true,
      );
  };
  const setMode = (m: Shape["mode"]) => setShape({ ...shape, mode: m });
  const { hide, count } = useMemo(
    () => hiddenBy(full, shape.branch, new Set(shape.fold)),
    [full, shape.branch, shape.fold],
  );
  const t = useMemo(
    () => (hide.size ? treeOf(batches, guides, hide) : full),
    [full, hide, batches, guides],
  );
  const branch = shape.branch != null ? (full.byId.get(shape.branch) ?? null) : null;
  const folded = shape.fold.filter((id) => full.byId.has(id));
  // the pick when it shows, else the drawn tree's own
  const first = full.first != null && t.byId.has(full.first) ? full.first : t.first;
  const [sel, setSel] = useState<number | null>(first);
  const [focus, setFocus] = useState<number | null>(first);
  const [tip, setTip] = useState<number | null>(null);
  // the hover card sits in the stage; place it by the camera at hover time
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1, w: G.W, h: 600 });
  const [open, setOpen] = useState<number | null>(null);
  const [kept, setKept] = useState<Record<number, boolean>>({});
  const [stage, setStage] = useState<HTMLElement | null>(null);
  const [sw, setSw] = useState(0);
  const sheet = sw > 0 && sw < SHEET_UNDER;
  const world = useRef<HTMLDivElement>(null);
  const rail = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const tNow = useRef(t);
  tNow.current = t;
  const Z = useZoomStage(stage, {
    extent: [0.3, 2],
    wheel: "pan",
    ignore: ".vt-open,.vt-tools,.vt-ga",
    bounds: () => ({ x0: 0, y0: 0, x1: G.W, y1: tNow.current.height }),
    onZoom: (z) => {
      const w = world.current;
      if (w) w.style.transform = `translate(${f1(z.x)}px,${f1(z.y)}px) scale(${z.k})`;
      // the rail holds its x, follows the rows
      const r = rail.current;
      if (r) r.style.transform = `translate(0,${f1(z.y)}px) scale(${z.k})`;
      setTip(null);
    },
  });
  useEffect(() => {
    if (!stage) return;
    const ro = new ResizeObserver(() => setSw(stage.clientWidth));
    ro.observe(stage);
    setSw(stage.clientWidth);
    return () => ro.disconnect();
  }, [stage]);
  /** the stage room a view may use: right of the rail, above the sheet */
  const room = (): ZoomRoom => {
    const W = stage?.clientWidth ?? G.W;
    const H = stage?.clientHeight ?? 600;
    const rw = rail.current?.getBoundingClientRect().width ?? 0;
    const sh = sheet && open != null ? (card.current?.offsetHeight ?? 0) + 8 : 0;
    return { l: rw + 8, t: 8, r: W - 8, b: H - sh - 8 };
  };
  const nodeBox = (n: TNode): ZoomBox => {
    const p = t.pos(n);
    const hw = Math.max(HW(n.v), 22);
    const hh = Math.max(HH(n.v), 22);
    return { x0: p.x - hw, y0: p.y - hh - 16, x1: p.x + hw, y1: p.y + hh + 40 };
  };
  /** 1:1 on the selected sample */
  const rest = (ms = 0) => {
    if (!stage) return;
    const at =
      (sel != null ? t.byId.get(sel) : null) ?? (t.first != null ? t.byId.get(t.first) : null);
    const p = at ? t.pos(at) : t.pos(null);
    const W = stage.clientWidth;
    const H = stage.clientHeight;
    // a tree that fits shows whole from the brief; a taller one centres the sample, no gap below
    const y = t.height <= H ? 0 : Math.min(0, Math.max(H - t.height - 16, H * 0.45 - p.y));
    // centre in the room right of the rail
    const R = room();
    Z.set(Math.min(0, Math.max(W - G.W - 16, (R.l + R.r) / 2 - p.x)), y, 1, ms);
  };
  const fitAll = () =>
    Z.fit({ x0: G.AX - 20, y0: 0, x1: G.W, y1: t.height }, room(), { min: 0.3, ms: MOVE_MS });
  const nodes = useRef(new Map<number, SVGGElement>());
  const uid = useId().replace(/:/g, "");
  const isKept = (s: TNode) => kept[s.id] ?? s.kept;
  const s = sel != null ? (full.byId.get(sel) ?? null) : null;
  const round = s ? full.rounds[s.r - 1] : undefined;
  usePageContext(
    `in view: ${subject.slug} generation tree${s ? `, ${s.name} selected (sample ${s.id}, batch ${subject.slug}:${round?.num})` : ""}${
      steers?.length
        ? `; live steers: ${steers.map((x) => (x.kind === "width" ? `width ${x.width}` : x.kind === "cross" ? `cross ${x.sampleId}×${x.otherId}` : `${x.kind} ${x.sampleId}`)).join(", ")}`
        : ""
    }`,
  );
  // open on the selected sample at 1:1; again when the shape changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new layout or stage moves the camera.
  useLayoutEffect(() => rest(), [t, stage]);
  const openNode = open != null ? (t.byId.get(open) ?? null) : null;
  const side = openNode && t.pos(openNode).x < (G.AX + G.W) / 2 ? "right" : "left";
  // a card opened: bring it and its sample into view at reading size
  // biome-ignore lint/correctness/useExhaustiveDependencies: the open card and the stage's form decide it
  useLayoutEffect(() => {
    if (!openNode) return;
    const nb = nodeBox(openNode);
    if (sheet) {
      // the sheet sits at the stage foot: bring the whole stage on screen
      stage?.scrollIntoView({
        block: "nearest",
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      });
      return Z.bring(nb, room(), { pad: 16, min: 0.8, max: 1.25, ms: MOVE_MS });
    }
    const p = t.pos(openNode);
    const h = card.current?.offsetHeight ?? 480;
    const x0 = side === "right" ? p.x + HW(openNode.v) + 18 : p.x - HW(openNode.v) - 18 - CARD_W;
    const y0 = p.y - HH(openNode.v) - 8;
    Z.bring(
      {
        x0: Math.min(nb.x0, x0),
        y0: Math.min(nb.y0, y0),
        x1: Math.max(nb.x1, x0 + CARD_W),
        y1: Math.max(nb.y1, y0 + h),
      },
      room(),
      { pad: 16, min: 0.9, max: 1.25, ms: MOVE_MS },
    );
  }, [open, sheet]);
  const marked = full.S.filter((x) => x.v !== "grew" && x.v !== "unmarked" && x.v !== "open");
  const locked = guides.filter((g) => g.state === "locked").length;
  const select = (id: number) => {
    // a hidden sample: show it, leave the rest of the shape
    if (hide.has(id)) {
      const up = full.line(id);
      setShape({
        ...shape,
        branch: shape.branch != null && full.line(shape.branch).has(id) ? shape.branch : null,
        fold: shape.fold.filter((f) => !up.has(f) || f === id),
      });
    }
    setSel(id);
    setFocus(id);
    // an open card follows a jump (a parent link, a steer chip)
    setOpen((o) => (o != null ? id : o));
  };
  /** a click on a card: open it there; again: close it */
  const pick = (id: number) => {
    if (open === id) return setOpen(null);
    select(id);
    setOpen(id);
  };
  const toggleFold = (id: number) =>
    setShape({
      ...shape,
      fold: shape.fold.includes(id) ? shape.fold.filter((f) => f !== id) : [...shape.fold, id],
    });
  const keys = (ev: KeyboardEvent, n: TNode) => {
    const row = t.S.filter((x) => x.r === n.r).sort((a, b) => t.pos(a).x - t.pos(b).x);
    const i = row.indexOf(n);
    let to: TNode | undefined;
    if (ev.key === "ArrowLeft") to = row[i - 1];
    else if (ev.key === "ArrowRight") to = row[i + 1];
    else if (ev.key === "ArrowUp") to = n.p[0] != null ? t.byId.get(n.p[0]) : undefined;
    else if (ev.key === "ArrowDown") to = t.tkids(n.id).sort((a, b) => t.pos(a).x - t.pos(b).x)[0];
    else if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      pick(n.id);
      return;
    } else return;
    ev.preventDefault();
    if (!to) return;
    setFocus(to.id);
    nodes.current.get(to.id)?.focus({ preventScroll: true });
    // the camera follows the walk, at its zoom
    const k = Z.T.current?.k ?? 1;
    Z.bring(nodeBox(to), room(), { pad: 40, min: k, max: k, ms: 200 });
  };
  const stageKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "Escape" && open != null) {
      e.preventDefault();
      const id = open;
      setOpen(null);
      nodes.current.get(id)?.focus({ preventScroll: true });
      return;
    }
    if ((e.target as HTMLElement).closest("input, textarea, select, [contenteditable], .vt-open"))
      return;
    Z.keys(e, { fit: fitAll, rest: () => rest(MOVE_MS) });
  };
  const live = steers ?? [];
  const pruned = useMemo(() => new Set(prunedIds ?? []), [prunedIds]);
  const width = (live.find((x) => x.kind === "width")?.width ?? "normal") as Width;
  const [crossFrom, setCrossFrom] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const act = async (
    path: "variants/steer" | "variants/unsteer",
    body: Record<string, unknown>,
  ) => {
    setBusy(true);
    setRefused(null);
    try {
      await call(path, body);
      onSteered?.();
    } catch (e) {
      setRefused(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const nameOf = (id: number | null) => (id != null ? (full.byId.get(id)?.name ?? `#${id}`) : "");
  const keep = (n: TNode) => {
    const on = !isKept(n);
    setKept((k) => ({ ...k, [n.id]: on }));
    void call("variants/keep", { sample: n.id, on }).catch(() =>
      setKept((k) => ({ ...k, [n.id]: !on })),
    );
  };
  /** the open card's body: the sample's whole detail */
  const detail = (n0: TNode) => {
    const n = full.byId.get(n0.id) ?? n0;
    const r = full.rounds[n.r - 1];
    if (!r) return null;
    return (
      <SampleDetail
        t={full}
        s={n}
        round={r}
        kept={isKept(n)}
        onGo={select}
        onKeep={() => keep(n)}
        subject={subject.slug}
        only={shape.branch === n.id}
        onOnly={() => setShape({ ...shape, branch: shape.branch === n.id ? null : n.id })}
        folded={shape.fold.includes(n.id)}
        onFold={() => toggleFold(n.id)}
        steer={
          steers && {
            pin: live.find((x) => x.kind === "pin" && x.sampleId === n.id),
            prune: live.find((x) => x.kind === "prune" && x.sampleId === n.id),
            pruned: pruned.has(n.id),
            crossFrom: crossFrom != null && crossFrom !== n.id ? nameOf(crossFrom) : null,
            busy,
            set: (kind) => {
              if (kind === "cross") {
                if (crossFrom == null || crossFrom === n.id) return setCrossFrom(n.id);
                setCrossFrom(null);
                return void act("variants/steer", { kind, sample: crossFrom, other: n.id });
              }
              void act("variants/steer", { kind, sample: n.id });
            },
            lift: (id) => void act("variants/unsteer", { id }),
          }
        }
      />
    );
  };
  return (
    <div className="vt">
      <div className="vt-sum">
        <span className="vt-fact">
          <b>{full.rounds.length}</b> batches
        </span>
        <span className="vt-fact">
          <b>{full.S.length}</b> samples
        </span>
        <span className="vt-fact">
          <b>{marked.filter(isGood).length}</b> good or better of {marked.length} marked
        </span>
        <span className="vt-fact">
          <b>{locked}</b> guides locked
        </span>
        {steers && (
          <span className="vt-fact vt-spread">
            Spread
            <Seg
              dense
              label="Spread"
              items={WIDTH_ITEMS}
              value={width}
              onChange={(w) => {
                if (w !== width && !busy)
                  void act("variants/steer", { kind: "width", subject: subject.slug, width: w });
              }}
            />
          </span>
        )}
        <Seg
          dense
          label="Show"
          items={[
            { value: "all", label: "All samples" },
            { value: "line", label: "Good line" },
          ]}
          value={mode}
          onChange={setMode}
        />
      </div>
      {steers && (live.some((x) => x.kind !== "width") || crossFrom != null || refused) && (
        <div className="vt-scope vt-steers">
          {crossFrom != null && (
            <span className="vt-fact">
              Pick a sample to cross with <b>{nameOf(crossFrom)}</b>
              <Button size="dense" tone="quiet" onClick={() => setCrossFrom(null)}>
                Cancel
              </Button>
            </span>
          )}
          {live
            .filter((x) => x.kind !== "width")
            .map((x) => (
              <span key={x.id} className="vt-fact" title={x.why ?? undefined}>
                {x.kind === "pin" ? "Grow from " : x.kind === "prune" ? "Pruned " : "Cross "}
                <button
                  type="button"
                  className="vt-plain"
                  onClick={() => x.sampleId && select(x.sampleId)}
                >
                  <b>{nameOf(x.sampleId)}</b>
                </button>
                {x.kind === "cross" && (
                  <>
                    {" × "}
                    <button
                      type="button"
                      className="vt-plain"
                      onClick={() => x.otherId && select(x.otherId)}
                    >
                      <b>{nameOf(x.otherId)}</b>
                    </button>
                  </>
                )}
                <Button
                  size="dense"
                  tone="quiet"
                  aria-label={`Lift: ${x.kind} ${nameOf(x.sampleId)}`}
                  disabled={busy}
                  onClick={() => void act("variants/unsteer", { id: x.id })}
                >
                  Lift
                </Button>
              </span>
            ))}
          {refused && <span className="vt-fact vt-refused">{refused}</span>}
        </div>
      )}
      {(branch || folded.length > 0) && (
        <div className="vt-scope">
          {branch && (
            <span className="vt-fact">
              Only the line of <b>{branch.name}</b>
            </span>
          )}
          {folded.length > 0 && (
            <span className="vt-fact">
              Folded:{" "}
              <b>
                {folded.length > 3
                  ? `${folded.length} samples`
                  : folded.map((id) => full.byId.get(id)?.name).join(", ")}
              </b>
              {!branch && ` · ${hide.size} hidden`}
            </span>
          )}
          <Button
            className="ml-auto"
            size="dense"
            tone="quiet"
            onClick={() => setShape({ ...shape, branch: null, fold: [] })}
          >
            Show all
          </Button>
        </div>
      )}
      <section
        ref={setStage}
        className="vt-stage"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the stage takes keys to zoom and fit
        tabIndex={0}
        aria-label={`Generation tree of ${subject.name}. Drag or arrows to move, plus and minus zoom, F fits all.`}
        style={{ "--th": `${t.height}px` } as CSSProperties}
        onKeyDown={stageKey}
        onClick={(e) => {
          // the empty stage closes the open card
          if (!(e.target as Element).closest("[role=button],button,a,.vt-open")) setOpen(null);
        }}
      >
        <div className="vt-world vt-in" ref={world}>
          <TreeSvg
            t={t}
            uid={uid}
            sel={sel}
            focus={focus}
            mode={mode}
            folds={count}
            onUnfold={toggleFold}
            name={subject.name}
            isKept={isKept}
            pruned={pruned}
            nodes={nodes.current}
            onSelect={pick}
            onKey={keys}
            onTip={(id) => {
              const z = Z.T.current;
              setTip(id);
              if (id != null && stage && z)
                setView({ x: z.x, y: z.y, k: z.k, w: stage.clientWidth, h: stage.clientHeight });
            }}
          />
          {openNode && !sheet && (
            <OpenCard
              at={{
                left:
                  side === "right"
                    ? t.pos(openNode).x + HW(openNode.v) + 18
                    : t.pos(openNode).x - HW(openNode.v) - 18 - CARD_W,
                top: t.pos(openNode).y - HH(openNode.v) - 8,
              }}
              ref={card}
              // at 1:1 the card fits the stage; it scrolls past that
              maxHeight={(stage?.clientHeight ?? 600) - 32}
              onClose={() => setOpen(null)}
            >
              {detail(openNode)}
            </OpenCard>
          )}
        </div>
        <div className="vt-railbox" ref={rail}>
          <Rail t={t} slug={subject.slug} />
        </div>
        <Tip t={t} id={tip === open ? null : tip} isKept={isKept} view={view} />
        {openNode && sheet && (
          <OpenCard ref={card} onClose={() => setOpen(null)}>
            {detail(openNode)}
          </OpenCard>
        )}
        <ZoomTools
          className="vt-tools"
          onIn={() => Z.scaleBy(1.25)}
          onOut={() => Z.scaleBy(0.8)}
          onFit={fitAll}
          onRest={() => rest(MOVE_MS)}
        />
      </section>
      <div className="vt-legend">
        {LEGEND.filter((c) => t.S.some((x) => x.v === c)).map((c) => (
          <span key={c}>
            <i className={`vt-dot ${c}`} />
            {c === "grew" ? "No call, a batch grew from it" : VERD[c]}
          </span>
        ))}
        {t.S.some(isKept) && (
          <span>
            <Pin />
            Kept
          </span>
        )}
        <span>
          <svg width="26" height="12" viewBox="0 0 26 12" aria-hidden="true">
            <path d="M1 3H25" stroke="var(--ui-ink-2)" strokeWidth="1.25" strokeLinecap="round" />
            <path d="M1 9H25" stroke="var(--ui-ink-2)" strokeWidth="4" strokeLinecap="round" />
          </svg>
          Thicker: more good samples came from it
        </span>
      </div>
      <p className="vt-cap">
        Read down from the brief. A branch that stops had no good sample. A faint snapshot with no
        line is a seed that went nowhere. Drag to move; pinch or ⌘-scroll to zoom. Point at a sample
        for its card; click it to open it there and light its path. Keys: arrows walk, Enter opens,
        Esc closes, F fits, + and − zoom, 0 goes back to 1:1.
      </p>
      {s && (
        <div className="vt-detail">
          <div className="vt-dl">
            <BatchDetail t={full} n={s.r} subject={subject.slug} />
          </div>
        </div>
      )}
    </div>
  );
}

/** past this height the card shows the newest rows; older ones fade out at the top */
const CARD_MAX_H = 280;
/** narrower, the tree scrolls sideways: its labels stay legible on a phone */
const CARD_MIN_W = 560;
const NO_FOLDS: ReadonlyMap<number, number> = new Map();

/**
 * The tree in the agent chat (WA-1262): the page's own model and drawing, fit to the card's width,
 * the newest rows at the foot. A node new since the last read, or with a new call, grows in; on
 * the first draw every row grows in turn. A tap opens the subject page.
 */
export function TreeCard({
  subject,
  batches,
  guides,
  pruned: prunedIds,
  onOpen,
}: Pick<TreeProps, "subject" | "batches" | "guides" | "pruned"> & {
  onOpen: (sample: number) => void;
}) {
  const t = useMemo(() => treeOf(batches, guides), [batches, guides]);
  const uid = useId().replace(/:/g, "");
  const nodes = useRef(new Map<number, SVGGElement>());
  const pruned = useMemo(() => new Set(prunedIds ?? []), [prunedIds]);
  const seen = useRef<Map<number, Call> | null>(null);
  // per read, not per render: a re-render must not cut a growth short
  const fresh = useMemo(() => {
    const was = seen.current;
    return new Set(t.S.filter((s) => !was || was.get(s.id) !== s.v).map((s) => s.id));
  }, [t]);
  useEffect(() => {
    seen.current = new Map(t.S.map((s) => [s.id, s.v]));
  }, [t]);
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    // a phone opens on the tree's middle, where its trunk is
    el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
    return () => ro.disconnect();
  }, []);
  const tall = w > 0 && (t.height * Math.max(w, CARD_MIN_W)) / (G.W - G.AX + 24) > CARD_MAX_H;
  const born = fresh.size === t.S.length;
  return (
    <div
      ref={box}
      className={`vt vt-card${tall ? " tall" : ""}${born ? " born" : ""}`}
      style={{ maxHeight: CARD_MAX_H, "--vt-min-w": `${CARD_MIN_W}px` } as CSSProperties}
    >
      <TreeSvg
        t={t}
        uid={uid}
        sel={null}
        focus={t.first ?? t.S[0]?.id ?? null}
        mode="all"
        folds={NO_FOLDS}
        onUnfold={() => {}}
        name={subject.name}
        isKept={(s) => s.kept}
        pruned={pruned}
        nodes={nodes.current}
        onSelect={onOpen}
        onKey={(ev, s) => {
          if (ev.key !== "Enter" && ev.key !== " ") return;
          ev.preventDefault();
          onOpen(s.id);
        }}
        onTip={() => {}}
        card
        fresh={fresh}
      />
    </div>
  );
}

function TreeSvg({
  t,
  uid,
  sel,
  focus,
  mode,
  folds,
  onUnfold,
  name,
  isKept,
  pruned,
  nodes,
  onSelect,
  onKey,
  onTip,
  card,
  fresh,
}: {
  t: Tree;
  uid: string;
  sel: number | null;
  focus: number | null;
  mode: "all" | "line";
  /** folded samples, by how many they hide */
  folds: ReadonlyMap<number, number>;
  onUnfold: (id: number) => void;
  name: string;
  isKept: (s: TNode) => boolean;
  pruned: ReadonlySet<number>;
  nodes: Map<number, SVGGElement>;
  onSelect: (id: number) => void;
  onKey: (ev: KeyboardEvent, s: TNode) => void;
  onTip: (id: number | null) => void;
  /** the chat's card: cropped to the tree (no rail), a node re-mounts when its call changes */
  card?: boolean | undefined;
  /** nodes that grow in: new, or a new call */
  fresh?: ReadonlySet<number> | undefined;
}) {
  const hot = mode === "line" ? t.goodLine() : sel != null ? t.line(sel) : new Set<number>();
  const path = new Set(sel != null ? t.pathUp(sel).map((x) => x.id) : []);
  const W = G.W;
  const openRow = t.rounds.find((r) => r.open);
  const edge = (p: TNode | null, c: TNode, cross: boolean) => {
    const live = t.strongUnder(c.id);
    const on = hot.has(c.id) && (p == null || hot.has(p.id));
    const a = t.pos(p);
    const b = t.pos(c);
    const ra = HH(p ? p.v : "root") + 3;
    const rb = HH(c.v) + 4;
    return (
      <path
        key={`${p?.id ?? 0}-${c.id}`}
        className={`vt-e${cross ? " x" : ""}${live ? " live" : ""}${on ? " on" : ""}`}
        strokeWidth={cross ? 1.5 : live ? 1.5 + 0.75 * Math.min(live, 4) : 1}
        d={drop(a.x, a.y + ra, b.x, b.y - rb, G.GEN - ra - rb)}
      />
    );
  };
  const root = t.pos(null);
  const x0 = card ? G.AX - 24 : 0;
  return (
    // biome-ignore lint/a11y/useSemanticElements: an svg tree of focusable nodes; no fieldset fits
    <svg
      role="group"
      aria-label={`Generation tree of ${name}`}
      viewBox={`${x0} 0 ${W - x0} ${t.height}`}
      width={W - x0}
      height={t.height}
    >
      {openRow && (
        <rect
          className="vt-band"
          x={G.AX - 14}
          y={t.rowY(openRow.n) - 30}
          width={W - G.AX + 14}
          height="60"
          rx="10"
        />
      )}
      {t.rounds.map((B) => (
        <path key={B.id} className="vt-guide" d={`M${G.AX - 8} ${t.rowY(B.n)}H${W}`} />
      ))}
      {t.S.flatMap((c) => {
        if (c.v === "open") return [];
        const pid = c.p[0];
        const p = pid != null ? (t.byId.get(pid) ?? null) : null;
        return [
          ...(t.loose(c) ? [] : [edge(p, c, false)]),
          ...c.p.slice(1).map((id) => edge(t.byId.get(id) ?? null, c, true)),
        ];
      })}
      {mode === "all" &&
        t.S.flatMap((c) => {
          // what changed, on the selected path only
          if (c.v === "open" || !path.has(c.id)) return [];
          // main edge: what it took, else the idea; a cross edge only when the agent said what it took
          const ends: [TNode | null, string | null | undefined][] = c.p.length
            ? c.p.map((id, i) => [t.byId.get(id) ?? null, c.took[id] ?? (i === 0 ? c.delta : null)])
            : [[null, "new seed"]];
          return ends.flatMap(([pn, label], i) => {
            if (!label || (i > 0 && !path.has(pn?.id ?? -1))) return [];
            const a = t.pos(pn);
            const b = t.pos(c);
            const right = b.x >= a.x;
            return [
              <text
                key={`el${c.id}-${pn?.id ?? 0}`}
                className="vt-el vt-halo"
                x={f1(b.x - (b.x - a.x) * 0.3 + (right ? 9 : -9))}
                y={f1(b.y - G.GEN * 0.42)}
                textAnchor={right ? "start" : "end"}
              >
                {label}
              </text>,
            ];
          });
        })}
      <g transform={`translate(${f1(root.x)} ${f1(root.y)})`}>
        <circle r="6" fill="var(--ui-ink)" />
        <text className="vt-gt vt-halo" x="12" y="4">
          Brief
        </text>
      </g>
      {t.S.map((s) => {
        const p = t.pos(s);
        const isSel = s.id === sel;
        const dim = mode === "line" && !hot.has(s.id);
        const what =
          s.v === "open"
            ? `${s.name}, batch ${s.r}, to mark`
            : `${s.name}, batch ${s.r}, ${VERD[s.v]}${pruned.has(s.id) ? ", pruned" : ""}`;
        return (
          // biome-ignore lint/a11y/useSemanticElements: an SVG node; <button> cannot live in SVG.
          <g
            key={card ? `${s.id}${s.v}` : s.id}
            ref={(el) => {
              if (el) nodes.set(s.id, el);
              else nodes.delete(s.id);
            }}
            className={`vt-n${dim ? " dim" : ""}${pruned.has(s.id) ? " pruned" : ""}${fresh?.has(s.id) ? " fresh" : ""}`}
            style={card ? ({ "--r": s.r } as CSSProperties) : undefined}
            tabIndex={s.id === focus ? 0 : -1}
            role="button"
            aria-pressed={isSel}
            aria-label={what}
            transform={`translate(${f1(p.x)} ${f1(p.y)})`}
            onClick={() => onSelect(s.id)}
            onKeyDown={(ev) => onKey(ev, s)}
            onPointerEnter={() => onTip(s.id)}
            onPointerLeave={() => onTip(null)}
            onFocus={() => onTip(s.id)}
            onBlur={() => onTip(null)}
          >
            <rect
              className="vt-hit"
              x={-Math.max(HW(s.v) + 6, 22)}
              y={-Math.max(HH(s.v) + 6, 22)}
              width={Math.max(2 * HW(s.v) + 12, 44)}
              height={Math.max(2 * HH(s.v) + 12, 44)}
              rx="10"
            />
            <Thumb s={s} sel={isSel} clip={`${uid}c${s.id}`} />
            {isKept(s) && (
              <g
                transform={`translate(${f1(-HW(s.v) - 3)} ${f1(-HH(s.v) - 15)})`}
                color="var(--ui-accent)"
              >
                <path d={PIN} fill="currentColor" transform="scale(0.917)" />
              </g>
            )}
          </g>
        );
      })}
      {/* a fold: what it hides, as "+N" under it; a click unfolds */}
      {[...folds].flatMap(([id, n]) => {
        const s = t.byId.get(id);
        if (!s) return [];
        const p = t.pos(s);
        const w = 18 + String(n).length * 7.5;
        // under its name when the name hangs below (a fold has no kids drawn)
        const named = strong(s) || s.id === sel || (mode === "all" && path.has(s.id));
        const pad = s.id === sel ? 5 : s.v === "amazing" ? 4 : 0;
        const below = named ? pad + 14 + (nameLines(s.name).length - 1) * 13 + 20 : 18;
        return [
          // biome-ignore lint/a11y/useSemanticElements: an SVG node; <button> cannot live in SVG.
          <g
            key={`f${id}`}
            className="vt-more"
            role="button"
            tabIndex={0}
            aria-label={`Unfold ${n} that grew from ${s.name}`}
            transform={`translate(${f1(p.x)} ${f1(p.y + HH(s.v) + below)})`}
            onClick={() => onUnfold(id)}
            onKeyDown={(ev) => {
              if (ev.key !== "Enter" && ev.key !== " ") return;
              ev.preventDefault();
              onUnfold(id);
            }}
          >
            <rect x={-w / 2} y="-11" width={w} height="22" rx="11" />
            <text y="4.5" textAnchor="middle">
              +{n}
            </text>
          </g>,
        ];
      })}
      {/* names over every snapshot: a sibling never covers one */}
      {/* biome-ignore lint/a11y/noAriaHiddenOnFocusable: plain g, no tabindex; names repeat each node's aria-label */}
      <g className="vt-names" aria-hidden="true">
        {t.S.map((s) => {
          const isSel = s.id === sel;
          if (s.v === "open" || !(strong(s) || isSel || (mode === "all" && path.has(s.id))))
            return null;
          const p = t.pos(s);
          const dim = mode === "line" && !hot.has(s.id);
          return (
            <g
              key={s.id}
              className={dim ? "dim" : undefined}
              transform={`translate(${f1(p.x)} ${f1(p.y)})`}
            >
              <Name t={t} s={s} sel={isSel} />
            </g>
          );
        })}
      </g>
    </svg>
  );
}

const STROKE: Record<Exclude<Call, "open">, readonly [string, number]> = {
  amazing: ["var(--ui-accent)", 1.5],
  good: ["var(--ui-good)", 1.25],
  okay: ["var(--ui-ink-2)", 1],
  bad: ["var(--ui-bad)", 1],
  grew: ["var(--ui-ink-2)", 1.25],
  unmarked: ["var(--ui-ink-3)", 1],
};

/** the node: a snapshot; its size, border and badge say the call */
function Thumb({ s, sel, clip }: { s: TNode; sel: boolean; clip: string }) {
  const [w, h] = TH[s.v];
  const x = -w / 2;
  const y = -h / 2;
  const ring = sel ? (
    <rect
      x={x - 5}
      y={y - 5}
      width={w + 10}
      height={h + 10}
      rx="10"
      fill="none"
      stroke="var(--ui-accent)"
      strokeWidth="1.5"
    />
  ) : s.v === "amazing" ? (
    <rect x={x - 4} y={y - 4} width={w + 8} height={h + 8} rx="9" fill="var(--vt-tint)" />
  ) : null;
  if (s.v === "open")
    // to mark: its snapshot shows; name, idea and parents stay blind
    return (
      <>
        {ring}
        <g className="vt-th">
          <clipPath id={clip}>
            <rect x={x} y={y} width={w} height={h} rx="6" />
          </clipPath>
          <rect x={x} y={y} width={w} height={h} rx="6" fill="var(--ui-fill)" />
          {s.poster && (
            <image
              href={s.poster}
              x={x}
              y={y}
              width={w}
              height={h}
              preserveAspectRatio="xMidYMid slice"
              clipPath={`url(#${clip})`}
            />
          )}
          <rect
            x={x}
            y={y}
            width={w}
            height={h}
            rx="6"
            fill="none"
            stroke="var(--ui-needs)"
            strokeWidth="1.25"
            strokeDasharray="3 2.5"
          />
          <circle className="vt-ob" cx={x + 1} cy={y + 1} r="7" />
          <text className="vt-ol" x={x + 1} y={y + 4.5} textAnchor="middle">
            {s.letter}
          </text>
        </g>
      </>
    );
  const [stroke, sw] = STROKE[s.v];
  const bx = w / 2 - 1;
  const by = -h / 2 + 1;
  return (
    <>
      {ring}
      <g className={`vt-th${s.v === "bad" ? " faint" : ""}`}>
        <clipPath id={clip}>
          <rect x={x} y={y} width={w} height={h} rx="6" />
        </clipPath>
        <rect x={x} y={y} width={w} height={h} rx="6" fill="var(--ui-fill)" />
        {s.poster ? (
          <image
            href={s.poster}
            x={x}
            y={y}
            width={w}
            height={h}
            preserveAspectRatio="xMidYMid slice"
            clipPath={`url(#${clip})`}
          />
        ) : (
          <text className="vt-lt" textAnchor="middle" y="3.5">
            Aa
          </text>
        )}
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          rx="6"
          fill="none"
          stroke={stroke}
          strokeWidth={sw}
        />
        {s.v === "amazing" && (
          <g transform={`translate(${bx} ${by})`}>
            <circle r="6.5" fill="var(--ui-accent)" stroke="var(--ui-paper)" strokeWidth="1.25" />
            <path
              d="M0-4.2l1.2 2.6 2.8.3-2.1 1.9.6 2.8L0 2-2.5 3.4l.6-2.8-2.1-1.9 2.8-.3z"
              fill="var(--ui-on-accent)"
            />
          </g>
        )}
        {s.v === "good" && (
          <g transform={`translate(${bx} ${by})`}>
            <circle r="6" fill="var(--ui-good)" stroke="var(--ui-paper)" strokeWidth="1.25" />
            <path
              d="M-2.6 0-.8 1.9 2.8-1.9"
              fill="none"
              stroke="#fff"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        )}
        {s.v === "bad" && (
          <g transform={`translate(${bx} ${by})`}>
            <circle r="5" fill="var(--ui-paper)" stroke="var(--ui-bad)" strokeWidth="1" />
            <path
              d="M-1.6-1.6 1.6 1.6M1.6-1.6-1.6 1.6"
              stroke="var(--ui-bad)"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </g>
        )}
      </g>
    </>
  );
}

/** strong samples and the selected one carry a name: right of a parent, under a leaf */
function Name({ t, s, sel }: { t: Tree; s: TNode; sel: boolean }) {
  const pad = sel ? 5 : s.v === "amazing" ? 4 : 0;
  const cls = `vt-nl vt-halo${strong(s) ? " k" : ""}`;
  const ls = nameLines(s.name);
  if (t.tkids(s.id).length) {
    // edges leave from below: name to the right, or left, or under when neither side has room
    const me = t.pos(s);
    const xs = t.S.filter((o) => o.r === s.r && o.id !== s.id && o.v !== "open").map((o) => ({
      x: t.pos(o).x,
      hw: HW(o.v),
    }));
    const need = HW(s.v) + pad + 10 + Math.max(...ls.map((l) => l.length)) * 6.6;
    const free = (dir: 1 | -1) =>
      Math.min(
        dir > 0 ? G.W - me.x : me.x - G.AX,
        ...xs.filter((o) => (o.x - me.x) * dir > 0).map((o) => Math.abs(o.x - me.x) - o.hw),
      );
    const side = free(1) >= need ? 1 : free(-1) >= need ? -1 : 0;
    const x = side * (HW(s.v) + pad + 6);
    const y = side ? 4 - ((ls.length - 1) * 13) / 2 : HH(s.v) + pad + 14;
    return (
      <text className={cls} y={y} textAnchor={side < 0 ? "end" : "start"}>
        {ls.map((l, i) => (
          <tspan key={l} x={side ? x : 7} dy={i ? 13 : 0}>
            {l}
          </tspan>
        ))}
      </text>
    );
  }
  return (
    <text className={cls} textAnchor="middle" y={HH(s.v) + pad + 14}>
      {ls.map((l, i) => (
        <tspan key={l} x="0" dy={i ? 13 : 0}>
          {l}
        </tspan>
      ))}
    </text>
  );
}
