/**
 * The Map (designs/2026-10-19-business-map.md, "Map page"): the shape of the workspace drawn as a
 * metro map by `MetroMap`, edge to edge, in the app's own theme. The server stores the metro body
 * and draws it from there; this page only reads (`viewOf` turns the body and the window's numbers
 * into what the renderer draws). A pick on a station or track opens its panel, kept in the address
 * (`?node=`, `?track=`, `?line=`). History, a draft (`?draft=<id>`) and an import preview draw the
 * difference on the same map with marks. The page changes nothing about the shape itself; saves go
 * through History (Restore, Undo), the draft banner (Apply, Drop) and Import. The zoom level, the
 * folds and the open panel stay in this browser for each workspace (`kept.ts`).
 */

import type { BlameLine, ShapeRef } from "@wren/pipeline/history";
import { Button, canAt, Icon, LoadFailed, SELECT_CLASS, Segmented } from "@wren/ui";
import { Popover, PopoverContent, PopoverTrigger } from "@wren/ui/components/ui/popover";
import {
  LEVEL_NAMES,
  MetroLevels,
  MetroMap,
  type MetroPick,
  MetroSkeleton,
  type MetroView,
  type OpenMap,
} from "@wren/ui/metro";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { call } from "../api.js";
import { type PageProps, WREN } from "../module.js";
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
import { type MapData, WINDOWS, type Window, windowOf } from "./model.js";
import { holds, NodePanel } from "./NodePanel.js";
import { messageOf, Refused } from "./Refused.js";
import { useDiffOf, useDraftDetail, useMap } from "./read.js";
import { type PanelRef, panelOfParams, panelParams } from "./routes.js";
import { viewOf } from "./view.js";

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
function useKeptView(client: string): [Kept, (part: Kept) => void] {
  const [state, setState] = useState(() => ({ client, kept: recallView(client) }));
  if (state.client !== client) setState({ client, kept: recallView(client) });
  const update = useCallback(
    (part: Kept) => {
      keepView(client, part);
      setState((s) => ({ client: s.client, kept: { ...s.kept, ...part } }));
    },
    [client],
  );
  return [state.kept, update];
}

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
  const wren = props.client === WREN.id;
  const client = wren ? null : props.client;
  const at = atOf(props.client);
  const read = useMap(props.client, window);
  const data: MapData | null = read.data?.map ?? null;
  // The same check the server's guard makes for a shape write: it works the Journeys app.
  const mayEdit =
    !!props.team &&
    !props.demo &&
    canAt(
      {
        team: props.team,
        demo: props.demo,
        ...(props.can ? { can: props.can } : {}),
        ...(props.who ? { who: props.who } : {}),
      },
      "act",
      { client: props.client, app: "deals" },
    );
  const newest = newestOf(data?.versions ?? []);

  // The panel is in the address: `?node=`, `?track=` or `?line=`.
  const panel = panelOfParams(props.params);
  const open = (p: PanelRef | null) => navigate(href("/", panelParams(p), props.params), true);
  const [kept, keepNow] = useKeptView(props.client);
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
    // A fold opens or closes by itself in the map; only a station or track has a panel.
    if (p.kind === "group") return;
    setHistory(false);
    open({ kind: p.kind, id: p.id });
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

  const setLevel = (level: number) => keepNow({ level });
  const setOpen = (o: OpenMap) => keepNow({ open: o });
  const waiting = !!draftId && !row && !opened.error;

  return (
    <section aria-label="Map" className="flex min-w-0 flex-none flex-col text-(--ui-ink)">
      {/* The artifact's `.atop`: the title and how many people are on the map, the tools at the right. */}
      <header className="flex flex-wrap items-end justify-between gap-2.5 px-[clamp(12px,2.5vw,24px)] pt-[18px] pb-3.5">
        <div className="mr-auto min-w-0">
          <h1 className="text-[22px]/7 font-semibold tracking-[-0.02em]">Your business</h1>
          <p className="text-[13.5px] text-(--ui-ink-2)">
            {data
              ? `${data.people.length} ${data.people.length === 1 ? "person" : "people"} on the map now. Pinch or switch to zoom.`
              : "The map of your business."}
          </p>
        </div>
        {/* The artifact's bar holds the zoom switch only; the other tools sit behind ⋯. */}
        <div className="flex items-center gap-2">
          <Popover open={tools} onOpenChange={setTools}>
            <PopoverTrigger
              aria-label="Map tools"
              className="inline-flex size-8 items-center justify-center text-(--ui-ink-2) hover:bg-(--ui-hover) hover:text-(--ui-ink)"
            >
              <Icon name="more" size={16} />
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 gap-2 bg-(--ui-paper) p-2 text-(--ui-ink)">
              <Segmented
                label="Window"
                className="max-w-full"
                items={WINDOWS.map((w) => ({
                  id: w.id,
                  label: w.label,
                  href: href("/", { window: w.id === "30" ? null : w.id }, props.params),
                  on: w.id === window,
                }))}
              />
              <select
                aria-label="Client"
                className={SELECT_CLASS}
                value={props.client}
                onChange={(e) =>
                  go("/", { client: e.target.value === WREN.id ? null : e.target.value }, props.params)
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
                  aria-pressed={history}
                  onClick={() => {
                    setTools(false);
                    if (history) closeHistory();
                    else setHistory(true);
                    setPicked([]);
                  }}
                >
                  <Icon name="clock" size={15} /> History
                </Button>
              ) : null}
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
          {shown?.view ? (
            <MetroLevels
              names={LEVEL_NAMES}
              level={Object.keys(kept.open ?? {}).length ? null : (kept.level ?? 1)}
              onLevel={(n) => keepNow({ level: n, open: {} })}
            />
          ) : null}
        </div>
      </header>
      {notice ? (
        <div className="px-[clamp(12px,2.5vw,24px)] pb-2">
          <Refused text={notice} />
        </div>
      ) : null}
      {data?.ghosts.length ? (
        // One quiet line, the count bar's type: the artifact draws no box over the map.
        <p className="flex flex-wrap items-center gap-x-1 px-[clamp(12px,2.5vw,24px)] pb-2 text-[13px] text-(--ui-ink-2)">
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
        <div className="px-[clamp(12px,2.5vw,24px)] pb-2">
          <LoadFailed error={opened.error} onRetry={opened.retry} what="draft" />
        </div>
      ) : null}
      <div className="relative min-h-[420px] flex-none max-[900px]:min-h-[380px]">
        {read.error && !read.data ? (
          <div className="p-5">
            <LoadFailed error={read.error} onRetry={read.retry} what="map" />
          </div>
        ) : !read.data || waiting ? (
          <MetroSkeleton />
        ) : !data ? (
          <NoShape mayStart={mayEdit} at={at} onStarted={read.retry} />
        ) : (
          <>
            {shown?.view ? (
              <div className="flex flex-col">
                <MetroMap
                  view={shown.view}
                  lit={lit ?? null}
                  level={kept.level ?? 1}
                  onLevel={setLevel}
                  open={kept.open}
                  onOpen={setOpen}
                  controls={false}
                  onPick={onPick}
                  selected={panel && panel.kind !== "line" ? panel.id : null}
                  intro={false}
                  className="metro-fit [&_.metro-opened]:px-[clamp(12px,2.5vw,24px)]"
                />
              </div>
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
