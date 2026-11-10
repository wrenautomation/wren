/**
 * The Map (designs/2026-10-19-business-map.md, "Map page"): the shape of the workspace drawn as a
 * metro map by `MetroMap`, edge to edge, in the app's own theme. The server stores the metro body
 * and draws it from there; this page only reads (`viewOf` turns the body and the window's numbers
 * into what the renderer draws). A pick on a station or track opens its panel, kept in the address
 * (`?node=`, `?track=`, `?line=`). History, a draft (`?draft=<id>`) and an import preview draw the
 * difference on the same map with marks. The page changes nothing about the shape itself; saves go
 * through History (Restore, Undo), the draft banner (Apply, Drop) and Import. The fold depth, the
 * folds and the open panel stay in this browser for each workspace (`kept.ts`).
 */

import type { BlameLine, ShapeRef } from "@wren/pipeline/history";
import { Button, cx, Icon, LoadFailed, SELECT_CLASS, Segmented, usePhone, usePref } from "@wren/ui";
import { Popover, PopoverContent, PopoverTrigger } from "@wren/ui/components/ui/popover";
import {
  type Fold,
  type LayerFloor,
  type LayerPart,
  type LayerSplit,
  MetroDepth,
  MetroLayers,
  MetroMap,
  type MetroPick,
  MetroSkeleton,
  type MetroView,
  preloadMetro,
  viewTree,
  viewZoom,
} from "@wren/ui/metro";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { call } from "../api.js";
import { type PageProps, WREN } from "../module.js";
import { useChatToolsDone, usePageContext } from "../modules/agent/drive.js";
import { atOf } from "../modules/deals/board.js";
import { go, href, navigate } from "../route.js";
import { DraftBanner } from "./DraftBanner.js";
import type { Compare } from "./DraftList.js";
import {
  blamePick,
  draftIdOf,
  draftRef,
  type HistoryTab,
  historyOf,
  newestOf,
  pairOf,
} from "./drafts.js";
import { fileNameOf, saveText } from "./file.js";
import { History } from "./History.js";
import { ImportPanel, useImportPreview } from "./Import.js";
import { type Kept, keepView, recallView } from "./kept.js";
import { type MapData, mayEditShape, WINDOWS, type Window, windowOf } from "./model.js";
import { holds, NodePanel } from "./NodePanel.js";
import { messageOf, Refused } from "./Refused.js";
import { useDiffOf, useDraftDetail, useMap } from "./read.js";
import { type PanelRef, panelOfParams, panelParams } from "./routes.js";
import { viewOf } from "./view.js";
import {
  foldsOf,
  isViewOf,
  MAP_HOME,
  mapKeepOf,
  mapParamsOf,
  useMapViews,
  ViewsMenu,
} from "./views.js";

/** A workspace with no shape: what a shape is, and the start from Wren's own. */
function NoShape({
  mayStart,
  at,
  onStarted,
}: {
  mayStart: boolean;
  at: Record<string, string>;
  onStarted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const start = async () => {
    setBusy(true);
    setRefused(null);
    try {
      await call("pipeline/shapeStart", at);
      onStarted();
    } catch (err) {
      setRefused(messageOf(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex max-w-xl flex-col items-start gap-4 p-8 text-[14.5px] text-(--ui-ink-2)">
      <p>No shape yet. A shape is the road from first contact to money.</p>
      <ul aria-label="Parts of a shape" className="flex list-none flex-wrap gap-2">
        {["Source", "Step", "Wait", "Offer"].map((k) => (
          <li
            key={k}
            aria-disabled="true"
            className="rounded-md border border-dashed border-(--ui-hair) px-3 py-1.5 text-(--ui-ink-3)"
          >
            {k}
          </li>
        ))}
      </ul>
      <Button
        tone="primary"
        size="sm"
        disabled={!mayStart}
        busy={busy}
        onClick={() => void start()}
      >
        Start from Wren's shape
      </Button>
      {mayStart ? null : (
        <p className="text-[13px] text-(--ui-ink-3)">You need edit access to start a shape.</p>
      )}
      {refused ? <Refused text={refused} /> : null}
    </div>
  );
}

/** What the map area says when the stored body cannot be drawn: the server's reasons, one each. */
function CannotDraw({ errors }: { errors: readonly string[] }) {
  return (
    <div className="flex max-w-xl flex-col gap-2 p-8 text-[14.5px] text-(--ui-ink-2)">
      <p>This shape cannot be drawn on the map.</p>
      {errors.length ? (
        <ul aria-label="Why" className="list-none space-y-0.5 text-[13.5px] text-(--ui-ink-3)">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * What this viewer kept of the Map in this browser, for one workspace. A change is kept at once;
 * a new workspace reads its own.
 */
function useKeptView(client: string): [Kept, (part: Kept, fresh?: boolean) => void] {
  const [state, setState] = useState(() => ({ client, kept: recallView(client) }));
  if (state.client !== client) setState({ client, kept: recallView(client) });
  const update = useCallback(
    (part: Kept, fresh = false) => {
      keepView(client, part, fresh);
      setState((s) => ({ client: s.client, kept: recallView(s.client) }));
    },
    [client],
  );
  return [state.kept, update];
}

/** `node:<id>` or `line:<id>`: the part Layers stands on (`floor=`). */
function partOf(v: string | null): LayerPart | null {
  const m = v?.match(/^(node|line):(.+)$/);
  return m ? { kind: m[1] as "node" | "line", id: m[2] as string } : null;
}
/** The URL params a Map layout hangs on: one ghost per set. */
const GHOST_KEYS = ["sv", "draft", "history", "look", "floor", "split", "shut", "lift"] as const;
const partParam = (p: LayerPart | null) => (p ? `${p.kind}:${p.id}` : null);

export function MapPage({
  props,
  clients,
  lit,
}: {
  props: PageProps;
  /** The workspaces the viewer may switch between, besides Wren's. */
  clients: readonly { id: string; name: string }[];
  /** The line key Today lights on hover (`lineKeyOf`). */
  lit?: string | null;
}) {
  const window = windowOf(props.params.get("window"));
  // What the layout hangs on: the skeleton draws this page's last one (packages/ui metro/ghost.ts).
  const ghostKey = `map?${GHOST_KEYS.map((k) => props.params.get(k) ?? "").join("&")}`;
  const wren = props.client === WREN.id;
  const client = wren ? null : props.client;
  const at = atOf(props.client);
  const read = useMap(props.client, window);
  // The layout engine is its own chunk: fetch it beside the read, not after it.
  useEffect(() => void preloadMetro(), []);
  const data: MapData | null = read.data?.map ?? null;
  const mayEdit = mayEditShape(props);
  const keep = mapKeepOf(props);
  const views = useMapViews(keep);
  const homeView = usePref<number>(keep, MAP_HOME);
  const newest = newestOf(data?.versions ?? []);

  // The panel is in the address: `?node=`, `?track=` or `?line=`.
  const panel = panelOfParams(props.params);
  const open = (p: PanelRef | null) => navigate(href("/", panelParams(p), props.params), true);
  const [kept, keepNow] = useKeptView(props.client);
  // A view's folds come in the address once: they go to the kept store, then leave the address.
  const folds = foldsOf(props.params);
  // biome-ignore lint/correctness/useExhaustiveDependencies: run when the address names folds
  useEffect(() => {
    if (!folds) return;
    keepNow(folds, true);
    navigate(href("/", { depth: null, open: null, close: null }, props.params), true);
  }, [props.params]);
  const svId = Number(props.params.get("sv")) || null;
  const saved = svId === null ? null : (views.lines.find((v) => v.id === svId) ?? null);
  const here = mapParamsOf(props.params, folds ?? kept);
  const current = saved && isViewOf(saved, here) ? saved : null;
  const restored = useRef<string | null>(null);
  // Run on the panel's identity and the data, not on the objects that change each render.
  // biome-ignore lint/correctness/useExhaustiveDependencies: open, keepNow and panel are new each render
  useEffect(() => {
    if (!data) return;
    // A viewer who left with a panel open finds it open again; an address that names one wins.
    if (restored.current !== props.client) {
      restored.current = props.client;
      const was = recallView(props.client).panel;
      if (!panel && was && holds(data, was)) {
        open(was);
        return;
      }
    }
    keepNow({ panel });
  }, [data, panel?.kind, panel?.id, props.client]);

  const [history, setHistory] = useState(false);
  const [tab, setTab] = useState<HistoryTab>("versions");
  const [picked, setPicked] = useState<number[]>([]);
  const [compare, setCompare] = useState<Compare | null>(null);
  const [file, setFile] = useState<{ name: string; text: string; stamp: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tools, setTools] = useState(false);

  // A draft opened with `?draft=<id>`: its row and metro, and what it changes against its base.
  const draftId = draftIdOf(props.params.get("draft"));
  const opened = useDraftDetail(at, draftId);
  const row = opened.data?.row ?? null;
  const against = useDiffOf(at, row ? row.base : null, row ? draftRef(row.id) : null);
  // Orrery's chat writes to the draft: each finished step of the chat reads the draft again
  const steps = useChatToolsDone();
  const seen = useRef(steps);
  // biome-ignore lint/correctness/useExhaustiveDependencies: run when the chat finishes a step
  useEffect(() => {
    if (seen.current === steps) return;
    seen.current = steps;
    if (!draftId) return;
    opened.retry();
    against.retry();
  }, [steps]);
  usePageContext(
    [
      client ? `client ${client}` : "Wren's own shape",
      row
        ? `open draft ${row.id} (${row.state}, on v${row.base})`
        : `the live shape${newest ? ` v${newest}` : ""}, no draft open`,
      panel ? `selected ${panel.kind} ${panel.id}` : null,
    ]
      .filter(Boolean)
      .join("; "),
  );

  // The two sides History draws: the Versions tab's picked pair, or the Drafts tab's compared draft.
  const pair = pairOf(picked);
  const sides: [ShapeRef, ShapeRef] | null = !history
    ? null
    : tab === "drafts"
      ? compare && [compare.a, compare.b]
      : pair;
  const diff = useDiffOf(at, sides?.[0] ?? null, sides?.[1] ?? null);
  const preview = useImportPreview(at, file?.text ?? null, file?.stamp ?? 0);

  // `?history=drafts` (Today's line) opens History on that tab.
  const historyParam = historyOf(props.params.get("history"));
  useEffect(() => {
    if (!historyParam) return;
    setHistory(true);
    setTab(historyParam);
    setPicked([]);
    setCompare(null);
  }, [historyParam]);

  // The time late marks count from: one moment for each read, so a redraw does not move it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `data` is the read this moment belongs to
  const now = useMemo(() => new Date(), [data]);

  // What the map area shows: the shape with its marks, or why it cannot be drawn. null: waiting.
  const shown = useMemo<{ view: MetroView | null; errors: readonly string[] } | null>(() => {
    if (!data) return null;
    const live = data.metro ? viewOf(data.metro, data, data.people, now) : null;
    const plain = { view: live, errors: data.drawErrors };
    if (sides) {
      const d = diff.data;
      if (!d) return plain;
      // No views (a side the server cannot draw): the list only, no marks.
      return d.views
        ? { view: viewOf(d.views[1], data, data.people, now, d.marks, d.views[0]), errors: [] }
        : plain;
    }
    if (file) {
      const d = preview.data;
      if (!d?.views) return plain;
      return { view: viewOf(d.views[1], data, data.people, now, d.marks, d.views[0]), errors: [] };
    }
    if (draftId) {
      const d = opened.data?.detail;
      // A draft that does not open leaves the live shape on screen.
      if (!d) return opened.error ? plain : null;
      if (!d.metro) return { view: null, errors: d.drawErrors };
      const a = against.data;
      return {
        view: viewOf(d.metro, data, data.people, now, a?.marks, a?.views?.[0]),
        errors: [],
      };
    }
    return plain;
  }, [
    data,
    now,
    sides,
    diff.data,
    file,
    preview.data,
    draftId,
    opened.data,
    opened.error,
    against.data,
  ]);

  const pick = (n: number) =>
    setPicked((p) => (p.includes(n) ? p.filter((x) => x !== n) : [...p.slice(-1), n]));
  const onPick = (p: MetroPick) => {
    // A fold opens or closes by itself in the map; of the groups, only a campaign has a panel.
    const id = p.kind === "group" ? (p.group ?? p.id) : p.id;
    if (p.kind === "group" && !data?.metro?.groups.some((g) => g.id === id && g.campaign)) return;
    setHistory(false);
    open({ kind: p.kind === "group" ? "campaign" : p.kind, id });
  };
  const closeHistory = () => {
    setHistory(false);
    setPicked([]);
    setCompare(null);
    if (props.params.get("history")) go("/", { history: null }, props.params);
  };
  const openDraft = (id: string) => {
    closeHistory();
    go("/", { draft: id, history: null }, props.params);
  };
  // A line of a part's history: History opens on that version beside its parent.
  const openVersion = (l: BlameLine) => {
    setTab("versions");
    setCompare(null);
    setPicked(blamePick(l, data?.versions ?? []));
    setHistory(true);
  };

  // The shape the page shows, by its ref: a draft, the version a compare ends on, or the newest.
  const refShown: ShapeRef | null = draftId
    ? draftRef(draftId)
    : (sides?.[1] ?? (newest > 0 ? newest : null));
  const exportShape = async () => {
    if (!data) return;
    setNotice(null);
    try {
      const sent = await call<{ text: string }>("pipeline/shapeExport", {
        ...at,
        ...(refShown !== null ? { ref: refShown } : {}),
      });
      saveText(
        fileNameOf(shown?.view?.title ?? data.metro?.name ?? data.body.name),
        "text/yaml",
        sent.text,
      );
    } catch (err) {
      setNotice(messageOf(err));
    }
  };
  const importFile = async (f: File | undefined) => {
    if (!f) return;
    setNotice(null);
    try {
      setFile({ name: f.name, text: await f.text(), stamp: Date.now() });
      setHistory(false);
    } catch (err) {
      setNotice(messageOf(err));
    }
  };
  const picker = useRef<HTMLInputElement>(null);

  const nodes = useMemo(() => (shown?.view ? viewTree(shown.view).nodes : []), [shown?.view]);
  const phone = usePhone();
  // a phone opens folded: the whole shape fits its width (WA-1144)
  const fold: Fold = useMemo(
    () => ({ depth: kept.depth ?? (phone ? 0 : 1), open: kept.open ?? {} }),
    [kept.depth, kept.open, phone],
  );
  // Layers is an experiment beside the flat map: one URL param, so a link keeps the look.
  const layers = props.params.get("look") === "layers";
  const floor: LayerFloor = partOf(props.params.get("floor"));
  const split: LayerSplit = props.params.get("split") === "lines" ? "lines" : "folds";
  const shutParts = (props.params.get("shut") ?? "").split(",").filter(Boolean);
  const liftParts = (props.params.get("lift") ?? "").split(",").filter(Boolean);
  const zoom = useMemo(() => (shown?.view ? viewZoom(shown.view) : null), [shown?.view]);
  const waiting = !!draftId && !row && !opened.error;
  // Layers has its own −/+ (by plate level); this one folds the flat map.
  const depth =
    shown?.view && !layers ? (
      <MetroDepth nodes={nodes} fold={fold} onFold={(f) => keepNow(f)} />
    ) : null;

  return (
    // The map fills the first screen; Today scrolls under it.
    <section
      aria-label="Map"
      className="flex h-[calc(100dvh-20px)] min-h-[520px] min-w-0 flex-none flex-col text-(--ui-ink) [--gut:clamp(12px,2.5vw,24px)] max-[900px]:h-[calc(100dvh-var(--phone-bar,52px)-54px-env(safe-area-inset-bottom))]"
    >
      {/* The artifact's `.atop`: the title and how many people are on the map, the tools at the right. */}
      <header className="flex flex-wrap items-end justify-between gap-2.5 px-(--gut) pt-[18px] pb-3.5 max-[900px]:gap-y-3">
        <div className="mr-auto min-w-0">
          <h1 className="text-[22px]/7 font-semibold tracking-[-0.02em]">Your business</h1>
          <p className="text-[13.5px] text-(--ui-ink-2)">
            {data
              ? `${data.people.length} ${data.people.length === 1 ? "person" : "people"} on the map now.`
              : "The map of your business."}
          </p>
        </div>
        {depth && phone ? depth : null}
        {/* The bar: views, the look, the window, History and the depth. The rarer tools sit behind ⋯. */}
        {/* phone: one row that pans, to the screen edges */}
        {/* --in: the first chip's ink (not its box) on the title's edge */}
        <div
          className={cx(
            "flex flex-wrap items-center gap-2 max-[900px]:mx-[calc(var(--gut)*-1)] max-[900px]:w-[calc(100%+2*var(--gut))] max-[900px]:flex-nowrap max-[900px]:overflow-x-auto max-[900px]:pr-(--gut) max-[900px]:pl-(--in) max-[900px]:[scrollbar-width:none] max-[900px]:[mask-image:linear-gradient(to_right,transparent,#000_var(--in),#000_calc(100%-var(--gut)),transparent)] max-[900px]:[&>*]:shrink-0",
            keep && shown?.view ? "[--in:calc(var(--gut)-9px)]" : "[--in:var(--gut)]",
          )}
        >
          {keep && shown?.view ? (
            <ViewsMenu
              views={views}
              home={homeView}
              current={current}
              save={current ? null : { params: here, from: saved }}
              params={props.params}
              keep={keep}
            />
          ) : null}
          {shown?.view ? (
            <Segmented
              label="Look"
              items={[
                { id: "flat", label: "Flat", look: null },
                { id: "layers", label: "Layers", look: "layers" },
              ].map((l) => ({
                id: l.id,
                label: l.label,
                href: href("/", { look: l.look, floor: null }, props.params),
                on: (l.look === "layers") === layers,
              }))}
            />
          ) : null}
          <Segmented
            label="Window"
            items={WINDOWS.map((w) => ({
              id: w.id,
              label: w.label,
              href: href("/", { window: w.id === "30" ? null : w.id }, props.params),
              on: w.id === window,
            }))}
          />
          {data ? (
            <Button
              tone="quiet"
              size="dense"
              icon="clock"
              className="shrink-0"
              aria-pressed={history}
              onClick={() => {
                if (history) closeHistory();
                else setHistory(true);
                setPicked([]);
              }}
            >
              History
            </Button>
          ) : null}
          <Popover open={tools} onOpenChange={setTools}>
            <PopoverTrigger
              aria-label="Map tools"
              className="inline-flex size-8 items-center justify-center text-(--ui-ink-2) hover:bg-(--ui-hover) hover:text-(--ui-ink)"
            >
              <Icon name="more" size={16} />
            </PopoverTrigger>
            <PopoverContent
              align="end"
              aria-label="Map tools"
              className="w-64 gap-2 bg-(--ui-paper) p-2 text-(--ui-ink)"
            >
              <select
                aria-label="Client"
                className={SELECT_CLASS}
                value={props.client}
                onChange={(e) =>
                  go(
                    "/",
                    { client: e.target.value === WREN.id ? null : e.target.value },
                    props.params,
                  )
                }
              >
                <option value={WREN.id}>Wren</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              {data ? (
                <Button
                  tone="quiet"
                  size="dense"
                  onClick={() => {
                    setTools(false);
                    void exportShape();
                  }}
                >
                  <Icon name="download" size={15} /> Export
                </Button>
              ) : null}
              {mayEdit ? (
                <Button
                  tone="quiet"
                  size="dense"
                  onClick={() => {
                    setTools(false);
                    picker.current?.click();
                  }}
                >
                  <Icon name="upload" size={15} /> Import
                </Button>
              ) : null}
            </PopoverContent>
          </Popover>
          {mayEdit ? (
            <input
              ref={picker}
              type="file"
              accept=".yaml,.yml,text/yaml"
              aria-label="Shape file"
              className="hidden"
              onChange={(e) => {
                void importFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          ) : null}
          {depth && !phone ? depth : null}
        </div>
      </header>
      {notice ? (
        <div className="px-(--gut) pb-2">
          <Refused text={notice} />
        </div>
      ) : null}
      {data?.ghosts.length ? (
        // One quiet line, the count bar's type: the artifact draws no box over the map.
        <p className="flex flex-wrap items-center gap-x-1 px-(--gut) pb-2 text-[13px] text-(--ui-ink-2)">
          <span className="mr-1 size-2 rounded-full bg-(--ui-warn)" aria-hidden="true" />
          <span>The newest version dropped a part that people are still on:</span>
          {data.ghosts.map((g) => (
            <Button
              key={g.id}
              tone="quiet"
              size="dense"
              aria-label={`Open ${g.name}`}
              onClick={() => open({ kind: "station", id: g.id })}
            >
              {g.name} ({g.people.length})
            </Button>
          ))}
        </p>
      ) : null}
      {draftId && opened.error && !opened.data ? (
        <div className="px-(--gut) pb-2">
          <LoadFailed error={opened.error} onRetry={opened.retry} what="draft" />
        </div>
      ) : null}
      <div className="relative min-h-0 flex-1">
        {read.error && !read.data ? (
          <div className="p-5">
            <LoadFailed error={read.error} onRetry={read.retry} what="map" />
          </div>
        ) : !read.data || waiting ? (
          <MetroSkeleton label="Reading your map" ghost={ghostKey} className="metro-fill" />
        ) : !data ? (
          <NoShape mayStart={mayEdit} at={at} onStarted={read.retry} />
        ) : (
          <>
            {shown?.view && layers && zoom ? (
              <MetroLayers
                zoom={zoom}
                floor={floor}
                onFloor={(f) =>
                  navigate(
                    href("/", { floor: partParam(f), shut: null, lift: null }, props.params),
                    true,
                  )
                }
                split={split}
                shut={shutParts}
                onShut={(k) =>
                  navigate(href("/", { shut: k.length ? k.join(",") : null }, props.params), true)
                }
                lift={liftParts}
                onLift={(k) =>
                  navigate(href("/", { lift: k.length ? k.join(",") : null }, props.params), true)
                }
                ghost={ghostKey}
                onSplit={(s) =>
                  navigate(
                    href(
                      "/",
                      { split: s === "lines" ? s : null, shut: null, lift: null },
                      props.params,
                    ),
                    true,
                  )
                }
                className="h-full"
              />
            ) : shown?.view ? (
              <MetroMap
                view={shown.view}
                lit={lit ?? null}
                depth={fold.depth}
                onDepth={(depth) => keepNow({ depth })}
                open={fold.open}
                onOpen={(open) => keepNow({ open })}
                controls={false}
                onPick={onPick}
                selected={panel && panel.kind !== "line" ? panel.id : null}
                intro={false}
                bare
                className="metro-fill"
                ghost={ghostKey}
              />
            ) : shown ? (
              <CannotDraw errors={shown.errors} />
            ) : null}
            {history ? (
              <History
                versions={data.versions}
                picked={picked}
                onPick={pick}
                tab={tab}
                onTab={setTab}
                compare={compare}
                onCompare={setCompare}
                diff={diff}
                at={at}
                client={props.client}
                canEdit={mayEdit}
                onOpenDraft={openDraft}
                onSaved={read.retry}
                onClose={closeHistory}
              />
            ) : file ? (
              <ImportPanel
                at={at}
                name={file.name}
                text={file.text}
                preview={preview}
                onClose={() => setFile(null)}
                onSaved={() => {
                  setFile(null);
                  read.retry();
                }}
              />
            ) : panel && holds(data, panel) ? (
              <NodePanel
                part={panel}
                data={data}
                window={window as Window}
                place={wren ? "wren" : "client"}
                client={client}
                at={at}
                now={now}
                onOpen={open}
                onHistory={openVersion}
                onClose={() => open(null)}
                canEdit={mayEdit}
                onOpenDraft={openDraft}
              />
            ) : null}
            {draftId && row ? (
              <DraftBanner
                row={row}
                newest={newest}
                at={at}
                client={props.client}
                canEdit={mayEdit}
                onClose={() => go("/", { draft: null }, props.params)}
                onChanged={opened.retry}
              />
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
