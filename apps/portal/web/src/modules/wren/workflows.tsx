/**
 * Workflows: Wren's business drawn as its workflows. `wren` first; a stacked card opens what runs
 * inside it in place, with a trail back. Each number is the last 30 days of the record view its
 * port names, and a card with one opens those records. The team rewires one here: drag an output
 * onto an input, set a wire's condition or wait, add a custom step, save it for Wren or for the
 * client in `?client=`.
 */
import { DOOR_TRIGGERS } from "@wren/core/logic";
import type { RecordAnswer, RecordsPage, RecordsStat } from "@wren/core/records/serve";
import { isMade } from "@wren/core/workflows";
import {
  ACTIONS,
  Alert,
  BarsChart,
  Button,
  FormKept,
  Graph,
  type GraphDot,
  type GraphEdit,
  type GraphMark,
  Input,
  LoadFailed,
  Loading,
  PageHeader,
  type Place,
  RecordPanel,
  type RecordsApi,
  SaveConflict,
  Section,
  SelectField,
  say,
  statusWords,
  TextField,
  useEditForm,
  useSaved,
  useTypes,
} from "@wren/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { call } from "../../api.js";
import { readCall, useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { shown } from "../../pulse.js";
import { recordsApi } from "../../records-api.js";
import { href, navigate } from "../../route.js";
import { type CountRef, countKey, countsIn, type Drawn } from "../marketplace/boxes.js";
import { dayLabel, ERROR, FORM, NARROW, QUIET } from "../work/bits.js";
import {
  type Count,
  deeper,
  dotsOf,
  type EventRow,
  funnelOf,
  graphOf,
  openedBy,
  type PortRef,
  portKey,
  portsIn,
  trailIsFor,
  type Where,
} from "./canvas.js";
import { useCanvasEdit } from "./canvas-edit.js";
import { DoorStrip, type Fresh } from "./doors.js";
import { dryNodes } from "./dry.js";
import {
  AskGraph,
  EditBar,
  HistoryMenu,
  NodePanel,
  PaletteDrawer,
  Proposal,
  RetryPick,
  type SavedTemplate,
  type Version,
  WirePanel,
} from "./editor.js";
import { Executions } from "./executions.js";
import { WREN_APPS } from "./index.js";
import { MadeHere } from "./made.js";
import { usePlay } from "./playback.js";
import { TestPanel, TestStep } from "./tester.js";
import {
  addNode,
  allEnds,
  changesOf,
  type Draft,
  draftOf,
  drawnDiff,
  drawnWith,
  endsOf,
  endText,
  NO_PALETTE,
  type Palette,
  pairsOf,
  problemsOf,
  type Saved,
  stepOf,
  wired,
} from "./wiring.js";

const ROOT = "wren";
const DAYS = 30;
const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const PAGE = "/workflows/canvas";
/** How often the canvas asks the spine for new events, and the most dots in flight. */
const POLL_MS = 8000;
const MOST_DOTS = 24;

type Detail = {
  workflow?: Drawn;
  /** A part's: the workflow of steps it runs inside, drawn and edited like a workflow. */
  inside?: Drawn | null;
  saved?: Saved | null;
  broken?: string[];
  palette?: Palette;
  /** The team's: the draft kept on the server, each live version, and the code's own wires. */
  draft?: (Version & { problems: string[] }) | null;
  versions?: Version[];
  code?: Draft;
  forClients?: boolean;
  templates?: SavedTemplate[];
};
const EMPTY: Draft = { wires: [], steps: [] };
/** What the editor saves: the graph, and a made workflow's name. */
type Kept = { draft: Draft; name: string };

/** The first of Wren's lists over `c`'s record, on its view. */
const recordsAt = (c: CountRef) => {
  for (const m of WREN_APPS)
    for (const p of m.pages)
      if ("record" in p && p.record === c.record && p.template === "list")
        return `/${m.id}/${p.id}?view=${encodeURIComponent(c.view)}`;
  return undefined;
};

/** The record types the console serves here, from the data layer (read once a day); null when unread. */
const servedBy = (client: string | null): Promise<ReadonlySet<string> | null> =>
  readCall(
    `console-types:${client ?? ""}`,
    () =>
      call<{ id: string }[]>("console/recordsTypes", client ? { client } : {}).then((ts) =>
        ts.map((t) => t.id),
      ),
    24 * 3600_000,
  ).then(
    (ids) => new Set(ids),
    () => null,
  );

export function Workflows({ params, team, can }: PageProps) {
  const path = (params.get("path") ?? ROOT).split("/").filter(Boolean);
  const client = params.get("client") || null;
  const canvasAt = (p: readonly string[]) =>
    `/workflows/canvas?path=${p.join("/")}${client ? `&client=${encodeURIComponent(client)}` : ""}`;
  // One key per path: a save re-reads it (`retry`), so an older answer never repaints it.
  const trail = useCall(`workflows:${client ?? ""}:${path.join("/")}`, () =>
    Promise.all(
      path.map((id) =>
        call<RecordAnswer>("console/recordsGet", {
          record: "console.component",
          id,
          ...(client ? { client } : {}),
        }).then((a) => (a.detail ? { ...(a.detail as Detail), asked: id } : null)),
      ),
    ),
  );
  // The loader keeps the last path's answer while this one loads: never draw it as this path's.
  const current = trailIsFor(path, trail.data);
  const d = current ? (trail.data?.at(-1) ?? null) : null;
  const w = d?.workflow ?? d?.inside ?? null;
  // A workflow card with no number of its own shows its inside's: read those drawings too. A
  // part's inside isn't a record of its own: it is read through its part.
  const opens = w?.nodes.filter((n) => n.opens && !n.count).map(openedBy) ?? [];
  const inner = useCall(`workflow-inner:${client ?? ""}:${opens.join(",")}`, async () => {
    const got = await Promise.all(
      opens.map((id) =>
        call<RecordAnswer>("console/recordsGet", {
          record: "console.component",
          id,
          ...(client ? { client } : {}),
        }).then(
          (a) => {
            const got = a.detail as Detail | null;
            return got?.workflow ?? got?.inside ?? null;
          },
          () => null,
        ),
      ),
    );
    // Plain data, so the device copy keeps it (a Map reads back as `{}`).
    return got.filter((x) => x !== null);
  });
  const insides = useMemo(
    () => (inner.data ? new Map(inner.data.map((x) => [x.id, x])) : undefined),
    [inner.data],
  );
  const all = w ? [w, ...(insides?.values() ?? [])] : [];
  const refs = [...new Map(all.flatMap(countsIn).map((r) => [countKey(r), r])).values()];
  // The spine is Wren's own: a client's copy counts its views only.
  const ports = client ? [] : all.flatMap(portsIn);
  // A number that fails stays off its card; the drawing never waits on one.
  const counts = useCall(
    `workflow-counts:${refs.map(countKey).join(",")}:${ports.map(portKey).join(",")}`,
    async () => {
      const stat = (key: string, ask: Record<string, unknown>) =>
        call<RecordsStat>("console/recordsStats", { ...ask, period: DAYS, zone: ZONE }).then(
          (s): [string, Count] => [
            key,
            { value: s.value ?? 0, today: s.series.at(-1)?.value ?? 0 },
          ],
          () => null,
        );
      // Only what the console serves: a client product's record (an invoice) counts in its own
      // workspace, and asking the console for it is a 404.
      const served = await servedBy(client);
      const got = await Promise.all([
        ...refs
          .filter((r) => !served || served.has(r.record))
          .map((r) => stat(countKey(r), { ...r })),
        ...ports.map((p: PortRef) =>
          stat(portKey(p), { record: "console.event", view: "all", where: { ...p } }),
        ),
      ]);
      return got.filter((x) => x !== null);
    },
  );
  const countsBy = useMemo(() => (counts.data ? new Map(counts.data) : undefined), [counts.data]);
  if (trail.error && !trail.data) return <LoadFailed error={trail.error} onRetry={trail.retry} />;
  if (!trail.data || (!current && trail.loading)) return <Loading lines={6} />;
  if (!d || !w) return <Alert>No workflow called {path.at(-1)}.</Alert>;
  return (
    <>
      {path.length > 1 ? (
        <nav aria-label="Workflows open" className="mb-2 text-[13px] text-(--ui-ink-2)">
          {trail.data.slice(0, -1).map((t, i) => (
            <span key={path[i]}>
              <a href={canvasAt(path.slice(0, i + 1))} className="hover:text-(--ui-ink)">
                {(t?.workflow ?? t?.inside)?.name ?? path[i]}
              </a>
              {" / "}
            </span>
          ))}
        </nav>
      ) : null}
      <PageHeader
        title={w.name}
        lede={`${client ? `Wired for ${client}. ` : ""}Numbers are the last ${DAYS} days. A stacked card opens what runs inside it. Faded: in development.`}
      />
      {client ? null : <Panes params={params} />}
      {!client && params.get("pane") === "runs" ? (
        <Executions w={w} params={params} can={can} />
      ) : (
        <Canvas
          key={path.join("/")}
          w={w}
          d={d}
          counts={countsBy}
          inner={insides}
          where={{
            canvas: (n) => {
              const to = n.opens ? deeper(path, openedBy(n)) : null;
              return to ? canvasAt(to) : undefined;
            },
            rows: recordsAt,
          }}
          params={params}
          client={client}
          team={team}
          mayManage={!can || can.includes("manage")}
          onSaved={trail.retry}
        />
      )}
    </>
  );
}

/** The canvas, or what ran through it. */
function Panes({ params }: { params: URLSearchParams }) {
  const pane = params.get("pane") === "runs" ? "runs" : "canvas";
  const tabs = [
    { id: "canvas", label: "Canvas" },
    { id: "runs", label: "Executions" },
  ] as const;
  return (
    <div role="tablist" aria-label="Show" className="mb-4 flex gap-4 border-b border-(--ui-hair)">
      {tabs.map((t) => (
        <a
          key={t.id}
          role="tab"
          aria-selected={pane === t.id}
          href={href(
            PAGE,
            { pane: t.id === "canvas" ? null : t.id, run: null, runs: null },
            params,
          )}
          className={`-mb-px border-b-2 pb-2 text-[14px] no-underline ${
            pane === t.id
              ? "border-(--ui-ink) font-medium text-(--ui-ink)"
              : "border-transparent text-(--ui-ink-2) hover:text-(--ui-ink)"
          }`}
        >
          {t.label}
        </a>
      ))}
    </div>
  );
}

/** The console's records, for the part a click opens beside the canvas. */
const consoleApi = (client: string | null): RecordsApi =>
  recordsApi(`console:${client}:workflows`, (h, body) =>
    call(`console/${h}`, client ? { client, ...body } : { ...body }),
  );

/**
 * Real events as they land: the spine's newest rows, asked every few seconds while the page
 * shows. The first answer only marks where "new" starts; nothing old replays.
 */
function useEvents(w: Drawn, on: boolean): GraphDot[] {
  const [dots, setDots] = useState<GraphDot[]>([]);
  const since = useRef<string | null>(null);
  // read-ok: a live feed of dots; the first answer only marks where "new" starts, nothing to keep.
  useEffect(() => {
    if (!on) return;
    let live = true;
    const ask = async () => {
      if (document.hidden) return;
      const page = await call<RecordsPage>("console/recordsList", {
        record: "console.event",
        view: "all",
        limit: 25,
      }).catch(() => null);
      if (!live || !page) return;
      const rows = page.rows as unknown as EventRow[];
      const newest = rows[0]?.at ?? since.current;
      if (since.current !== null) {
        const fresh = rows.filter((r) => r.at > (since.current as string)).reverse();
        if (fresh.length) setDots((ds) => [...ds, ...dotsOf(fresh, w)].slice(-MOST_DOTS));
      }
      since.current = newest ?? "";
    };
    void ask();
    const timer = setInterval(() => shown() && void ask(), POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [w, on]);
  return dots;
}

function Canvas({
  w,
  d,
  counts,
  inner,
  where,
  params,
  client,
  team,
  mayManage,
  onSaved,
}: {
  w: Drawn;
  d: Detail;
  counts: ReadonlyMap<string, Count> | undefined;
  inner: ReadonlyMap<string, Drawn> | undefined;
  where: Where;
  params: URLSearchParams;
  client: string | null;
  team: boolean;
  /** May see a door's whole token and rotate it. */
  mayManage: boolean;
  onSaved: () => void;
}) {
  const broken = d.broken ?? [];
  const made = isMade(w.id);
  // Doors the last publish made, by node: their tokens, shown once.
  const [fresh, setFresh] = useState<Fresh>({});
  const palette = d.palette ?? NO_PALETTE;
  // What's live, as a draft: every diff and change count is against it.
  const first = useMemo(() => draftOf(w, d.saved ?? null, broken.length > 0), [w, d, broken]);
  const code = d.code ?? EMPTY;
  // The draft kept on the server, or what's live when there's none.
  const stored = d.draft ? (d.draft.edits ?? code) : first;
  // The draft (and a made workflow's name) as he edits it, through the save engine: kept on this
  // device as he goes, so a reload or a closed tab gives it back; saved on Save draft and before
  // Publish, over the newest save the editor read (draft or live). One made elsewhere since is a
  // conflict with Keep mine / Use theirs, never an overwrite.
  const server = useMemo<Kept>(() => ({ draft: stored, name: w.name }), [stored, w.name]);
  const version = String(Math.max(d.draft?.id ?? 0, d.versions?.[0]?.id ?? 0));
  // The newest save this editor made: Publish and Discard name it until the read catches up.
  const savedAs = useRef(0);
  const keptKey = team ? `workflow:${client ?? ""}:${w.id}` : null;
  const kept = useSaved<Kept>({
    key: keptKey,
    server,
    version,
    delay: null,
    same: (a, b) => changesOf(a.draft, b.draft) === 0 && (!made || a.name.trim() === b.name.trim()),
    save: async (v, { expect, request }) => {
      const out = await call<{ id: number }>("console/workflowSave", {
        ...body(v),
        ...(typeof expect === "string" ? { expect: Number(expect) } : {}),
        requestId: request,
      });
      savedAs.current = Math.max(savedAs.current, out.id);
      return { version: String(out.id) };
    },
    onSaved: () => onSaved(),
    onConflict: () => onSaved(),
  });
  const expectNow = () => Math.max(savedAs.current, Number(version));
  // The value now, between renders: two changes in one tick both land.
  const live = useRef(kept.value);
  live.current = kept.value;
  const put = (patch: Partial<Kept>) => {
    const next = { ...live.current, ...patch };
    live.current = next;
    kept.set(next);
  };
  // Everything around the draft: open or not, Undo, panels, Claude's answer, errors, the dry test.
  const {
    s,
    send,
    change: setDraft,
    undo: undoOne,
  } = useCanvasEdit({
    ask: params.get("ask"),
    now: () => live.current.draft,
    set: (next) => put({ draft: next }),
  });
  const { editing, sel, picked, adding, choices, busy, error, proposal, confirm, testing, tested } =
    s;
  const draft = editing ? kept.value.draft : null;
  const name = kept.value.name;
  const setName = (n: string) => put({ name: n });
  const dirty = editing && kept.dirty;
  const actionKey = `${client ?? ""}:${w.id}`;
  const shown = useMemo(() => {
    if (!draft) return w;
    if (proposal?.patch) return drawnDiff(w, first, draft, proposal.patch, palette).drawn;
    return drawnWith(w, first, draft, palette);
  }, [w, first, draft, proposal, palette]);
  const marks = useMemo(() => {
    if (!draft) return undefined;
    // Claude's patch rings what it adds and takes out; the draft alone, what it adds.
    if (proposal?.patch) {
      const x = drawnDiff(w, first, draft, proposal.patch, palette);
      return { nodes: x.nodes, edges: x.edges };
    }
    const x = drawnDiff(w, first, first, draft, palette);
    const live = <K,>(m: Map<K, GraphMark>) => new Map([...m].filter(([, v]) => v !== "removed"));
    return { nodes: live(x.nodes), edges: live(x.edges) };
  }, [w, first, draft, proposal, palette]);
  // Claude's changes, so the frame pans to them on a wide drawing.
  const changed = useMemo(
    () =>
      proposal?.patch && marks
        ? [...marks.nodes.keys(), ...[...marks.edges.keys()].flatMap((k) => k.split(">"))]
        : undefined,
    [proposal, marks],
  );
  const graph = useMemo(
    () =>
      graphOf(shown, {
        counts: counts ?? new Map(),
        inner: inner ?? new Map(),
        // While editing, a click picks a card rather than opening it.
        where: draft ? { ...where, canvas: () => undefined } : where,
        team,
        allOut: !!draft,
        ...(marks ? { marks } : {}),
      }),
    [shown, counts, inner, where, team, draft, marks],
  );
  // A dry test's path, lit over the draft: each card it reached says how it went.
  const lit = useMemo(
    () => (tested ? dryNodes(graph.nodes, shown, tested.steps, tested.from) : null),
    [tested, graph, shown],
  );
  const dots = useEvents(w, !client);
  const funnel = useMemo(() => funnelOf(w, counts ?? new Map()), [w, counts]);
  const play = usePlay(w, client, {
    // Play opens into a card's inside and plays there, so the dot rides the wires with copy.
    into: (opens) => {
      const n = w.nodes.find((x) => x.opens === opens);
      const to = n && where.canvas(n);
      if (to) navigate(`${to}&play=1`);
    },
    auto: params.get("play") === "1",
  });
  const open = params.get("component");

  // `?edit=1` (a made workflow from the builder) opens on its draft, once; `?test=1` (Test run
  // on Automations) opens the tester on it too.
  // Typing kept from before a reload (or a conflict over it) opens it too.
  const opened = useRef(false);
  const back = kept.restored && (kept.dirty || !!kept.conflict);
  useEffect(() => {
    const test = params.get("test") === "1";
    if (opened.current || !team) return;
    if (params.get("edit") !== "1" && !test && !back) return;
    opened.current = true;
    send({ type: "open", testing: test });
    if (back) say.done("Your unsaved changes are back.");
  }, [team, params, back, send]);

  // `/` opens the palette and Ctrl or Cmd Z undoes while editing, unless he's typing.
  useEffect(() => {
    if (!draft) return;
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "/") {
        e.preventDefault();
        send({ type: "palette", open: true });
      } else if (e.key === "z" && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
        e.preventDefault();
        undoOne();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: setDraft reads draft, a dependency
  const edit = useMemo((): GraphEdit | undefined => {
    // A proposal on the canvas is read until he accepts or rejects it.
    if (!draft || proposal) return undefined;
    return {
      ends: (id) => ({
        from: endsOf(shown, id, "from").length > 0,
        to: endsOf(shown, id, "to").length > 0,
      }),
      fits: (a, b, ports) => pairsOf(shown, a, b, ports).length > 0,
      connect: (a, b, ports) => {
        const ps = pairsOf(shown, a, b, ports);
        if (ps.length === 1 && ps[0]) setDraft(wired(draft, ps[0]));
        else send({ type: "choices", wires: ps });
      },
      pick: (a, b) => send({ type: "pick", wire: { from: a, to: b } }),
    };
  }, [draft, shown, proposal]);

  const add = (uses: string) => {
    if (!draft || proposal) return;
    const got = addNode(shown, draft, uses, palette);
    if (!got) return;
    setDraft(got.draft);
    send({ type: "select", id: got.id });
  };

  const answered = useCallback(
    (reply: string, patch: Draft | null) => send({ type: "answered", reply, patch }),
    [send],
  );

  const body = ({ draft: x, name: n }: Kept) => ({
    workflow: w.id,
    ...(client ? { client } : {}),
    wires: x.wires,
    steps: x.steps,
    ...(x.settings ? { settings: x.settings } : {}),
    ...(x.retry ? { retry: x.retry } : {}),
    ...(made && n.trim() && n.trim() !== w.name ? { name: n.trim() } : {}),
  });
  /** A made workflow gone; the server refuses while it's live. */
  const drop = () =>
    ACTIONS.run(`workflow-delete:${actionKey}`, async (requestId) => {
      if (!window.confirm(`Delete ${w.name}? Its drafts go too.`)) return;
      send({ type: "busy", on: true, clear: true });
      try {
        await call("console/workflowDelete", {
          workflow: w.id,
          ...(client ? { client } : {}),
          requestId,
        });
        put(server);
        navigate(href(PAGE, { path: null, ask: null, edit: null }, params));
      } catch (err) {
        failed(err);
      }
      send({ type: "busy", on: false });
    });
  const failed = (err: unknown) =>
    send({ type: "failed", message: err instanceof Error ? err.message : String(err) });
  const close = () => send({ type: "close" });
  /** Publish: saved first when it changed since, then live. A sending one asks its id typed. */
  // What he types while it publishes stays open as the next draft, never dropped by the close.
  const publish = (typed?: string) =>
    ACTIONS.run(`workflow-publish:${actionKey}`, async (requestId) => {
      if (!editing) return;
      send({ type: "busy", on: true, clear: true });
      try {
        // A conflict or a refusal on the save shows on the bar; nothing publishes.
        if (!(await kept.flush())) return;
        const sent = live.current;
        const out = await call<{
          id?: number;
          asked?: string;
          doors?: { node: string; token: string }[];
        }>("console/workflowPublish", {
          workflow: w.id,
          ...(client ? { client } : {}),
          expect: expectNow(),
          ...(typed ? { confirm: typed } : {}),
          requestId,
        });
        if (out.id) savedAs.current = Math.max(savedAs.current, out.id);
        // A client's template: it waits in To approve, not live yet.
        if (out.asked) say.done("Asked. It goes live once approved in To approve.");
        if (out.doors?.length) {
          setFresh(Object.fromEntries(out.doors.map((x) => [x.node, x.token])));
          say.done("Published. Its door URL is over the canvas.");
        }
        if (live.current === sent) close();
        else {
          send({ type: "cancel" });
          say.done("Published. What you changed since is still open.");
        }
        onSaved();
      } catch (err) {
        failed(err);
        onSaved();
      } finally {
        send({ type: "busy", on: false });
      }
    });
  const discard = () =>
    ACTIONS.run(`workflow-discard:${actionKey}`, async (requestId) => {
      if (kept.dirty && !window.confirm("Throw away your changes?")) return;
      if (d.draft) {
        send({ type: "busy", on: true });
        try {
          await call("console/workflowDiscard", {
            workflow: w.id,
            ...(client ? { client } : {}),
            expect: expectNow(),
            requestId,
          });
        } catch (err) {
          return failed(err);
        } finally {
          send({ type: "busy", on: false });
        }
        onSaved();
      }
      // Nothing typed over what's saved: the device copy goes.
      put(server);
      close();
    });

  const graphEl = (
    <Graph
      {...graph}
      {...(lit ? { nodes: lit.nodes } : {})}
      label={`What runs in ${w.name}`}
      name={w.id}
      edit={edit}
      tools={!draft}
      {...(draft
        ? {
            minHeight: 640,
            fill: true,
            show: changed,
            inset: { left: adding ? 292 : 0, right: sel || picked || testing ? 372 : 0 },
          }
        : {})}
      dots={draft ? [] : [...dots, ...play.dots]}
      focus={draft ? lit?.lit : play.focus}
      {...(draft
        ? {
            selected: sel,
            onDrop: add,
            onPane: () => send({ type: "select", id: null }),
            onOpen: (id: string) => {
              if (!proposal) send({ type: "select", id });
            },
          }
        : {
            onOpen: (id: string) => {
              const uses = shown.nodes.find((n) => n.id === id)?.uses;
              if (uses) navigate(href(PAGE, { component: uses, tab: null }, params));
            },
          })}
    />
  );

  if (draft) {
    const unsaved = dirty;
    const saving = kept.status === "saving";
    const problems = [...problemsOf(draft), ...(unsaved ? [] : (d.draft?.problems ?? []))];
    const side = sel ? (
      <NodePanel
        key={sel}
        w={shown}
        id={sel}
        draft={draft}
        setDraft={setDraft}
        palette={palette}
        node={graph.nodes.find((n) => n.id === sel)}
        client={client}
        workflow={w.id}
        onOpenPart={(uses) => navigate(href(PAGE, { component: uses, tab: null }, params))}
        onClose={() => send({ type: "select", id: null })}
        test={<TestStep w={shown} workflow={w.id} client={client} draft={draft} node={sel} />}
        mayManage={mayManage}
        fresh={fresh}
        editKey={keptKey ?? ""}
      />
    ) : picked ? (
      <WirePanel
        w={shown}
        draft={draft}
        setDraft={setDraft}
        from={picked.from}
        to={picked.to}
        onClose={() => send({ type: "pick", wire: null })}
        editKey={keptKey ?? ""}
      />
    ) : null;
    return (
      <>
        <EditBar
          changes={changesOf(first, draft)}
          problems={[...new Set(problems)]}
          note={
            statusWords(kept.status, kept.error) ??
            (unsaved ? "Not saved" : d.draft ? `Saved ${dayLabel(d.draft.at)}` : null)
          }
        >
          {adding ? null : (
            <Button
              tone="secondary"
              size="dense"
              onClick={() => send({ type: "palette", open: true })}
            >
              Add node <kbd className="ml-1 text-[11px] text-(--ui-ink-3)">/</kbd>
            </Button>
          )}
          <Button tone="quiet" size="dense" onClick={undoOne} disabled={!s.undo.length || busy}>
            Undo
          </Button>
          <Button
            tone="secondary"
            size="dense"
            disabled={!!proposal}
            onClick={() => send({ type: "test" })}
          >
            {testing ? "Close test" : "Test workflow"}
          </Button>
          <RetryPick
            value={draft.retry ?? 0}
            onChange={(retry) => setDraft({ ...draft, retry })}
            disabled={busy}
          />
          <HistoryMenu
            versions={d.versions ?? []}
            onOpen={(v) => {
              send({ type: "proposed" });
              setDraft(v.edits ?? code);
            }}
            save={{
              workflow: w.id,
              client,
              name: w.name,
              forClients: d.forClients ?? false,
              templates: d.templates ?? [],
              mayManage,
              onSaved,
            }}
          />
          {d.saved?.edits && !made ? (
            <Button tone="quiet" size="dense" onClick={() => setDraft(code)} disabled={busy}>
              Back to built-in
            </Button>
          ) : null}
          {made ? (
            <>
              <Input
                aria-label="Workflow name"
                className="w-[200px]"
                data-edit={keptKey ?? ""}
                value={name}
                maxLength={60}
                onChange={(e) => setName(e.target.value)}
              />
              <Button tone="quiet" size="dense" onClick={drop} disabled={busy}>
                Delete
              </Button>
            </>
          ) : null}
          {made && !d.saved ? null : (
            <Button tone="secondary" size="dense" onClick={discard} disabled={busy}>
              Discard
            </Button>
          )}
          <Button
            tone="secondary"
            size="dense"
            busy={saving}
            onClick={() => void kept.flush()}
            disabled={!unsaved || saving}
          >
            Save draft
          </Button>
          <Button
            tone="primary"
            size="dense"
            busy={busy}
            onClick={() => publish()}
            disabled={!!proposal || (!unsaved && !d.draft)}
          >
            Publish
          </Button>
        </EditBar>
        {confirm ? (
          <PublishConfirm
            asks={confirm.asks}
            id={w.id}
            busy={busy}
            onPublish={publish}
            onCancel={() => send({ type: "cancel" })}
          />
        ) : null}
        {error ? <Alert className="mb-3">{error}</Alert> : null}
        {kept.conflict ? (
          <div className="mb-3">
            <SaveConflict
              conflict={kept.conflict}
              show={(t) =>
                `Their draft differs from yours in ${changesOf(t.draft, kept.value.draft)} places.`
              }
              onKeepMine={() => void kept.keepMine()}
              onTakeTheirs={kept.takeTheirs}
            />
          </div>
        ) : null}
        {proposal ? (
          <Proposal
            reply={proposal.reply}
            changes={proposal.patch ? changesOf(draft, proposal.patch) : null}
            onAccept={() => {
              if (proposal.patch) setDraft(proposal.patch);
              send({ type: "proposed" });
            }}
            onReject={() => send({ type: "proposed" })}
          />
        ) : (
          <div className="mb-3 flex">
            <AskGraph
              workflow={w.id}
              client={client}
              draft={draft}
              onAnswer={answered}
              pending={s.pending}
            />
          </div>
        )}
        {choices.length ? (
          <div className="mb-3 flex flex-wrap items-center gap-2 text-[13.5px]">
            <span className={QUIET}>Which wire?</span>
            {choices.map((x) => (
              <Button
                key={`${x.from}>${x.to}`}
                tone="secondary"
                size="dense"
                onClick={() => {
                  setDraft(wired(draft, x));
                  send({ type: "choices", wires: [] });
                }}
              >
                {endText(shown, x.from, "from")} → {endText(shown, x.to, "to")}
              </Button>
            ))}
          </div>
        ) : null}
        <div className="relative">
          {adding ? (
            <PaletteDrawer
              palette={palette}
              onAdd={add}
              onClose={() => send({ type: "palette", open: false })}
            />
          ) : null}
          {graphEl}
          {proposal ? null : side}
          {testing && !proposal ? (
            // Kept while a node's panel is over it, so its result stays.
            <div className={sel || picked ? "hidden" : undefined}>
              <TestPanel
                w={shown}
                workflow={w.id}
                client={client}
                draft={draft}
                onResult={(result) => send({ type: "tested", result })}
                onClose={() => send({ type: "test" })}
              />
            </div>
          ) : null}
        </div>
        {proposal ? null : (
          <Editor w={shown} draft={draft} setDraft={setDraft} at={`workflow-step:${actionKey}`} />
        )}
        {open ? (
          <PartPanel id={open} params={params} client={client} team={team} where={where} />
        ) : null}
      </>
    );
  }

  const doorNodes = team ? w.nodes.filter((n) => DOOR_TRIGGERS.has(n.uses ?? "")) : [];
  return (
    <>
      {doorNodes.length ? (
        <DoorStrip
          workflow={w.id}
          client={client}
          nodes={doorNodes}
          mayManage={mayManage}
          fresh={fresh}
        />
      ) : null}
      <div
        className={
          play.panel
            ? "grid items-start gap-6 min-[1100px]:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]"
            : undefined
        }
      >
        {graphEl}
        {play.panel}
      </div>
      {team && w.id === ROOT ? <MadeHere client={client} /> : null}
      {funnel.length ? (
        <Section title="Funnel" className="mt-8">
          <BarsChart rows={funnel} label={`${w.name} stages`} />
        </Section>
      ) : null}
      {open ? (
        <PartPanel id={open} params={params} client={client} team={team} where={where} />
      ) : null}
      {broken.length ? (
        <Alert className="mt-4">
          The saved wiring no longer fits, so the built-in one runs: {broken.join("; ")}
        </Alert>
      ) : null}
      <p className={`mt-4 flex flex-wrap items-center gap-3 text-[13.5px] ${QUIET}`}>
        {d.saved
          ? d.saved.edits
            ? `Published by ${d.saved.by}, ${dayLabel(d.saved.at)}.`
            : `Back to the built-in wiring by ${d.saved.by}, ${dayLabel(d.saved.at)}.`
          : "The built-in wiring."}
        {team && d.draft ? ` A draft by ${d.draft.by} isn't live yet.` : null}
        {play.button}
        {team ? (
          <Button
            tone="secondary"
            size="dense"
            className="max-[900px]:hidden"
            onClick={() => send({ type: "open" })}
          >
            {d.draft ? "Open draft" : "Edit"}
          </Button>
        ) : null}
      </p>
    </>
  );
}

/** A sending workflow asks its id typed before it goes live: a guard, so nothing is kept. */
function PublishConfirm({
  asks,
  id,
  busy,
  onPublish,
  onCancel,
}: {
  asks: string;
  id: string;
  busy: boolean;
  onPublish: (typed: string) => Promise<unknown>;
  onCancel: () => void;
}) {
  const form = useEditForm({ key: null, defaults: { typed: "" } });
  const go = form.onSend((v) => onPublish(v.typed.trim()));
  return (
    <form
      className="mb-3 flex flex-wrap items-end gap-3 border border-(--warn) bg-(--ui-paper) px-3 py-2.5 text-[13.5px]"
      onSubmit={(e) => void go(e)}
    >
      <TextField
        form={form}
        name="typed"
        label={`${asks.replace(/: type .*$/, "").replace(/^it/, "It")}. Type ${id} to make it live.`}
        aria-label={`Type ${id} to confirm`}
        className={`${NARROW} grow basis-[260px]`}
      />
      <Button
        tone="primary"
        type="submit"
        size="dense"
        busy={busy}
        disabled={form.watch("typed").trim() !== id}
      >
        Publish
      </Button>
      <Button tone="quiet" size="dense" onClick={onCancel}>
        Cancel
      </Button>
    </form>
  );
}

/**
 * Below the canvas while editing: a wire by name from two lists, for the keyboard, and a custom
 * step that posts each event to its URL. `at` keeps the custom step's typed words.
 */
function Editor({
  w,
  draft,
  setDraft,
  at,
}: {
  w: Drawn;
  draft: Draft;
  setDraft: (d: Draft) => void;
  at: string;
}) {
  const [note, setNote] = useState<string | null>(null);
  const froms = allEnds(w, "from");
  const tos = allEnds(w, "to");
  const kinds = [...new Set(froms.map((e) => e.port.kind))].sort();

  const wire = useEditForm({
    key: null,
    defaults: { from: froms[0]?.ref ?? "", to: tos[0]?.ref ?? "" },
  });
  const addWire = wire.onSend((v) => {
    const from = froms.find((x) => x.ref === v.from);
    const to = tos.find((x) => x.ref === v.to);
    if (!from || !to) return false;
    if (from.port.kind !== to.port.kind) {
      setNote(`${from.port.label} can't go into ${to.port.label}: the kinds differ.`);
      return false;
    }
    setNote(null);
    setDraft(wired(draft, { from: from.ref, to: to.ref, via: "events" }));
  });
  const step = useEditForm({
    key: at,
    defaults: { name: "", url: "", takes: kinds[0] ?? "", gives: kinds[0] ?? "", outs: "" },
  });
  const addStep = step.onSend(
    (v) => {
      const s = stepOf(w, {
        name: v.name,
        url: v.url,
        takes: v.takes as never,
        gives: v.gives as never,
        outs: v.outs,
      });
      setDraft({ ...draft, steps: [...draft.steps, s] });
    },
    { clear: true },
  );

  return (
    <div className="mt-6 grid gap-8">
      <Section
        title="Wire by name"
        note="Or drag from a dot onto another of the same color. Click a wire to set its rule."
      >
        <form className={FORM} onSubmit={(e) => void addWire(e)}>
          <SelectField
            form={wire}
            name="from"
            label="From"
            className={NARROW}
            options={froms.map((e) => [e.ref, `${endText(w, e.ref, "from")} (${e.port.kind})`])}
          />
          <SelectField
            form={wire}
            name="to"
            label="To"
            className={NARROW}
            options={tos.map((e) => [e.ref, `${endText(w, e.ref, "to")} (${e.port.kind})`])}
          />
          <Button type="submit" tone="secondary" size="dense">
            Add wire
          </Button>
        </form>
        {note ? <p className={`mt-2 ${ERROR}`}>{note}</p> : null}
      </Section>

      <Section
        title="Custom step"
        note="A one-off integration: each event is posted to your URL, which answers what goes out."
      >
        <form className={FORM} onSubmit={(e) => void addStep(e)}>
          <TextField
            form={step}
            name="name"
            label="Name"
            required
            maxLength={60}
            placeholder="Their CRM"
            className={NARROW}
          />
          <TextField
            form={step}
            name="url"
            label="URL"
            type="url"
            required
            pattern="https://.+"
            maxLength={500}
            placeholder="https://"
            className={`${NARROW} grow basis-[260px]`}
          />
          <SelectField
            form={step}
            name="takes"
            label="Takes"
            className={NARROW}
            options={kinds.map((k) => [k, k])}
          />
          <SelectField
            form={step}
            name="gives"
            label="Gives"
            className={NARROW}
            options={kinds.map((k) => [k, k])}
          />
          <TextField
            form={step}
            name="outs"
            label="Outputs"
            maxLength={120}
            placeholder="done"
            className={NARROW}
          />
          <Button type="submit" tone="secondary" size="dense">
            Add step
          </Button>
        </form>
        <FormKept form={step} />
      </Section>
    </div>
  );
}

/** The part a card stands for, beside the canvas: the list's own panel, a sheet on a phone. */
function PartPanel({
  id,
  params,
  client,
  team,
  where,
}: {
  id: string;
  params: URLSearchParams;
  client: string | null;
  team: boolean;
  where: Where;
}) {
  const api = consoleApi(client);
  const types = useTypes(api);
  const meta = types.data?.find((t) => t.id === "console.component");
  if (!meta || !types.data) return null;
  const place: Place = {
    params,
    link: (change) => href(PAGE, change, params),
    page: (rid) => href(PAGE, { component: String(rid) }, params),
    list: href(PAGE, { component: null, tab: null }, params),
    go: navigate,
  };
  return (
    <RecordPanel
      meta={meta}
      types={types.data}
      id={id}
      api={api}
      place={place}
      extras={(detail) => {
        const inside = (detail as Detail | null)?.workflow;
        if (!inside) return {};
        const g = graphOf(inside, { counts: new Map(), where, team });
        return {
          sections: [
            [
              "Inside",
              <Graph
                key="inside"
                {...g}
                label={`What runs inside ${inside.name}`}
                tools={false}
                maxHeight={420}
              />,
            ],
          ],
        };
      }}
      acts={undefined}
      index={-1}
      count={0}
      step={() => undefined}
      rev={0}
      onActed={() => undefined}
    />
  );
}
