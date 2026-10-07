/**
 * The canvas's editor, n8n-style (designs/2026-10-06-workflow-editor.md, Edit like n8n): a
 * palette of logic nodes, triggers, parts and workflows to drag on or add with `/`; a node panel
 * with its settings, test, copy, last output, numbers and wires; a wire panel with its rule and
 * wait; and the bar that counts the draft's changes and what won't run. Desktop only.
 */
import { DOOR_TRIGGERS, UNTIL_WORDS, untilOf } from "@wren/core/logic";
import type { RecordAnswer, RecordsPage } from "@wren/core/records/serve";
import type { Wire } from "@wren/core/workflows";
import {
  Button,
  cx,
  Dictate,
  GRAPH_DROP,
  type GraphNode,
  Icon,
  Input,
  StateMark,
  Tag,
} from "@wren/ui";
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { call } from "../../api.js";
import { useCall } from "../../load.js";
import type { Drawn } from "../marketplace/boxes.js";
import { FIELD, QUIET, SELECT } from "../work/bits.js";
import { boxOf, roleOfPart } from "./canvas.js";
import { DoorBlock, FieldMapForm, type Fresh } from "./doors.js";
import { copyOf } from "./playback.js";
import { dataText } from "./trace.js";
import {
  type Draft,
  endText,
  type Palette,
  type PaletteItem,
  type PaletteLogic,
  settingSet,
  type With,
  withoutStep,
  withSet,
} from "./wiring.js";

const WAIT = /^\d+ (minute|hour|day|week)s?$/;
/** A panel floats over the canvas's edge, n8n-style, and scrolls inside. */
export const PANEL =
  "absolute top-3 z-10 grid max-h-[calc(100%-24px)] min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-5 overflow-x-hidden overflow-y-auto border border-(--ui-hair) bg-(--ui-paper) p-4 text-[13.5px] shadow-(--ui-shadow)";
const LEFT = "left-3 w-[280px]";
export const RIGHT = "right-3 w-[360px]";
const HEAD = "text-[11.5px] font-semibold tracking-[0.04em] text-(--ui-ink-3) uppercase";
export const PRE =
  "m-0 max-h-[220px] overflow-auto bg-(--ui-tile) p-2.5 font-mono text-[11.5px] leading-[1.5] whitespace-pre-wrap text-(--ui-ink)";
const ROLE_TINT: Record<string, string> = {
  trigger: "oklch(0.64 0.15 150)",
  channel: "oklch(0.6 0.15 255)",
  logic: "oklch(0.7 0.14 75)",
  ai: "oklch(0.6 0.16 300)",
  data: "oklch(0.62 0.1 200)",
  deliver: "oklch(0.62 0.15 30)",
};

export function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-2">
      <h3 className={HEAD}>{title}</h3>
      {children}
    </section>
  );
}

/** One thing to add: its tile, name and line; dragged onto the canvas or clicked. */
function Item({
  id,
  name,
  blurb,
  ready,
  effects,
  active,
  onAdd,
}: {
  id: string;
  name: string;
  blurb: string;
  ready: boolean;
  effects: readonly string[];
  active: boolean;
  onAdd: (id: string) => void;
}) {
  const hue = ROLE_TINT[roleOfPart(id)] ?? ROLE_TINT.logic;
  return (
    <li>
      <button
        type="button"
        draggable={ready}
        disabled={!ready}
        onDragStart={(e) => {
          e.dataTransfer.setData(GRAPH_DROP, id);
          e.dataTransfer.effectAllowed = "copy";
        }}
        onClick={() => onAdd(id)}
        className={cx(
          "flex w-full cursor-grab items-start gap-2.5 border-0 bg-transparent px-2 py-2 text-left hover:bg-(--ui-hover) disabled:cursor-not-allowed disabled:opacity-55",
          active && "bg-(--ui-hover)",
        )}
        title={ready ? `Drag onto the canvas, or click to add` : "In development"}
      >
        <span
          aria-hidden="true"
          className="mt-0.5 size-6 shrink-0 rounded-[6px]"
          style={{ background: `color-mix(in oklch, ${hue} 22%, var(--ui-paper))` }}
        />
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="flex items-center gap-2 text-[13px] font-semibold text-(--ui-ink)">
            <span className="truncate">{name}</span>
            {!ready ? <Tag>In development</Tag> : null}
            {effects.length ? <Tag tone="accent">{effects.join(", ")}</Tag> : null}
          </span>
          <span className="line-clamp-2 text-[12px] leading-[1.4] text-(--ui-ink-2)">{blurb}</span>
        </span>
      </button>
    </li>
  );
}

type Entry = { id: string; name: string; blurb: string; ready: boolean; effects: string[] };
const fromLogic = (l: PaletteLogic): Entry => ({ ...l, effects: [] });
const fromItem = (p: PaletteItem): Entry => ({
  id: p.id,
  name: p.name,
  blurb: p.blurb,
  ready: p.ready !== "planned",
  effects: p.effects,
});

/**
 * The palette: triggers, logic, parts and workflows. `/` opens it with the search focused;
 * Enter adds the first match, Escape closes it.
 */
export function PaletteDrawer({
  palette,
  onAdd,
  onClose,
}: {
  palette: Palette;
  onAdd: (id: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => box.current?.focus(), []);
  const groups = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const hit = (e: Entry) =>
      words.every((w) => `${e.name} ${e.blurb} ${e.id}`.toLowerCase().includes(w));
    return (
      [
        ["Triggers", palette.logic.filter((l) => l.group === "trigger").map(fromLogic)],
        ["Logic", palette.logic.filter((l) => l.group === "logic").map(fromLogic)],
        ["Parts", palette.parts.map(fromItem)],
        ["Workflows", palette.workflows.map(fromItem)],
      ] as const
    )
      .map(([title, list]) => [title, list.filter(hit)] as const)
      .filter(([, list]) => list.length);
  }, [palette, q]);
  const first = groups.flatMap(([, l]) => l).find((e) => e.ready);
  return (
    <aside aria-label="Add a node" className={cx(PANEL, LEFT, "gap-3 p-3")}>
      <div className="flex items-center gap-2">
        <span className="relative flex-1">
          <Icon
            name="search"
            size={14}
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-(--ui-ink-3)"
          />
          <Input
            ref={box}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "Enter" && first) onAdd(first.id);
            }}
            placeholder="Search nodes"
            aria-label="Search nodes"
            className="h-8 pl-8 text-[13px]"
          />
        </span>
        <Button tone="quiet" size="dense" onClick={onClose} aria-label="Close">
          <Icon name="close" />
        </Button>
      </div>
      <p className={`text-[12px] ${QUIET}`}>Drag one onto the canvas, or click it.</p>
      {groups.length ? (
        groups.map(([title, list]) => (
          <Block key={title} title={title}>
            <ul className="m-0 -mx-1 grid list-none gap-0.5 p-0">
              {list.map((e) => (
                <Item key={e.id} {...e} active={e === first && !!q} onAdd={onAdd} />
              ))}
            </ul>
          </Block>
        ))
      ) : (
        <p className={QUIET}>Nothing matches.</p>
      )}
    </aside>
  );
}

/**
 * The draft's state, over the canvas: its changes against what's live, whether it's kept, what
 * won't run, and its buttons.
 */
export function EditBar({
  changes,
  problems,
  note,
  children,
}: {
  changes: number;
  problems: readonly string[];
  note?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-3 border border-(--ui-hair) bg-(--ui-paper) px-3 py-2 text-[13.5px]">
      <StateMark
        state={
          changes
            ? { label: `Draft: ${changes} change${changes > 1 ? "s" : ""}`, tone: "warn" }
            : { label: "No changes", tone: "neutral" }
        }
      />
      {note ? <span className={`text-[12.5px] ${QUIET}`}>{note}</span> : null}
      {problems.length ? (
        <details className="relative">
          <summary className="cursor-pointer text-(--ui-bad)">{problems.length} won't run</summary>
          <ul className="absolute z-20 mt-1 grid w-[360px] list-disc gap-1 border border-(--ui-hair) bg-(--ui-paper) py-2 pr-3 pl-7 text-[12.5px] shadow-(--ui-shadow)">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </details>
      ) : null}
      <span className="ml-auto flex flex-wrap items-center gap-2">{children}</span>
    </div>
  );
}

/** A wire's rule and wait, as the panel and the wire list edit them. */
function WireFields({ x, set }: { x: Wire; set: (k: "when" | "wait", v: string) => void }) {
  const bad = !!x.wait && !WAIT.test(x.wait.trim());
  return (
    <div className="grid gap-2">
      <label className={FIELD}>
        <span>Only if (in words)</span>
        <Input
          value={x.when ?? ""}
          maxLength={300}
          placeholder="Every event"
          onChange={(e) => set("when", e.target.value)}
        />
      </label>
      <label className={FIELD}>
        <span>Wait</span>
        <Input
          value={x.wait ?? ""}
          maxLength={40}
          placeholder="None"
          aria-invalid={bad}
          onChange={(e) => set("wait", e.target.value)}
        />
      </label>
      {bad ? (
        <p className="text-[12.5px] text-(--ui-bad)">A wait reads like "2 days" or "6 hours".</p>
      ) : null}
    </div>
  );
}

/** The draft with wire `i`'s rule or wait set, or cleared when empty. */
export const wireSet = (d: Draft, i: number, k: "when" | "wait", v: string): Draft => ({
  ...d,
  wires: d.wires.map((x, j) => {
    if (j !== i) return x;
    const { [k]: _, ...rest } = x;
    return v ? { ...rest, [k]: v } : rest;
  }),
});

/** The panel for a picked wire: what it joins, its rule and wait, and Remove. */
export function WirePanel({
  w,
  draft,
  setDraft,
  from,
  to,
  onClose,
}: {
  w: Drawn;
  draft: Draft;
  setDraft: (d: Draft) => void;
  from: string;
  to: string;
  onClose: () => void;
}) {
  const at = draft.wires
    .map((x, i) => [x, i] as const)
    .filter(([x]) => boxOf(x.from) === from && boxOf(x.to) === to);
  const built = w.wires.filter(
    (x) => x.via === "code" && boxOf(x.from) === from && boxOf(x.to) === to,
  );
  return (
    <aside aria-label="Wire" className={cx(PANEL, RIGHT)}>
      <PanelHead title="Wire" kind="Between two nodes" onClose={onClose} />
      {built.map((x) => (
        <p key={`${x.from}>${x.to}`} className={QUIET}>
          {endText(w, x.from, "from")} → {endText(w, x.to, "to")}. Built in: the part's own code
          moves it.
        </p>
      ))}
      {at.map(([x, i]) => (
        <Block
          key={`${x.from}>${x.to}`}
          title={`${endText(w, x.from, "from")} → ${endText(w, x.to, "to")}`}
        >
          <WireFields x={x} set={(k, v) => setDraft(wireSet(draft, i, k, v))} />
          <span>
            <Button
              tone="quiet"
              size="dense"
              onClick={() => {
                setDraft({ ...draft, wires: draft.wires.filter((_, j) => j !== i) });
                onClose();
              }}
            >
              Remove wire
            </Button>
          </span>
        </Block>
      ))}
    </aside>
  );
}

export function PanelHead({
  title,
  kind,
  state,
  onClose,
}: {
  title: string;
  kind: string;
  state?: GraphNode["state"];
  onClose: () => void;
}) {
  return (
    <header className="flex items-start gap-3">
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="truncate text-[16px] font-semibold text-(--ui-ink)">{title}</span>
        <span className={`text-[12.5px] ${QUIET}`}>{kind}</span>
      </span>
      {state ? (
        <StateMark
          state={{
            label: state.label,
            tone:
              state.tone === "bad"
                ? "bad"
                : state.tone === "warn"
                  ? "warn"
                  : state.tone === "good"
                    ? "good"
                    : "neutral",
          }}
        />
      ) : null}
      <Button tone="quiet" size="dense" onClick={onClose} aria-label="Close">
        <Icon name="close" />
      </Button>
    </header>
  );
}

/** What a trigger hears, said once in its panel. */
const TRIGGER_NOTE: Readonly<Record<string, string>> = {
  "trigger.schedule":
    "Fires at each slot once published. Clients keep no time zone yet, so it's set here.",
  "trigger.form": "Each post enters once per email. Its URL comes with Publish.",
  "trigger.reply":
    "Fires when a lead replies to an email, a text or a DM. A lead enters once. A STOP never fires it.",
  "trigger.booking":
    "Fires on each cal.com booking, move or cancel, by the booking webhook. Who booked rides along.",
};

/** What a Wait until an event does with a late one, said once in its panel. */
function untilNote(n: { uses?: string | null; with?: With | undefined }): string | null {
  const u = untilOf(n);
  if (!u) return null;
  return `Each event leaves once: when ${UNTIL_WORDS[u.until]} about it comes, or after ${u.most}. Anything later does nothing.`;
}

/**
 * A logic node's settings as a form, only those its mode uses. A built-in logic node's change
 * goes in the save; a trigger's is read only when it's the code's.
 */
function LogicForm({
  logic,
  values,
  set,
}: {
  logic: PaletteLogic;
  values: With;
  set: ((field: string, v: string | number) => void) | null;
}) {
  const base = useId();
  const now = (field: string) =>
    values[field] ?? logic.settings.find((s) => s.field === field)?.start ?? "";
  return (
    <div className="grid gap-2.5">
      {logic.settings.map((s) => {
        if (s.shows && Object.entries(s.shows).some(([f, want]) => String(now(f)) !== want)) {
          return null;
        }
        const v = s.shows ? now(s.field) : (values[s.field] ?? "");
        const at = `${base}-${s.field}`;
        return (
          <label key={s.field} htmlFor={at} className={FIELD}>
            <span>{s.label}</span>
            {s.type === "choice" ? (
              <select
                id={at}
                className={SELECT}
                value={String(v)}
                disabled={!set}
                onChange={(e) => set?.(s.field, e.target.value)}
              >
                {v === "" ? <option value="">Pick one</option> : null}
                {(s.options ?? []).map((o) => (
                  <option key={o} value={o}>
                    {s.labels?.[o] ?? o}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                id={at}
                type={s.type === "number" ? "number" : "text"}
                value={String(v)}
                readOnly={!set}
                placeholder={s.hint}
                onChange={(e) =>
                  set?.(
                    s.field,
                    s.type === "number" && e.target.value !== ""
                      ? Number(e.target.value)
                      : e.target.value,
                  )
                }
              />
            )}
          </label>
        );
      })}
    </div>
  );
}

type EventDetail = {
  data: Record<string, unknown>;
  sent: { port: string; subject: string; data: unknown }[] | null;
  sentAt: string | null;
};

/** The node's last event on the spine, read once per node and shared. */
export function useLast(workflow: string, node: string) {
  return useCall(`node-last:${workflow}:${node}`, async () => {
    const page = await call<RecordsPage>("console/recordsList", {
      record: "console.event",
      view: "all",
      where: { workflow, node },
      limit: 1,
    });
    const row = page.rows[0] as { id?: string; at?: string } | undefined;
    if (!row?.id) return null;
    const a = await call<RecordAnswer>("console/recordsGet", {
      record: "console.event",
      id: row.id,
    });
    return {
      at: row.at ?? null,
      ...((a.detail as EventDetail | null) ?? { data: {}, sent: null, sentAt: null }),
    };
  });
}

/** The node's last event on the spine: what came in, and what its step sent on. */
function LastOutput({ workflow, node }: { workflow: string; node: string }) {
  const got = useLast(workflow, node);
  if (got.error) return <p className={QUIET}>Couldn't read it: {got.error.message}</p>;
  if (!got.data)
    return got.loading ? (
      <p className={QUIET}>Reading…</p>
    ) : (
      <p className={QUIET}>Nothing has reached it yet.</p>
    );
  const d = got.data;
  return (
    <div className="grid gap-2">
      <span className={`text-[12px] ${QUIET}`}>
        In{d.at ? `, ${new Date(d.at).toLocaleString()}` : ""}
      </span>
      <pre className={PRE}>{dataText(d.data, 3000)}</pre>
      <span className={`text-[12px] ${QUIET}`}>Out</span>
      {d.sent?.length ? (
        <pre className={PRE}>{dataText(d.sent, 3000)}</pre>
      ) : (
        <p className={QUIET}>Nothing sent on.</p>
      )}
    </div>
  );
}

function Copy({ w, node, client }: { w: Drawn; node: string; client: string | null }) {
  const got = useCall(`node-copy:${client ?? ""}:${w.id}:${node}`, () => copyOf(w, node, client));
  if (!got.data)
    return got.loading ? (
      <p className={QUIET}>Reading…</p>
    ) : (
      <p className={QUIET}>No copy on this node.</p>
    );
  return (
    <div className="grid gap-2">
      {got.data.words ? (
        <pre className={PRE}>{got.data.words}</pre>
      ) : (
        <p className={QUIET}>No live version yet.</p>
      )}
      <a
        className="w-fit text-[13px] text-(--ui-ink) underline"
        href={`/library/templates/${encodeURIComponent(got.data.template)}`}
      >
        Edit copy in Templates
      </a>
    </div>
  );
}

const KIND_OF = (n: Drawn["nodes"][number], logic: PaletteLogic | undefined) =>
  logic
    ? logic.group === "trigger"
      ? "Trigger"
      : "Logic"
    : !n.uses
      ? "Custom step"
      : n.opens === n.uses
        ? "Workflow"
        : "Part";

/**
 * The panel for a picked node: what it is, its settings, its copy, its last output and 30-day
 * numbers, its wires with their rules and waits, and Remove when the draft added it.
 */
export function NodePanel({
  w,
  id,
  draft,
  setDraft,
  palette,
  node,
  client,
  workflow,
  onOpenPart,
  onClose,
  test,
  mayManage = false,
  fresh,
}: {
  w: Drawn;
  id: string;
  draft: Draft | null;
  setDraft: (d: Draft) => void;
  palette: Palette;
  node: GraphNode | undefined;
  client: string | null;
  workflow: string;
  onOpenPart: (uses: string) => void;
  onClose: () => void;
  /** Test step, while editing: this node on one event, dry. */
  test?: ReactNode;
  /** May see a door's whole token and rotate it: `manage` on Workflows. */
  mayManage?: boolean;
  /** Tokens the last publish made, shown once. */
  fresh?: Fresh;
}) {
  const n = w.nodes.find((x) => x.id === id);
  if (!n) return null;
  const logic = palette.logic.find((l) => l.id === n.uses);
  const item = [...palette.parts, ...palette.workflows].find((p) => p.id === n.uses);
  const added = draft?.steps.find((s) => s.id === id);
  const wires = (draft?.wires ?? [])
    .map((x, i) => [x, i] as const)
    .filter(([x]) => boxOf(x.from) === id || boxOf(x.to) === id);
  return (
    <aside aria-label={n.name} className={cx(PANEL, RIGHT)}>
      <PanelHead title={n.name} kind={KIND_OF(n, logic)} state={node?.state} onClose={onClose} />
      {logic?.blurb || item?.blurb || n.note ? (
        <p className={QUIET}>{logic?.blurb ?? item?.blurb ?? n.note}</p>
      ) : null}
      {item?.effects.length ? (
        <p className="text-[13px]">
          It {item.effects.join(" and ")}. Making it live is an admin's yes.
        </p>
      ) : null}

      <Block title="Settings">
        {logic ? (
          <LogicForm
            logic={logic}
            values={n.with ?? {}}
            set={
              !draft
                ? null
                : added
                  ? (f, v) => setDraft(withSet(draft, id, f, v))
                  : n.uses?.startsWith("logic.")
                    ? (f, v) => setDraft(settingSet(draft, id, n.with ?? {}, f, v))
                    : null
            }
          />
        ) : n.uses ? (
          <p className={QUIET}>
            Its settings are the part's own, shared by every workflow it's in.{" "}
            <button
              type="button"
              className="cursor-pointer border-0 bg-transparent p-0 text-(--ui-ink) underline"
              onClick={() => onOpenPart(n.uses as string)}
            >
              Open its settings
            </button>
          </p>
        ) : (
          <p className={QUIET}>A custom step posts each event to its URL.</p>
        )}
      </Block>

      {TRIGGER_NOTE[n.uses ?? ""] || untilNote(n) ? (
        <p className={cx("text-[13px]", QUIET)}>{TRIGGER_NOTE[n.uses ?? ""] ?? untilNote(n)}</p>
      ) : null}

      {DOOR_TRIGGERS.has(n.uses ?? "") ? (
        <>
          <Block title="Field map">
            {n.uses === "trigger.form" && n.with?.form === "site" ? (
              <p className={QUIET}>
                Our site's forms post their own shape, so there's nothing to map. Put the door URL
                in the site's WREN_DOOR_URL.
              </p>
            ) : (
              <FieldMapForm
                values={n.with ?? {}}
                set={added && draft ? (f, v) => setDraft(withSet(draft, id, f, v)) : null}
              />
            )}
          </Block>
          <Block title="Door">
            <DoorBlock
              workflow={workflow}
              client={client}
              node={id}
              mayManage={mayManage}
              {...(fresh ? { fresh } : {})}
            />
          </Block>
        </>
      ) : null}

      {test ? <Block title="Test step">{test}</Block> : null}

      {n.uses && !logic ? (
        <Block title="Copy">
          <Copy w={w} node={id} client={client} />
        </Block>
      ) : null}

      {client ? null : (
        <Block title="Last output">
          <LastOutput workflow={workflow} node={id} />
        </Block>
      )}

      {node?.number || node?.more ? (
        <Block title="Last 30 days">
          {[node.number, node.more].map((x) =>
            x ? (
              <p key={x.label} className="tabular-nums">
                <b className="font-semibold">{x.value.toLocaleString("en-US")}</b> {x.label}
                {x.today ? <span className={QUIET}> · {x.today} today</span> : null}
              </p>
            ) : null,
          )}
        </Block>
      ) : null}

      {draft ? (
        <Block title="Wires">
          {wires.length ? (
            wires.map(([x, i]) => (
              <div
                key={`${x.from}>${x.to}`}
                className="grid gap-2 border-t border-(--ui-hair) pt-2"
              >
                <span className="text-[13px] font-medium">
                  {endText(w, x.from, "from")} → {endText(w, x.to, "to")}
                </span>
                <WireFields x={x} set={(k, v) => setDraft(wireSet(draft, i, k, v))} />
              </div>
            ))
          ) : (
            <p className={QUIET}>Not wired. Drag from a dot to another of the same color.</p>
          )}
        </Block>
      ) : null}

      {added && draft ? (
        <span>
          <Button
            tone="secondary"
            size="dense"
            onClick={() => {
              setDraft(withoutStep(draft, id));
              onClose();
            }}
          >
            Remove node
          </Button>
        </span>
      ) : null}
    </aside>
  );
}

type Answer =
  | { state: "thinking" }
  | { state: "failed"; error: string }
  | { state: "done"; reply: string; patch: Draft | null };

/**
 * Ask Claude on the graph: he says what to change, the desk's Claude answers with the next draft,
 * and the canvas shows it as a diff to accept or not. Polls every 2 s while Claude thinks.
 */
export function AskGraph({
  workflow,
  client,
  draft,
  onAnswer,
}: {
  workflow: string;
  client: string | null;
  draft: Draft;
  onAnswer: (reply: string, patch: Draft | null) => void;
}) {
  const [message, setMessage] = useState("");
  const askBox = useRef<HTMLInputElement>(null);
  const [run, setRun] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!run) return;
    let live = true;
    const ask = async () => {
      const a = await call<Answer>("console/workflowAnswer", { id: run }).catch((e: Error) => ({
        state: "failed" as const,
        error: e.message,
      }));
      if (!live || a.state === "thinking") return;
      setRun(null);
      if (a.state === "failed") setError(a.error);
      else {
        setMessage("");
        onAnswer(a.reply, a.patch);
      }
    };
    const timer = setInterval(() => void ask(), 2000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [run, onAnswer]);
  return (
    <form
      className="flex min-w-[280px] flex-1 items-center gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!message.trim()) return;
        setError(null);
        try {
          const got = await call<{ id: string }>("console/workflowAsk", {
            workflow,
            ...(client ? { client } : {}),
            message: message.trim(),
            wires: draft.wires,
            steps: draft.steps,
          });
          setRun(got.id);
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }}
    >
      <Input
        ref={askBox}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        maxLength={2000}
        disabled={!!run}
        placeholder="Ask Claude: add a text 2 days after the second email if no reply"
        aria-label="Ask Claude to change the workflow"
        className="h-8 flex-1 text-[13px]"
      />
      <Dictate target={askBox} label="Dictate to Claude" />
      <Button type="submit" tone="secondary" size="dense" busy={!!run}>
        {run ? "Thinking" : "Ask"}
      </Button>
      {error ? <span className="text-[12.5px] text-(--ui-bad)">{error}</span> : null}
    </form>
  );
}

/** Claude's answer over the canvas: what it says, and Accept or Reject when it changed the graph. */
export function Proposal({
  reply,
  changes,
  onAccept,
  onReject,
}: {
  reply: string;
  changes: number | null;
  onAccept: () => void;
  onReject: () => void;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-start gap-3 border border-(--ui-accent) bg-(--ui-paper) px-3 py-2.5 text-[13.5px]">
      <span className="grid min-w-0 flex-1 gap-1">
        <span className="font-semibold">Claude</span>
        <span className="whitespace-pre-wrap text-(--ui-ink-2)">{reply || "Done."}</span>
        {changes !== null ? (
          <span className={`text-[12.5px] ${QUIET}`}>
            {changes} change{changes === 1 ? "" : "s"} on the canvas: green added, red removed.
          </span>
        ) : null}
      </span>
      {changes !== null ? (
        <span className="flex gap-2">
          <Button size="dense" onClick={onAccept}>
            Accept
          </Button>
          <Button tone="secondary" size="dense" onClick={onReject}>
            Reject
          </Button>
        </span>
      ) : (
        <Button tone="quiet" size="dense" onClick={onReject}>
          Close
        </Button>
      )}
    </div>
  );
}

export interface Version {
  id: number;
  edits: Draft | null;
  by: string;
  at: string;
}

/** A template saved from this workflow's live wiring. */
export interface SavedTemplate {
  id: string;
  name: string;
  at: string | null;
}

/** Where a saved template installs: the Marketplace, on this client when there is one. */
const shopHref = (id: string, client: string | null) =>
  `/marketplace/catalog/${encodeURIComponent(id)}${client ? `?client=${encodeURIComponent(client)}` : ""}`;

/**
 * Save as template: what's live, under a name, sold in the Marketplace and listed in the Library.
 * It starts nothing; installing it on a client is the Marketplace's path, approved in To approve.
 */
function SaveTemplate({
  workflow,
  client,
  name,
  forClients,
  published,
  templates,
  mayManage,
  onSaved,
}: {
  workflow: string;
  client: string | null;
  name: string;
  forClients: boolean;
  published: boolean;
  templates: readonly SavedTemplate[];
  mayManage: boolean;
  onSaved: () => void;
}) {
  const base = useId();
  const [title, setTitle] = useState("");
  const [blurb, setBlurb] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: string; name: string; updated: boolean } | null>(null);
  const why = !forClients
    ? "It runs Wren's own business, so no client can install it."
    : !published
      ? "Publish it first. A template is the live wiring."
      : !mayManage
        ? "Saving a template takes manage on Workflows."
        : null;
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const got = await call<{ id: string; name: string; updated: boolean }>(
        "console/workflowTemplateSave",
        { workflow, name: title, blurb, ...(client ? { client } : {}) },
      );
      setDone(got);
      setTitle("");
      setBlurb("");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setBusy(false);
  };
  return (
    <section
      aria-label="Save as template"
      className="grid gap-2 border-t border-(--ui-hair) px-1 pt-2"
    >
      <span className="font-medium">Save as template</span>
      {why ? (
        <p className={`m-0 text-[12.5px] ${QUIET}`}>{why}</p>
      ) : (
        <>
          <p className={`m-0 text-[12.5px] ${QUIET}`}>
            Saves the live version, not this draft. Clients install it from the Marketplace, and it
            goes live only after To approve.
          </p>
          <label htmlFor={`${base}-name`} className="grid gap-1">
            <span className="text-[12.5px] text-(--ui-ink-2)">Name</span>
            <Input
              id={`${base}-name`}
              value={title}
              maxLength={80}
              placeholder={name}
              onChange={(e) => setTitle(e.target.value)}
              className="h-8"
            />
          </label>
          <label htmlFor={`${base}-blurb`} className="grid gap-1">
            <span className="text-[12.5px] text-(--ui-ink-2)">What it does (optional)</span>
            <Input
              id={`${base}-blurb`}
              value={blurb}
              maxLength={300}
              onChange={(e) => setBlurb(e.target.value)}
              className="h-8"
            />
          </label>
          <span>
            <Button size="dense" busy={busy} disabled={title.trim().length < 2} onClick={save}>
              Save as template
            </Button>
          </span>
          {error ? <p className="m-0 text-[12.5px] text-(--ui-bad)">{error}</p> : null}
          {done ? (
            <p className="m-0 text-[12.5px]">
              {done.updated ? "Updated" : "Saved"}.{" "}
              <a className="underline" href={shopHref(done.id, client)}>
                Install {done.name} on a client
              </a>
            </p>
          ) : null}
        </>
      )}
      {templates.length ? (
        <div className="grid gap-1 text-[12.5px]">
          <span className={QUIET}>Saved from this workflow</span>
          {templates.map((t) => (
            <a key={t.id} className="underline" href={shopHref(t.id, client)}>
              {t.name}
            </a>
          ))}
        </div>
      ) : null}
    </section>
  );
}

/** History: each live version, newest first; one opens as the draft to publish again. */
export function HistoryMenu({
  versions,
  onOpen,
  save,
}: {
  versions: readonly Version[];
  onOpen: (v: Version) => void;
  save: {
    workflow: string;
    client: string | null;
    name: string;
    forClients: boolean;
    templates: readonly SavedTemplate[];
    mayManage: boolean;
    onSaved: () => void;
  };
}) {
  return (
    <details className="relative">
      <summary className="cursor-pointer list-none border border-(--ui-hair) px-2.5 py-1 text-[13px] text-(--ui-ink) hover:bg-(--ui-hover)">
        History
      </summary>
      <div className="absolute right-0 z-30 mt-1 grid w-[320px] gap-1 border border-(--ui-hair) bg-(--ui-paper) p-2 text-[13px] shadow-(--ui-shadow)">
        {versions.length ? (
          versions.map((v, i) => (
            <div key={v.id} className="flex items-center gap-2 px-1 py-1">
              <span className="min-w-0 flex-1">
                <span className="font-medium">{i === 0 ? "Live" : `Version ${v.id}`}</span>
                <span className={QUIET}>
                  {" "}
                  · {v.by}, {new Date(v.at).toLocaleDateString()}
                  {v.edits ? "" : " · built-in"}
                </span>
              </span>
              {i === 0 ? null : (
                <Button tone="quiet" size="dense" onClick={() => onOpen(v)}>
                  Open
                </Button>
              )}
            </div>
          ))
        ) : (
          <p className={`px-1 ${QUIET}`}>Never published: the built-in wiring runs.</p>
        )}
        <SaveTemplate {...save} published={versions.length > 0} />
      </div>
    </details>
  );
}
