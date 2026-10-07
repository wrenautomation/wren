/**
 * Workflows: Wren's business drawn as its workflows. `wren` first; a stacked card opens what runs
 * inside it in place, with a trail back. Each number is the last 30 days of the record view its
 * port names, and a card with one opens those records. The team rewires one here: drag an output
 * onto an input, set a wire's condition or wait, add a custom step, save it for Wren or for the
 * client in `?client=`.
 */
import type { RecordAnswer, RecordsPage, RecordsStat } from "@wren/core/records/serve";
import type { Wire } from "@wren/core/workflows";
import {
  Alert,
  BarsChart,
  Button,
  Graph,
  type GraphDot,
  type GraphEdit,
  Input,
  Loading,
  PageHeader,
  type Place,
  RecordPanel,
  type RecordsApi,
  Section,
  Tag,
  useTypes,
} from "@wren/ui";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { call } from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { href, navigate } from "../../route.js";
import { type CountRef, countKey, countsIn, type Drawn } from "../marketplace/boxes.js";
import { dayLabel, ERROR, FIELD, FORM, LIST, QUIET, SELECT, SPLIT } from "../work/bits.js";
import {
  type Count,
  dotsOf,
  type EventRow,
  funnelOf,
  graphOf,
  type PortRef,
  portKey,
  portsIn,
  type Where,
} from "./canvas.js";
import { WREN_APPS } from "./index.js";
import { usePlay } from "./playback.js";
import {
  allEnds,
  type Draft,
  draftOf,
  drawnWith,
  endsOf,
  endText,
  pairsOf,
  type Saved,
  stepOf,
  wired,
  withoutStep,
} from "./wiring.js";

const ROOT = "wren";
const DAYS = 30;
const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const WAIT = /^\d+ (minute|hour|day|week)s?$/;
const PAGE = "/workflows/canvas";
/** How often the canvas asks the spine for new events, and the most dots in flight. */
const POLL_MS = 8000;
const MOST_DOTS = 24;

type Detail = { workflow?: Drawn; saved?: Saved | null; broken?: string[] };

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

export function Workflows({ params, team }: PageProps) {
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
        }).then((a) => (a.detail as Detail | null) ?? null),
      ),
    ),
  );
  const d = trail.data?.at(-1) ?? null;
  const w = d?.workflow ?? null;
  // A workflow card with no number of its own shows its inside's: read those drawings too.
  const opens = w?.nodes.filter((n) => n.opens && !n.count).map((n) => n.opens as string) ?? [];
  const inner = useCall(`workflow-inner:${client ?? ""}:${opens.join(",")}`, async () => {
    const got = await Promise.all(
      opens.map((id) =>
        call<RecordAnswer>("console/recordsGet", {
          record: "console.component",
          id,
          ...(client ? { client } : {}),
        }).then(
          (a) => (a.detail as Detail | null)?.workflow ?? null,
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
  if (trail.error && !trail.data) return <Alert onRetry={trail.retry}>{trail.error.message}</Alert>;
  if (!trail.data) return <Loading lines={6} />;
  if (!d || !w) return <Alert>No workflow called {path.at(-1)}.</Alert>;
  return (
    <>
      {path.length > 1 ? (
        <nav aria-label="Workflows open" className="mb-2 text-[13px] text-(--ui-ink-2)">
          {trail.data.slice(0, -1).map((t, i) => (
            <span key={path[i]}>
              <a href={canvasAt(path.slice(0, i + 1))} className="hover:text-(--ui-ink)">
                {t?.workflow?.name ?? path[i]}
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
      <Canvas
        key={`${path.join("/")}:${nonce}`}
        w={w}
        d={d}
        counts={counts.data ?? undefined}
        inner={inner.data ?? undefined}
        where={{
          canvas: (n) => (n.opens ? canvasAt([...path, n.opens]) : undefined),
          rows: recordsAt,
        }}
        params={params}
        client={client}
        team={team}
        onSaved={() => setNonce((n) => n + 1)}
      />
    </>
  );
}

/** Which box a wire end sits on: a node's id, or the workflow's own `in.x` and `out.x`. */
const boxOf = (ref: string) => {
  const [head = ""] = ref.split(".");
  return head === "in" || head === "out" ? ref : head;
};

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
  onSaved: () => void;
}) {
  const broken = d.broken ?? [];
  const first = useMemo(() => draftOf(w, d.saved ?? null, broken.length > 0), [w, d, broken]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [picked, setPicked] = useState<{ from: string; to: string } | null>(null);
  const [choices, setChoices] = useState<Wire[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown = useMemo(() => (draft ? drawnWith(w, first, draft) : w), [w, first, draft]);
  const graph = useMemo(
    () =>
      graphOf(shown, {
        counts: counts ?? new Map(),
        inner: inner ?? new Map(),
        where,
        team,
        allOut: !!draft,
      }),
    [shown, counts, inner, where, team, draft],
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

  const edit = useMemo((): GraphEdit | undefined => {
    if (!draft) return undefined;
    return {
      ends: (id) => ({
        from: endsOf(shown, id, "from").length > 0,
        to: endsOf(shown, id, "to").length > 0,
      }),
      fits: (a, b) => pairsOf(shown, a, b).length > 0,
      connect: (a, b) => {
        const ps = pairsOf(shown, a, b);
        if (ps.length === 1 && ps[0]) setDraft(wired(draft, ps[0]));
        else setChoices(ps);
      },
      pick: (a, b) => {
        setPicked({ from: a, to: b });
        document.getElementById(`wire-${a}-${b}`)?.scrollIntoView({ block: "nearest" });
      },
    };
  }, [draft, shown]);

  const save = async (reset: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await call("console/workflowSave", {
        workflow: w.id,
        ...(client ? { client } : {}),
        ...(reset ? { reset: true } : { wires: draft?.wires ?? [], steps: draft?.steps ?? [] }),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <>
      <div
        className={
          play.panel && !draft
            ? "grid items-start gap-6 min-[1100px]:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]"
            : undefined
        }
      >
        <Graph
          {...graph}
          label={`What runs in ${w.name}`}
          name={w.id}
          edit={edit}
          dots={draft ? [] : [...dots, ...play.dots]}
          focus={draft ? undefined : play.focus}
          onOpen={(id) => {
            const uses = shown.nodes.find((n) => n.id === id)?.uses;
            if (uses) navigate(href(PAGE, { component: uses, tab: null }, params));
          }}
        />
        {draft ? null : play.panel}
      </div>
      {funnel.length && !draft ? (
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
      {!draft ? (
        <p className={`mt-4 flex flex-wrap items-center gap-3 text-[13.5px] ${QUIET}`}>
          {d.saved
            ? d.saved.edits
              ? `Saved by ${d.saved.by}, ${dayLabel(d.saved.at)}.`
              : `Back to the built-in wiring by ${d.saved.by}, ${dayLabel(d.saved.at)}.`
            : "The built-in wiring."}
          {play.button}
          {team ? (
            <Button tone="secondary" size="dense" onClick={() => setDraft(first)}>
              Edit wiring
            </Button>
          ) : null}
        </p>
      ) : (
        <Editor
          w={shown}
          draft={draft}
          setDraft={setDraft}
          picked={picked}
          choices={choices}
          choose={(x) => {
            setDraft(wired(draft, x));
            setChoices([]);
          }}
          error={error}
          busy={busy}
          save={() => save(false)}
          reset={d.saved?.edits ? () => save(true) : null}
          discard={() => {
            setDraft(null);
            setChoices([]);
            setError(null);
          }}
        />
      )}
    </>
  );
}

function Editor({
  w,
  draft,
  setDraft,
  picked,
  choices,
  choose,
  error,
  busy,
  save,
  reset,
  discard,
}: {
  w: Drawn;
  draft: Draft;
  setDraft: (d: Draft) => void;
  picked: { from: string; to: string } | null;
  choices: Wire[];
  choose: (x: Wire) => void;
  error: string | null;
  busy: boolean;
  save: () => void;
  reset: (() => void) | null;
  discard: () => void;
}) {
  const [note, setNote] = useState<string | null>(null);
  const text = (x: Wire) => `${endText(w, x.from, "from")} → ${endText(w, x.to, "to")}`;
  const set = (i: number, k: "when" | "wait", v: string) =>
    setDraft({
      ...draft,
      wires: draft.wires.map((x, j) => {
        if (j !== i) return x;
        const { [k]: _, ...rest } = x;
        return v ? { ...rest, [k]: v } : rest;
      }),
    });
  const kinds = [...new Set(allEnds(w, "from").map((e) => e.port.kind))].sort();
  const hit = (x: Wire) => !!picked && boxOf(x.from) === picked.from && boxOf(x.to) === picked.to;
  const row = (x: Wire) =>
    `scroll-mt-20 ${hit(x) ? "bg-(--ui-tile) outline outline-(--ui-ink-3)" : ""}`;

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
      <p className={`text-[13.5px] ${QUIET}`}>
        Drag from a card's right dot onto another's left dot to wire them; the kinds must match.
        Click a line to find its wires below. Built-in wires are the parts' own code and stay put.
      </p>
      {choices.length ? (
        <Section title="Which wire?">
          <div className="flex flex-wrap gap-2">
            {choices.map((x) => (
              <Button
                key={`${x.from}>${x.to}`}
                tone="secondary"
                size="dense"
                onClick={() => choose(x)}
              >
                {text(x)}
              </Button>
            ))}
          </div>
        </Section>
      ) : null}

      <Section title="Wires">
        <ul className={`list-none ${LIST}`}>
          {w.wires
            .filter((x) => x.via === "code")
            .map((x) => (
              <li
                key={`code:${x.from}>${x.to}`}
                id={`wire-${boxOf(x.from)}-${boxOf(x.to)}`}
                className={row(x)}
              >
                <div className={SPLIT}>
                  <span>{text(x)}</span>
                  <Tag>Built in</Tag>
                </div>
              </li>
            ))}
          {draft.wires.map((x, i) => (
            <li
              key={`${x.from}>${x.to}`}
              id={`wire-${boxOf(x.from)}-${boxOf(x.to)}`}
              className={row(x)}
            >
              <div className={SPLIT}>
                <span>{text(x)}</span>
                <Button
                  tone="quiet"
                  size="dense"
                  onClick={() =>
                    setDraft({ ...draft, wires: draft.wires.filter((_, j) => j !== i) })
                  }
                >
                  Remove
                </Button>
              </div>
              <div className={FORM}>
                <label className={`${FIELD} grow basis-[260px]`}>
                  <span>Only if (in words)</span>
                  <Input
                    value={x.when ?? ""}
                    maxLength={300}
                    placeholder="Every event"
                    onChange={(e) => set(i, "when", e.target.value)}
                  />
                </label>
                <label className={FIELD}>
                  <span>Wait</span>
                  <Input
                    value={x.wait ?? ""}
                    maxLength={40}
                    placeholder="None"
                    aria-invalid={!!x.wait && !WAIT.test(x.wait.trim())}
                    onChange={(e) => set(i, "wait", e.target.value)}
                  />
                </label>
              </div>
              {x.wait && !WAIT.test(x.wait.trim()) ? (
                <p className={ERROR}>A wait reads like "2 days", "6 hours" or "1 week".</p>
              ) : null}
            </li>
          ))}
        </ul>
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
        title="Custom steps"
        note="A one-off integration: each event is posted to your URL, which answers what goes out."
      >
        {draft.steps.length ? (
          <ul className={`list-none ${LIST}`}>
            {draft.steps.map((s) => (
              <li key={s.id} className={SPLIT}>
                <span>
                  {s.own.name} <span className={QUIET}>{s.own.run}</span>
                </span>
                <Button
                  tone="quiet"
                  size="dense"
                  onClick={() => setDraft(withoutStep(draft, s.id))}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
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

      {error ? <Alert>{error}</Alert> : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button size="dense" busy={busy} onClick={save}>
          Save wiring
        </Button>
        <Button size="dense" tone="secondary" onClick={discard} disabled={busy}>
          Discard
        </Button>
        {reset ? (
          <Button tone="quiet" onClick={reset} disabled={busy}>
            Back to the built-in wiring
          </Button>
        ) : null}
      </div>
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
