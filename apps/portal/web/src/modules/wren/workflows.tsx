/**
 * Workflows: Wren's business drawn as its workflows. `wren` first; a stacked card opens what runs
 * inside it in place, with a trail back. Each number is the last 30 days of the record view its
 * port names, and a card with one opens those records. The team rewires one here: drag an output
 * onto an input, set a wire's condition or wait, add a custom step, save it for Wren or for the
 * client in `?client=`.
 */
import type { RecordAnswer, RecordsStat } from "@wren/core/records/serve";
import type { Wire } from "@wren/core/workflows";
import {
  Alert,
  Button,
  type FlowEdit,
  FlowMap,
  Input,
  Loading,
  PageHeader,
  Section,
  Tag,
} from "@wren/ui";
import { type FormEvent, useMemo, useState } from "react";
import { call } from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { type CountRef, countKey, countsIn, type Drawn, flowBoxes } from "../marketplace/boxes.js";
import { dayLabel, ERROR, FIELD, FORM, LIST, QUIET, SELECT, SPLIT } from "../work/bits.js";
import { WREN_APPS } from "./index.js";
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

type Detail = { workflow?: Drawn; saved?: Saved | null; broken?: string[] };

/** The first of Wren's lists over `c`'s record, on its view. */
const recordsAt = (c: CountRef) => {
  for (const m of WREN_APPS)
    for (const p of m.pages)
      if ("record" in p && p.record === c.record && p.template === "list")
        return `/${m.id}/${p.id}?view=${encodeURIComponent(c.view)}`;
  return undefined;
};

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
  const refs = w ? countsIn(w) : [];
  // A number that fails stays off its card; the drawing never waits on one.
  const counts = useCall(
    `workflow-counts:${refs.map(countKey).join(",")}`,
    async () =>
      new Map(
        (
          await Promise.all(
            refs.map((r) =>
              call<RecordsStat>("console/recordsStats", { ...r, period: DAYS, zone: ZONE }).then(
                (s) => [countKey(r), s.value ?? 0] as const,
                () => null,
              ),
            ),
          )
        ).filter((x) => x !== null),
      ),
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
        at={(n) =>
          n.opens ? canvasAt([...path, n.opens]) : n.count ? recordsAt(n.count) : undefined
        }
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

function Canvas({
  w,
  d,
  counts,
  at,
  client,
  team,
  onSaved,
}: {
  w: Drawn;
  d: Detail;
  counts: ReadonlyMap<string, number> | undefined;
  at: (n: Drawn["nodes"][number]) => string | undefined;
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

  const edit = useMemo((): FlowEdit | undefined => {
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
      <FlowMap
        boxes={flowBoxes(shown, at, counts, !!draft)}
        label={`What runs in ${w.name}`}
        edit={edit}
      />
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
        <Button busy={busy} onClick={save}>
          Save wiring
        </Button>
        <Button tone="secondary" onClick={discard} disabled={busy}>
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
