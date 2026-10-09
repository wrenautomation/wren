/**
 * Workflows: Wren's business drawn as its workflows. `wren` first; a stacked card opens what runs
 * inside it in place, with a trail back. Each number is the last 30 days of the record view its
 * port names, and a card with one opens those records. The team rewires one here: drag an output
 * onto an input, set a wire's condition or wait, add a custom step, save it for Wren or for the
 * client in `?client=`.
 */
import { DOOR_TRIGGERS } from "@wren/core/logic";
import type { RecordAnswer, RecordsPage, RecordsStat } from "@wren/core/records/serve";
import { isMade, type Wire } from "@wren/core/workflows";
import {
  Alert,
  BarsChart,
  Button,
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
  Section,
  say,
  useTypes,
} from "@wren/ui";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { call } from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { href, navigate } from "../../route.js";
import { type CountRef, countKey, countsIn, type Drawn } from "../marketplace/boxes.js";
import { dayLabel, ERROR, FIELD, FORM, QUIET, SELECT } from "../work/bits.js";
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
import { DoorStrip, type Fresh } from "./doors.js";
import { type DryStep, dryNodes } from "./dry.js";
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
/** How far Undo goes back. */
const UNDO_MOST = 50;

/** The first of Wren's lists over `c`'s record, on its view. */
const recordsAt = (c: CountRef) => {
  for (const m of WREN_APPS)
    for (const p of m.pages)
      if ("record" in p && p.record === c.record && p.template === "list")
        return `/${m.id}/${p.id}?view=${encodeURIComponent(c.view)}`;
  return undefined;
};

const SERVED = new Map<string, Promise<ReadonlySet<string> | null>>();
/** The record types the console serves here, read once a session; null when unread. */
function servedBy(client: string | null): Promise<ReadonlySet<string> | null> {
  const key = client ?? "";
  let got = SERVED.get(key);
  if (!got) {
    got = call<{ id: string }[]>("console/recordsTypes", client ? { client } : {}).then(
      (ts) => new Set(ts.map((t) => t.id)),
      () => null,
    );
    SERVED.set(key, got);
  }
  return got;
}

export function Workflows({ params, team, can }: PageProps) {
  const path = (params.get("path") ?? ROOT).split("/").filter(Boolean);
  const client = params.get("client") || null;
  const canvasAt = (p: readonly string[]) =>
    `/workflows/canvas?path=${p.join("/")}${client ? `&client=${encodeURIComponent(client)}` : ""}`;
  const [nonce, setNonce] = useState(0);
  const trail = useCall(`workflows:${client ?? ""}:${path.join("/")}:${nonce}`, () =>
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
    return new Map(got.flatMap((x) => (x ? [[x.id, x] as const] : [])));
  });
  const all = w ? [w, ...(inner.data?.values() ?? [])] : [];
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
      return new Map(got.filter((x) => x !== null));
    },
  );
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
        lede={`${client ? `Wired for ${client}. ` : ""}Numbers are the last ${DAYS} days. A stacked card opens what runs inside it. Faded: not built yet.`}
      />
      {client ? null : <Panes params={params} />}
      {!client && params.get("pane") === "runs" ? (
        <Executions w={w} params={params} can={can} />
      ) : (
        <Canvas
          key={path.join("/")}
          w={w}
          d={d}
          counts={counts.data ?? undefined}
          inner={inner.data ?? undefined}
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
          onSaved={() => setNonce((n) => n + 1)}
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
const APIS = new Map<string, RecordsApi>();
const consoleApi = (client: string | null): RecordsApi => {
  const key = client ?? "";
  let api = APIS.get(key);
  if (!api) {
    const ask = <T,>(h: string, body: object) =>
      call<T>(`console/${h}`, client ? { client, ...body } : { ...body });
    api = {
      types: () => ask("recordsTypes", {}),
      list: (a) => ask("recordsList", a),
      get: (a) => ask("recordsGet", a),
      export: (a) => ask("recordsExport", a),
      stats: (a) => ask("recordsStats", a),
    };
    APIS.set(key, api);
  }
  return api;
};

/**
 * Real events as they land: the spine's newest rows, asked every few seconds while the page
 * shows. The first answer only marks where "new" starts; nothing old replays.
 */
function useEvents(w: Drawn, on: boolean): GraphDot[] {
  const [dots, setDots] = useState<GraphDot[]>([]);
  const since = useRef<string | null>(null);
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
    const timer = setInterval(() => void ask(), POLL_MS);
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
  const [draft, setDraftNow] = useState<Draft | null>(null);
  const [undo, setUndo] = useState<Draft[]>([]);
  const [picked, setPicked] = useState<{ from: string; to: string } | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [choices, setChoices] = useState<Wire[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The builder's first ask (`?ask=`), waited on as the editor opens; cleared once answered.
  const [pending, setPending] = useState<string | null>(params.get("ask"));
  // A made workflow's name, saved with the draft.
  const [name, setName] = useState(w.name);
  // Claude's answer on the graph: shown as a diff over the draft until he accepts or rejects it.
  const [proposal, setProposal] = useState<{ reply: string; patch: Draft | null } | null>(null);
  // Publishing a workflow that sends or spends asks its id typed back: the server names the effects.
  const [confirm, setConfirm] = useState<{ asks: string; typed: string } | null>(null);
  // Test workflow: its panel, and the steps of the last dry run, lit until the draft changes.
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState<{ steps: readonly DryStep[]; from: string } | null>(null);
  /** Every change to the draft goes through here, so Undo can step back. */
  const setDraft = (next: Draft) => {
    if (draft) setUndo((u) => [...u.slice(-(UNDO_MOST - 1)), draft]);
    setDraftNow(next);
    setTested(null);
  };
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

  // `?edit=1` (a made workflow from the builder) opens on its draft, once.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !team || params.get("edit") !== "1") return;
    opened.current = true;
    setDraftNow(stored);
  }, [team, params, stored]);

  const back = () => {
    const last = undo.at(-1);
    if (!last) return;
    setUndo((u) => u.slice(0, -1));
    setDraftNow(last);
    setTested(null);
  };
  // `/` opens the palette and Ctrl or Cmd Z undoes while editing, unless he's typing.
  useEffect(() => {
    if (!draft) return;
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "/") {
        e.preventDefault();
        setAdding(true);
      } else if (e.key === "z" && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
        e.preventDefault();
        back();
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
        else setChoices(ps);
      },
      pick: (a, b) => {
        setSel(null);
        setPicked({ from: a, to: b });
      },
    };
  }, [draft, shown, proposal]);

  const add = (uses: string) => {
    if (!draft || proposal) return;
    const got = addNode(shown, draft, uses, palette);
    if (!got) return;
    setDraft(got.draft);
    setPicked(null);
    setSel(got.id);
  };

  const answered = useCallback((reply: string, patch: Draft | null) => {
    setPending(null);
    setSel(null);
    setPicked(null);
    setAdding(false);
    setProposal({ reply, patch });
  }, []);

  const body = (x: Draft) => ({
    workflow: w.id,
    ...(client ? { client } : {}),
    wires: x.wires,
    steps: x.steps,
    ...(x.settings ? { settings: x.settings } : {}),
    ...(x.retry ? { retry: x.retry } : {}),
    ...(made && name.trim() && name.trim() !== w.name ? { name: name.trim() } : {}),
  });
  /** A made workflow gone; the server refuses while it's live. */
  const drop = async () => {
    if (!window.confirm(`Delete ${w.name}? Its drafts go too.`)) return;
    setBusy(true);
    setError(null);
    try {
      await call("console/workflowDelete", { workflow: w.id, ...(client ? { client } : {}) });
      navigate(href(PAGE, { path: null, ask: null, edit: null }, params));
    } catch (err) {
      failed(err);
    }
    setBusy(false);
  };
  const failed = (err: unknown) => {
    const m = err instanceof Error ? err.message : String(err);
    if (/to confirm$/.test(m)) setConfirm({ asks: m, typed: "" });
    else setError(m);
  };
  const keep = async () => {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      await call("console/workflowSave", body(draft));
      onSaved();
    } catch (err) {
      failed(err);
    }
    setBusy(false);
  };
  const close = () => {
    setDraftNow(null);
    setUndo([]);
    setProposal(null);
    setChoices([]);
    setError(null);
    setConfirm(null);
    setSel(null);
    setPicked(null);
    setAdding(false);
    setTesting(false);
    setTested(null);
  };
  /** Publish: kept first when it changed since, then live. A sending one asks its id typed. */
  const publish = async (typed?: string) => {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      if (!d.draft || changesOf(stored, draft) > 0) await call("console/workflowSave", body(draft));
      const out = await call<{
        asked?: string;
        doors?: { node: string; token: string }[];
      }>("console/workflowPublish", {
        workflow: w.id,
        ...(client ? { client } : {}),
        ...(typed ? { confirm: typed } : {}),
      });
      // A client's template: it waits in To approve, not live yet.
      if (out.asked) say.done("Asked. It goes live once approved in To approve.");
      if (out.doors?.length) {
        setFresh(Object.fromEntries(out.doors.map((x) => [x.node, x.token])));
        say.done("Published. Its door URL is over the canvas.");
      }
      close();
      onSaved();
    } catch (err) {
      failed(err);
      onSaved();
    }
    setBusy(false);
  };
  const discard = async () => {
    if (d.draft) {
      setBusy(true);
      try {
        await call("console/workflowDiscard", { workflow: w.id, ...(client ? { client } : {}) });
      } catch (err) {
        setBusy(false);
        return failed(err);
      }
      setBusy(false);
      onSaved();
    }
    close();
  };

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
            onPane: () => {
              setSel(null);
              setPicked(null);
            },
            onOpen: (id: string) => {
              if (proposal) return;
              setPicked(null);
              setSel(id);
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
    const unsaved = changesOf(stored, draft) > 0 || (made && name.trim() !== w.name);
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
        onClose={() => setSel(null)}
        test={<TestStep w={shown} workflow={w.id} client={client} draft={draft} node={sel} />}
        mayManage={mayManage}
        fresh={fresh}
      />
    ) : picked ? (
      <WirePanel
        w={shown}
        draft={draft}
        setDraft={setDraft}
        from={picked.from}
        to={picked.to}
        onClose={() => setPicked(null)}
      />
    ) : null;
    return (
      <>
        <EditBar
          changes={changesOf(first, draft)}
          problems={[...new Set(problems)]}
          note={unsaved ? "Not saved" : d.draft ? `Saved ${dayLabel(d.draft.at)}` : null}
        >
          {adding ? null : (
            <Button tone="secondary" size="dense" onClick={() => setAdding(true)}>
              Add node <kbd className="ml-1 text-[11px] text-(--ui-ink-3)">/</kbd>
            </Button>
          )}
          <Button tone="quiet" size="dense" onClick={back} disabled={!undo.length || busy}>
            Undo
          </Button>
          <Button
            tone="secondary"
            size="dense"
            disabled={!!proposal}
            onClick={() => {
              if (testing) setTested(null);
              setTesting(!testing);
              setSel(null);
              setPicked(null);
            }}
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
              setProposal(null);
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
          <Button tone="secondary" size="dense" busy={busy} onClick={keep} disabled={!unsaved}>
            Save draft
          </Button>
          <Button
            size="dense"
            busy={busy}
            onClick={() => publish()}
            disabled={!!proposal || (!unsaved && !d.draft)}
          >
            Publish
          </Button>
        </EditBar>
        {confirm ? (
          <form
            className="mb-3 flex flex-wrap items-end gap-3 border border-(--warn) bg-(--ui-paper) px-3 py-2.5 text-[13.5px]"
            onSubmit={(e) => {
              e.preventDefault();
              void publish(confirm.typed.trim());
            }}
          >
            <label className={`${FIELD} grow basis-[260px]`}>
              <span>
                {confirm.asks.replace(/: type .*$/, "").replace(/^it/, "It")}. Type {w.id} to make
                it live.
              </span>
              <Input
                value={confirm.typed}
                onChange={(e) => setConfirm({ ...confirm, typed: e.target.value })}
                aria-label={`Type ${w.id} to confirm`}
              />
            </label>
            <Button type="submit" size="dense" busy={busy} disabled={confirm.typed.trim() !== w.id}>
              Publish
            </Button>
            <Button tone="quiet" size="dense" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
          </form>
        ) : null}
        {error ? <Alert className="mb-3">{error}</Alert> : null}
        {proposal ? (
          <Proposal
            reply={proposal.reply}
            changes={proposal.patch ? changesOf(draft, proposal.patch) : null}
            onAccept={() => {
              if (proposal.patch) setDraft(proposal.patch);
              setProposal(null);
            }}
            onReject={() => setProposal(null)}
          />
        ) : (
          <div className="mb-3 flex">
            <AskGraph
              workflow={w.id}
              client={client}
              draft={draft}
              onAnswer={answered}
              pending={pending}
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
                  setChoices([]);
                }}
              >
                {endText(shown, x.from, "from")} → {endText(shown, x.to, "to")}
              </Button>
            ))}
          </div>
        ) : null}
        <div className="relative">
          {adding ? (
            <PaletteDrawer palette={palette} onAdd={add} onClose={() => setAdding(false)} />
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
                onResult={setTested}
                onClose={() => {
                  setTesting(false);
                  setTested(null);
                }}
              />
            </div>
          ) : null}
        </div>
        {proposal ? null : <Editor w={shown} draft={draft} setDraft={setDraft} />}
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
            onClick={() => setDraftNow(d.draft ? (d.draft.edits ?? code) : first)}
          >
            {d.draft ? "Open draft" : "Edit"}
          </Button>
        ) : null}
      </p>
    </>
  );
}

/**
 * Below the canvas while editing: a wire by name from two lists, for the keyboard, and a custom
 * step that posts each event to its URL.
 */
function Editor({ w, draft, setDraft }: { w: Drawn; draft: Draft; setDraft: (d: Draft) => void }) {
  const [note, setNote] = useState<string | null>(null);
  const kinds = [...new Set(allEnds(w, "from").map((e) => e.port.kind))].sort();

  const addWire = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const from = allEnds(w, "from").find((x) => x.ref === f.get("from"));
    const to = allEnds(w, "to").find((x) => x.ref === f.get("to"));
    if (!from || !to) return;
    if (from.port.kind !== to.port.kind)
      return setNote(`${from.port.label} can't go into ${to.port.label}: the kinds differ.`);
    setNote(null);
    setDraft(wired(draft, { from: from.ref, to: to.ref, via: "events" }));
  };
  const addStep = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = stepOf(w, {
      name: String(f.get("name") ?? ""),
      url: String(f.get("url") ?? ""),
      takes: String(f.get("takes")) as never,
      gives: String(f.get("gives")) as never,
      outs: String(f.get("outs") ?? ""),
    });
    setDraft({ ...draft, steps: [...draft.steps, s] });
    e.currentTarget.reset();
  };

  return (
    <div className="mt-6 grid gap-8">
      <Section
        title="Wire by name"
        note="Or drag from a dot onto another of the same color. Click a wire to set its rule."
      >
        <form className={FORM} onSubmit={addWire}>
          <label className={FIELD}>
            <span>From</span>
            <select className={SELECT} name="from">
              {allEnds(w, "from").map((e) => (
                <option key={e.ref} value={e.ref}>
                  {endText(w, e.ref, "from")} ({e.port.kind})
                </option>
              ))}
            </select>
          </label>
          <label className={FIELD}>
            <span>To</span>
            <select className={SELECT} name="to">
              {allEnds(w, "to").map((e) => (
                <option key={e.ref} value={e.ref}>
                  {endText(w, e.ref, "to")} ({e.port.kind})
                </option>
              ))}
            </select>
          </label>
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
        <form className={FORM} onSubmit={addStep}>
          <label className={FIELD}>
            <span>Name</span>
            <Input name="name" required maxLength={60} placeholder="Their CRM" />
          </label>
          <label className={`${FIELD} grow basis-[260px]`}>
            <span>URL</span>
            <Input
              name="url"
              type="url"
              required
              pattern="https://.+"
              maxLength={500}
              placeholder="https://"
            />
          </label>
          <label className={FIELD}>
            <span>Takes</span>
            <select className={SELECT} name="takes">
              {kinds.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </label>
          <label className={FIELD}>
            <span>Gives</span>
            <select className={SELECT} name="gives">
              {kinds.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </label>
          <label className={FIELD}>
            <span>Outputs</span>
            <Input name="outs" maxLength={120} placeholder="done" />
          </label>
          <Button type="submit" tone="secondary" size="dense">
            Add step
          </Button>
        </form>
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
