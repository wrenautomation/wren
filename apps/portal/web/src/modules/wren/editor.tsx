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
  ACTIONS,
  Button,
  cx,
  DictateField,
  FLOAT_PANEL,
  FormKept,
  type GraphNode,
  PaletteDrawer as GraphPalette,
  Icon,
  Input,
  LoadFailed,
  type PaletteEntry,
  type PaletteGroup,
  PanelBlock,
  StateMark,
  TextField,
  tipProps,
  useEdit,
  useEditForm,
} from "@wren/ui";
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { call } from "../../api.js";
import { useCall } from "../../load.js";
import { shown } from "../../pulse.js";
import type { Drawn } from "../marketplace/boxes.js";
import { FIELD, QUIET, SELECT } from "../work/bits.js";
import { boxOf, roleOfPart } from "./canvas.js";
import { DoorBlock, FieldMapForm, type Fresh } from "./doors.js";
import { LogicForm, TRIGGER_NOTE } from "./logic-form.js";
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
export const PANEL = FLOAT_PANEL;
export const RIGHT = "right-3 w-[360px]";
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

export const Block = PanelBlock;

const tintOf = (id: string) => ROLE_TINT[roleOfPart(id)] ?? ROLE_TINT.logic ?? "";
const fromLogic = (l: PaletteLogic): PaletteEntry => ({
  id: l.id,
  name: l.name,
  blurb: l.blurb,
  ready: l.ready,
  effects: l.effects,
  tint: tintOf(l.id),
});
const fromItem = (p: PaletteItem): PaletteEntry => ({
  id: p.id,
  name: p.name,
  blurb: p.blurb,
  ready: p.ready !== "planned",
  effects: p.effects,
  tint: tintOf(p.id),
});

/** What a workflow may add, in the palette's groups. */
export const groupsOf = (palette: Palette): PaletteGroup[] => [
  { title: "Triggers", entries: palette.logic.filter((l) => l.group === "trigger").map(fromLogic) },
  { title: "Logic", entries: palette.logic.filter((l) => l.group === "logic").map(fromLogic) },
  { title: "Actions", entries: palette.logic.filter((l) => l.group === "action").map(fromLogic) },
  { title: "Parts", entries: palette.parts.map(fromItem) },
  { title: "Workflows", entries: palette.workflows.map(fromItem) },
];

/** The workflow editor's palette: triggers, logic, parts and workflows (the kit's drawer). */
export function PaletteDrawer({
  palette,
  onAdd,
  onClose,
}: {
  palette: Palette;
  onAdd: (id: string) => void;
  onClose: () => void;
}) {
  const groups = useMemo(() => groupsOf(palette), [palette]);
  return <GraphPalette groups={groups} onAdd={onAdd} onClose={onClose} />;
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
function WireFields({
  x,
  set,
  editKey,
}: {
  x: Wire;
  set: (k: "when" | "wait", v: string) => void;
  /** The draft's save key: the draft keeps these words. */
  editKey: string;
}) {
  const bad = !!x.wait && !WAIT.test(x.wait.trim());
  return (
    <div className="grid gap-2">
      <label className={FIELD}>
        <span>Only if (in words)</span>
        <Input
          data-edit={editKey}
          value={x.when ?? ""}
          maxLength={300}
          placeholder="Every event"
          onChange={(e) => set("when", e.target.value)}
        />
      </label>
      <label className={FIELD}>
        <span>Wait</span>
        <Input
          data-edit={editKey}
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
const wireSet = (d: Draft, i: number, k: "when" | "wait", v: string): Draft => ({
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
  editKey,
}: {
  w: Drawn;
  draft: Draft;
  setDraft: (d: Draft) => void;
  from: string;
  to: string;
  onClose: () => void;
  /** The draft's save key. */
  editKey: string;
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
          <WireFields x={x} set={(k, v) => setDraft(wireSet(draft, i, k, v))} editKey={editKey} />
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
        <span className="wrap-anywhere whitespace-normal text-[16px] font-semibold text-(--ui-ink)">
          {title}
        </span>
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
      <Button
        tone="quiet"
        size="dense"
        onClick={onClose}
        aria-label="Close"
        {...tipProps("Close", { as: "none" })}
      >
        <Icon name="close" />
      </Button>
    </header>
  );
}

/** What a Wait until an event does with a late one, said once in its panel. */
function untilNote(n: { uses?: string | null; with?: With | undefined }): string | null {
  const u = untilOf(n);
  if (!u) return null;
  return `Each event leaves once: when ${UNTIL_WORDS[u.until]} about it comes, or after ${u.most}. Anything later does nothing.`;
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
  if (got.error) return <LoadFailed error={got.error} onRetry={got.retry} what="event" />;
  if (!got.data)
    return got.pending || got.placeholder ? (
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
    return got.pending || got.placeholder ? (
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
      : logic.group === "action"
        ? "Action"
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
  editKey,
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
  /** The draft's save key. */
  editKey: string;
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
      {(logic ?? item)?.effects.length ? (
        <p className="text-[13px]">
          It {(logic ?? item)?.effects.join(" and ")}. Making it live is an admin's yes.
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
                <WireFields
                  x={x}
                  set={(k, v) => setDraft(wireSet(draft, i, k, v))}
                  editKey={editKey}
                />
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
  pending = null,
}: {
  workflow: string;
  client: string | null;
  draft: Draft;
  onAnswer: (reply: string, patch: Draft | null) => void;
  /** An ask already open (the builder's first): its answer is waited on at once. */
  pending?: string | null;
}) {
  const ask = useEdit(`workflow-ask:${client ?? "own"}:${workflow}:message`, "");
  const message = ask.value;
  // Read live by the poll below, which must not restart on every render.
  const asked = useRef(ask.saved);
  asked.current = ask.saved;
  const askBox = useRef<HTMLInputElement>(null);
  const [run, setRun] = useState<string | null>(pending);
  const [error, setError] = useState<string | null>(null);
  // read-ok: waits on one ask's answer (a poll that ends), not a list to keep.
  useEffect(() => {
    if (!run) return;
    let live = true;
    const poll = async () => {
      const a = await call<Answer>("console/workflowAnswer", { id: run }).catch((e: Error) => ({
        state: "failed" as const,
        error: e.message,
      }));
      if (!live || a.state === "thinking") return;
      setRun(null);
      if (a.state === "failed") setError(a.error);
      else {
        asked.current();
        onAnswer(a.reply, a.patch);
      }
    };
    const timer = setInterval(() => shown() && void poll(), 2000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [run, onAnswer]);
  return (
    <form
      className="flex min-w-[280px] flex-1 items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!message.trim() || run) return;
        // One ask at a time: Enter twice before the first answers asks once.
        void ACTIONS.run(`workflow-ask:${client ?? ""}:${workflow}`, async () => {
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
        });
      }}
    >
      <DictateField target={askBox} line label="Dictate to Claude" className="flex-1">
        <Input
          ref={askBox}
          {...ask.field}
          maxLength={2000}
          disabled={!!run}
          placeholder="Ask Claude: add a text 2 days after the second email if no reply"
          aria-label="Ask Claude to change the workflow"
          className="h-8 text-[13px]"
        />
      </DictateField>
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
    <div className="mb-3 flex flex-wrap items-start gap-3 border border-(--ui-live) bg-(--ui-paper) px-3 py-2.5 text-[13.5px]">
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
          <Button tone="primary" size="dense" onClick={onAccept}>
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
  const form = useEditForm({
    key: `workflow-template:${client ?? "own"}:${workflow}`,
    defaults: { name: "", blurb: "" },
  });
  const [done, setDone] = useState<{ id: string; name: string; updated: boolean } | null>(null);
  const why = !forClients
    ? "It runs Wren's own business, so no client can install it."
    : !published
      ? "Publish it first. A template is the live wiring."
      : !mayManage
        ? "Saving a template takes manage on Workflows."
        : null;
  const save = form.onSend(
    (v) =>
      ACTIONS.run(`workflow-template:${client ?? ""}:${workflow}`, async (requestId) => {
        const got = await call<{ id: string; name: string; updated: boolean }>(
          "console/workflowTemplateSave",
          {
            workflow,
            name: v.name,
            blurb: v.blurb,
            ...(client ? { client } : {}),
            requestId,
          },
        );
        setDone(got);
        onSaved();
      }),
    { clear: true },
  );
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
          <TextField
            form={form}
            name="name"
            label="Name"
            maxLength={80}
            placeholder={name}
            className="grid gap-1 text-[12.5px]"
            box="h-8"
          />
          <TextField
            form={form}
            name="blurb"
            label="What it does (optional)"
            maxLength={300}
            className="grid gap-1 text-[12.5px]"
            box="h-8"
          />
          <FormKept form={form} />
          <span>
            <Button
              tone="primary"
              size="dense"
              busy={form.formState.isSubmitting}
              disabled={form.watch("name").trim().length < 2}
              onClick={() => void save()}
            >
              Save as template
            </Button>
          </span>
          {form.error ? <p className="m-0 text-[12.5px] text-(--ui-bad)">{form.error}</p> : null}
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

/**
 * Auto-retry: a step that fails past its own tries goes again on its own, after 5 min, 30 min,
 * 1 h, 3 h and 6 h, up to this many times. Saved with the draft; live once published.
 */
export function RetryPick({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (tries: number) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex items-center gap-1.5 text-[13px] text-(--ui-ink-2)">
      Auto-retry
      <select
        id={id}
        className={SELECT}
        value={String(value)}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        {...tipProps("A failed step tries again after 5 min, 30 min, 1 h, 3 h, then 6 h")}
      >
        <option value="0">Off</option>
        {[1, 2, 3, 4, 5].map((n) => (
          <option key={n} value={String(n)}>
            {n === 1 ? "1 try" : `${n} tries`}
          </option>
        ))}
      </select>
    </label>
  );
}

/** History: each live version, newest first; Restore opens one as the draft to publish again. */
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
                <Button
                  tone="quiet"
                  size="dense"
                  onClick={() => onOpen(v)}
                  {...tipProps("Opens it as the draft. Publish makes it live again.")}
                >
                  Restore
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
