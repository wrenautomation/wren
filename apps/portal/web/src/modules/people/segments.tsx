/**
 * People > Groups (designs/2026-10-14-customerio-audit.md, B5; named Groups on 2026-10-17): named lists of people, by a
 * rule or by hand. The head makes one: describe it in words (the model writes the rule) or build
 * the rule, see how many it matches, then save. A group's page shows its rule in words, who
 * came and went, and edits it. Nothing here sends.
 */

import {
  FUNNEL_STEP_NAMES,
  FUNNEL_STEPS,
  STAT_CHANNEL_NAMES,
  STAT_CHANNELS,
} from "@wren/core/channel-stats-schema";
import { TIMELINE_KIND_NAMES, TIMELINE_KINDS, type TimelineKind } from "@wren/core/profiles-schema";
import type { SegmentDetail } from "@wren/core/segment-records";
import {
  CONSENT_CHANNELS,
  CONSENT_CONDITION_STATES,
  type Condition,
  type Group,
  type JourneyCondition,
  MESSAGE_CHANNELS,
  MESSAGE_STATES,
  type Node,
  RULE_MOST,
  type Rule,
  type SegmentVersion,
  TRAIT_OPS,
} from "@wren/core/segments";
import { parseRule, ruleText } from "@wren/core/segments-text";
import {
  ACTIONS,
  type Action,
  Button,
  EditConflict,
  Input,
  messageOf,
  type RecordAct,
  type RecordExtras,
  Tag,
  Textarea,
  UnsavedMark,
  useEdit,
} from "@wren/ui";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { call } from "../../api.js";
import { useCall } from "../../load.js";
import { type ListPage, WREN } from "../../module.js";
import { ERROR, QUIET, SELECT } from "../work/bits.js";
import { useEditJson } from "./edit-json.js";

/** The save key of the rule being edited, for the boxes deep in its tree. */
const RuleKey = createContext("");

/** Whose groups a call is about: none named is Wren's own. */
export const atOf = (client: string): Record<string, string> =>
  client === WREN.id ? {} : { client };

interface Context {
  traits: string[];
  segments: { id: number; name: string; kind: string }[];
  /** The shape: its non-source nodes by depth, and its source ids, for the journey condition. */
  shape?: {
    nodes: { id: string; name: string; kind: string; depth: number }[];
    sources: string[];
  };
  describe: boolean;
}
interface Preview {
  size: number;
  sample: { id: number; name: string }[];
  words: string;
}
interface Described {
  rule: Rule;
  name: string;
  words: string;
  unknownTraits: string[];
}
type Kind = "live" | "manual" | "snapshot";
/** What the editor starts from: a new group, or one being changed. */
export interface Start {
  id?: number;
  name: string;
  kind: Kind;
  rule: Rule | null;
  words: string | null;
  /** The version opened on: a save over a newer one is refused. */
  version?: string;
}

const KINDS: Record<Kind, string> = {
  live: "Live: updates as people change",
  snapshot: "Snapshot: who matches now, frozen",
  manual: "Manual: people you add",
};
const CONDITION_KINDS: Record<Condition["kind"], string> = {
  trait: "Trait",
  event: "Did something",
  message: "A message we sent",
  consent: "Consent",
  segment: "In a group",
  step: "Funnel step",
  journey: "A journey",
};
const JOURNEY_STATUS_LABELS: Record<string, string> = {
  "": "any status",
  open: "open",
  done: "done",
  dropped: "dropped",
};
const CONSENT_LABELS: Record<string, string> = {
  confirmed: "said yes",
  pending: "was asked, no answer yet",
  withdrawn: "took it back",
  opted_out: "texted STOP",
};
const CHANNEL_LABELS: Record<string, string> = {
  any: "any channel",
  email: "email",
  sms: "text",
  linkedin: "LinkedIn",
  reddit: "Reddit",
  x: "X",
  instagram: "Instagram",
  youtube: "YouTube",
  tiktok: "TikTok",
  facebook: "Facebook",
};
const ANCHORS: Record<string, string> = {
  "": "any time",
  ...Object.fromEntries(TIMELINE_KINDS.map((k) => [k, `their first ${TIMELINE_KIND_NAMES[k]}`])),
};
const EMPTY: Rule = { kind: "group", match: "all", of: [] };

/** A new condition of a kind, its first choices filled. */
function fresh(kind: Condition["kind"], c: Context): Condition {
  switch (kind) {
    case "trait":
      return { kind, key: c.traits[0] ?? "", op: "is", value: "" };
    case "event":
      return { kind, event: "form", atLeast: 1, days: 30 };
    case "message":
      return { kind, state: "opened", channel: "email", atLeast: 1, days: 30 };
    case "consent":
      return { kind, channel: "email", state: "confirmed" };
    case "segment":
      return { kind, segment: c.segments[0]?.id ?? 0 };
    case "step":
      return { kind, step: "replied", days: 30 };
    case "journey":
      return { kind, days: null };
  }
}

/** The rule as sent: a group still empty is left out until it holds something. */
function pruned(g: Group): Group {
  const of = g.of.flatMap((n): Node[] => {
    if (n.kind !== "group") return [n];
    const p = pruned(n);
    return p.of.length ? [p] : [];
  });
  return { ...g, of };
}

const count = (n: Node): number =>
  n.kind === "group" ? n.of.reduce((s, x) => s + count(x), 0) : 1;

const SMALL = `${SELECT} min-w-0 max-sm:w-full`;
const NUM = "w-20 max-sm:w-full";

function Pick<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Readonly<Record<string, string>>;
  onChange: (v: T) => void;
}) {
  return (
    <select
      aria-label={label}
      className={SMALL}
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
    >
      {Object.entries(options).map(([k, v]) => (
        <option key={k} value={k}>
          {v}
        </option>
      ))}
    </select>
  );
}

type Count = { atLeast: number; atMost?: number | undefined; days: number | null };
const HOW: Record<string, string> = { least: "at least", most: "at most", never: "never" };

/** "at least N times", "at most N times" or "never", in the last D days; an empty D is ever. */
function Times({ atLeast, atMost, days, set }: Count & { set: (p: Partial<Count>) => void }) {
  const how = atMost === 0 ? "never" : atMost !== undefined ? "most" : "least";
  const n = how === "most" ? (atMost ?? 1) : atLeast;
  return (
    <>
      <Pick
        label="How often"
        value={how}
        options={HOW}
        onChange={(v) =>
          set(
            v === "never"
              ? { atLeast: 0, atMost: 0 }
              : v === "most"
                ? { atLeast: 0, atMost: Math.max(1, n) }
                : { atLeast: Math.max(1, n), atMost: undefined },
          )
        }
      />
      {how === "never" ? null : (
        <>
          <Input
            aria-label="How many times"
            className={NUM}
            type="number"
            min={1}
            value={n}
            onChange={(e) => {
              const v = Math.max(1, Number(e.target.value) || 1);
              set(how === "most" ? { atMost: v } : { atLeast: v });
            }}
          />
          <span className={QUIET}>times</span>
        </>
      )}
      <span className={QUIET}>in the last</span>
      <Days days={days} set={set} />
    </>
  );
}

function Days({ days, set }: { days: number | null; set: (p: { days: number | null }) => void }) {
  return (
    <>
      <Input
        aria-label="In the last how many days (empty is ever)"
        className={NUM}
        type="number"
        min={1}
        placeholder="ever"
        value={days ?? ""}
        onChange={(e) => set({ days: e.target.value ? Math.max(1, Number(e.target.value)) : null })}
      />
      <span className={QUIET}>days</span>
    </>
  );
}

/** A journey on the shape: its node (at or past), source, status and how recently it moved. */
function JourneyEditor({
  c,
  ctx,
  set,
}: {
  c: JourneyCondition;
  ctx: Context;
  set: (p: Partial<JourneyCondition>) => void;
}) {
  const nodes = ctx.shape?.nodes ?? [];
  const sources = ctx.shape?.sources ?? [];
  return (
    <>
      <span className={QUIET}>at</span>
      <Pick
        label="Node"
        value={c.node ?? ""}
        options={{
          "": "any node",
          ...Object.fromEntries(nodes.map((n) => [n.id, n.name])),
          ...(c.node && !nodes.some((n) => n.id === c.node) ? { [c.node]: c.node } : {}),
        }}
        onChange={(v) => set({ node: v || undefined, reached: v ? c.reached : undefined })}
      />
      {c.node ? (
        <Pick
          label="Node now or ever"
          value={c.reached ? "past" : "at"}
          options={{ at: "right now", past: "now or earlier" }}
          onChange={(v) => set({ reached: v === "past" ? true : undefined })}
        />
      ) : null}
      <Pick
        label="Source"
        value={c.entry ?? ""}
        options={{
          "": "any source",
          ...Object.fromEntries(sources.map((e) => [e, e])),
          ...(c.entry && !sources.includes(c.entry) ? { [c.entry]: c.entry } : {}),
        }}
        onChange={(v) => set({ entry: v || undefined })}
      />
      <Pick
        label="Journey status"
        value={c.status ?? ""}
        options={JOURNEY_STATUS_LABELS}
        onChange={(v) => set({ status: v ? (v as JourneyCondition["status"]) : undefined })}
      />
      {c.days === null ? (
        <span className={QUIET}>moved</span>
      ) : (
        <Pick
          label="Which date"
          value={c.window ?? "moved"}
          options={{ moved: "last moved", opened: "opened" }}
          onChange={(v) => set({ window: v === "opened" ? "opened" : undefined })}
        />
      )}
      <span className={QUIET}>in the last</span>
      <Days
        days={c.days}
        set={(p) => set(p.days === null ? { days: null, window: undefined } : p)}
      />
    </>
  );
}

/** Free words a condition narrows by: a channel, a subject, a campaign. Empty is any. */
function Words({
  label,
  value,
  placeholder,
  set,
}: {
  label: string;
  value: string | undefined;
  placeholder: string;
  set: (v: string | undefined) => void;
}) {
  const editKey = useContext(RuleKey);
  return (
    <Input
      aria-label={label}
      className="w-36 max-sm:w-full"
      placeholder={placeholder}
      data-edit={editKey}
      value={value ?? ""}
      onChange={(e) => set(e.target.value.trim() ? e.target.value : undefined)}
    />
  );
}

/** One condition's boxes. */
function ConditionRow({
  c,
  ctx,
  onChange,
  onRemove,
}: {
  c: Condition;
  ctx: Context;
  onChange: (c: Condition) => void;
  onRemove: () => void;
}) {
  const editKey = useContext(RuleKey);
  const set = (p: Partial<Condition>) => onChange({ ...c, ...p } as Condition);
  const traits = Object.fromEntries(
    [...new Set([...ctx.traits, ...(c.kind === "trait" && c.key ? [c.key] : [])])].map((t) => [
      t,
      t,
    ]),
  );
  return (
    <li className="flex flex-wrap items-center gap-2 border-b border-(--ui-hair) py-2 text-[14px]">
      <Pick
        label="Not"
        value={c.not ? "not" : "is"}
        options={{ is: "Is", not: "Is not" }}
        onChange={(v) => set({ not: v === "not" ? true : undefined })}
      />
      <Pick
        label="Kind of condition"
        value={c.kind}
        options={CONDITION_KINDS}
        onChange={(k) => onChange(fresh(k, ctx))}
      />
      {c.kind === "trait" ? (
        <>
          {Object.keys(traits).length ? (
            <Pick label="Trait" value={c.key} options={traits} onChange={(key) => set({ key })} />
          ) : (
            <Input
              aria-label="Trait"
              className="w-36 max-sm:w-full"
              placeholder="plan"
              data-edit={editKey}
              value={c.key}
              onChange={(e) => set({ key: e.target.value.trim() })}
            />
          )}
          <Pick label="Compare" value={c.op} options={TRAIT_OPS} onChange={(op) => set({ op })} />
          {c.op === "exists" ? null : (
            <Input
              aria-label="Value"
              className="w-40 max-sm:w-full"
              type={["gt", "lt", "in_next", "in_last"].includes(c.op) ? "number" : "text"}
              data-edit={editKey}
              placeholder={
                ["before", "after"].includes(c.op)
                  ? "2026-12-31"
                  : c.op === "one_of"
                    ? "a, b, c"
                    : ""
              }
              value={c.value ?? ""}
              onChange={(e) =>
                set({
                  value: ["gt", "lt", "in_next", "in_last"].includes(c.op)
                    ? Number(e.target.value)
                    : e.target.value,
                })
              }
            />
          )}
        </>
      ) : null}
      {c.kind === "event" ? (
        <>
          <Pick
            label="What they did"
            value={c.event}
            options={Object.fromEntries(TIMELINE_KINDS.map((k) => [k, TIMELINE_KIND_NAMES[k]]))}
            onChange={(event) => set({ event })}
          />
          <span className={QUIET}>on</span>
          <Words
            label="Channel"
            value={c.channel}
            placeholder="any channel"
            set={(v) => set({ channel: v?.trim().toLowerCase() })}
          />
          <Words
            label="Matching words"
            value={c.match}
            placeholder="matching words"
            set={(match) => set({ match })}
          />
          <Times atLeast={c.atLeast} atMost={c.atMost} days={c.days} set={set} />
          <span className={QUIET}>after</span>
          <Pick
            label="Only after"
            value={c.after?.event ?? ""}
            options={ANCHORS}
            onChange={(v) => set({ after: v ? { event: v as TimelineKind } : undefined })}
          />
          <span className={QUIET}>before</span>
          <Pick
            label="Only before"
            value={c.before?.event ?? ""}
            options={ANCHORS}
            onChange={(v) => set({ before: v ? { event: v as TimelineKind } : undefined })}
          />
        </>
      ) : null}
      {c.kind === "message" ? (
        <>
          <Pick
            label="Got to"
            value={c.state}
            options={Object.fromEntries(Object.keys(MESSAGE_STATES).map((s) => [s, s]))}
            onChange={(state) => set({ state })}
          />
          <span className={QUIET}>on</span>
          <Pick
            label="Channel"
            value={c.channel}
            options={Object.fromEntries(MESSAGE_CHANNELS.map((k) => [k, CHANNEL_LABELS[k] ?? k]))}
            onChange={(channel) => set({ channel })}
          />
          <Words
            label="Campaign"
            value={c.campaign}
            placeholder="any campaign"
            set={(campaign) => set({ campaign })}
          />
          <Times atLeast={c.atLeast} atMost={c.atMost} days={c.days} set={set} />
        </>
      ) : null}
      {c.kind === "step" ? (
        <>
          <Pick
            label="Step"
            value={c.step}
            options={Object.fromEntries(FUNNEL_STEPS.map((k) => [k, FUNNEL_STEP_NAMES[k]]))}
            onChange={(step) => set({ step })}
          />
          <span className={QUIET}>on</span>
          <Pick
            label="Channel"
            value={c.channel ?? ""}
            options={{
              "": "any channel",
              ...Object.fromEntries(STAT_CHANNELS.map((k) => [k, STAT_CHANNEL_NAMES[k]])),
            }}
            onChange={(v) => set({ channel: v || undefined })}
          />
          <Words
            label="From"
            value={c.source}
            placeholder="any campaign or post"
            set={(source) => set({ source })}
          />
          <span className={QUIET}>in the last</span>
          <Days days={c.days} set={set} />
        </>
      ) : null}
      {c.kind === "journey" ? <JourneyEditor c={c} ctx={ctx} set={set} /> : null}
      {c.kind === "consent" ? (
        <>
          <Pick
            label="Channel"
            value={c.channel}
            options={Object.fromEntries(CONSENT_CHANNELS.map((k) => [k, CHANNEL_LABELS[k] ?? k]))}
            onChange={(channel) => set({ channel })}
          />
          <Pick
            label="Answer"
            value={c.state}
            options={Object.fromEntries(
              CONSENT_CONDITION_STATES.map((k) => [k, CONSENT_LABELS[k] ?? k]),
            )}
            onChange={(state) => set({ state })}
          />
        </>
      ) : null}
      {c.kind === "segment" ? (
        ctx.segments.length ? (
          <Pick
            label="Group"
            value={String(c.segment)}
            options={Object.fromEntries(ctx.segments.map((s) => [String(s.id), s.name]))}
            onChange={(v) => set({ segment: Number(v) })}
          />
        ) : (
          <span className={QUIET}>No other group yet.</span>
        )
      ) : null}
      <Button size="dense" tone="quiet" onClick={onRemove}>
        Remove
      </Button>
    </li>
  );
}

/** A group of conditions, all or any of them, and groups inside it. */
function GroupBox({
  g,
  ctx,
  depth,
  total,
  onChange,
  onRemove,
}: {
  g: Group;
  ctx: Context;
  depth: number;
  total: number;
  onChange: (g: Group) => void;
  onRemove?: () => void;
}) {
  const full = total >= RULE_MOST.conditions;
  const at = (i: number, n: Node | null) =>
    onChange({
      ...g,
      of: n ? g.of.map((x, j) => (j === i ? n : x)) : g.of.filter((_, j) => j !== i),
    });
  return (
    <div
      className={`flex min-w-0 flex-col gap-1 ${depth ? "border-l-2 border-(--ui-hair) pl-3" : ""}`}
    >
      <div className="flex flex-wrap items-center gap-2 text-[14px]">
        <Pick
          label="Match"
          value={g.match}
          options={{ all: "All of these", any: "Any of these" }}
          onChange={(match) => onChange({ ...g, match })}
        />
        {onRemove ? (
          <Button size="dense" tone="quiet" onClick={onRemove}>
            Remove group
          </Button>
        ) : null}
      </div>
      <ul className="m-0 list-none p-0">
        {g.of.map((n, i) =>
          n.kind === "group" ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: a condition has no id; its place is it
            <li key={i} className="py-2">
              <GroupBox
                g={n}
                ctx={ctx}
                depth={depth + 1}
                total={total}
                onChange={(x) => at(i, x)}
                onRemove={() => at(i, null)}
              />
            </li>
          ) : (
            <ConditionRow
              // biome-ignore lint/suspicious/noArrayIndexKey: a condition has no id; its place is it
              key={i}
              c={n}
              ctx={ctx}
              onChange={(x) => at(i, x)}
              onRemove={() => at(i, null)}
            />
          ),
        )}
      </ul>
      <div className="flex flex-wrap gap-2 pt-1">
        <Button
          size="dense"
          tone="quiet"
          disabled={full}
          onClick={() => onChange({ ...g, of: [...g.of, fresh("trait", ctx)] })}
        >
          Add condition
        </Button>
        {depth + 1 < RULE_MOST.depth ? (
          <Button
            size="dense"
            tone="quiet"
            disabled={full}
            onClick={() =>
              onChange({
                ...g,
                of: [...g.of, { kind: "group", match: g.match === "all" ? "any" : "all", of: [] }],
              })
            }
          >
            Add group
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** Are there words or a rule kept for this group that the server doesn't hold? */
function useKeptSegment(
  id: number | "new",
  start: { name: string; words: string | null; rule: Rule | null },
  version: string | null,
): boolean {
  const at = `segment:${id}`;
  const a = useEdit(`${at}:name`, start.name, { version });
  const b = useEdit(`${at}:words`, start.words ?? "", { version });
  const c = useEditJson<Rule>(`${at}:rule`, start.rule ?? EMPTY, { version });
  return a.dirty || b.dirty || c.dirty;
}

/**
 * Make or change a group: words to a rule (the model), the rule by hand, a live count, then
 * a save that says how many it matches before it's pressed.
 */
export function SegmentEditor({
  client,
  start,
  onDone,
  send = (input) => call("people/segmentSave", { ...atOf(client), ...input }),
}: {
  client: string;
  start: Start;
  onDone: (saved: boolean) => void;
  /** How the save goes: by itself from the head, as the record's own action on its page. */
  send?: (input: Record<string, unknown>) => Promise<unknown>;
}) {
  const at = atOf(client);
  // What a rule picks from (fields, kinds, lists), kept: the form paints at once.
  const got = useCall(`people:segmentContext:${client}`, () =>
    call<Context>("people/segmentContext", at),
  );
  const ctx = got.data ?? null;
  // Name, words and rule are kept as typed until saved or cancelled, on this device.
  const kept = `segment:${start.id ?? "new"}`;
  const version = start.version ?? null;
  const nameEdit = useEdit(`${kept}:name`, start.name, { version });
  const wordsEdit = useEdit(`${kept}:words`, start.words ?? "", { version });
  const ruleEdit = useEditJson<Rule>(`${kept}:rule`, start.rule ?? EMPTY, {
    version,
    show: (r) => ruleText(pruned(r), new Map((ctx?.segments ?? []).map((s) => [s.id, s.name]))),
  });
  // The rule's text while edited that way: kept too, without a version (it starts empty).
  const textEdit = useEdit(`${kept}:rule-text`, "");
  const [textOn, setTextOn] = useState(false);
  const [kind, setKind] = useState<Kind>(start.kind);
  const name = nameEdit.value;
  const words = wordsEdit.value;
  const rule = ruleEdit.value;
  const setRule = ruleEdit.set;
  const [described, setDescribed] = useState<Described | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  /** What the rule still needs before it can be counted: a hint, not an error. */
  const [unready, setUnready] = useState<string | null>(null);
  const [busy, setBusy] = useState<"describe" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The rule as text while it's edited that way; null shows the boxes. */
  const text = textOn || textEdit.dirty ? textEdit.value : null;
  const [textProblems, setTextProblems] = useState<string[]>([]);
  const asked = useRef(0);
  /** One save at a time, whatever the render says. */
  const saving = useRef(false);
  const ruled = kind !== "manual";

  const ctxError = got.error && !got.data ? messageOf(got.error) : null;

  // The count follows the rule, a beat after the last change.
  // read-ok: a count for a rule not yet saved; never kept.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the rule is the input
  useEffect(() => {
    if (!ruled || !pruned(rule).of.length) {
      setPreview(null);
      setUnready(null);
      return;
    }
    const mine = ++asked.current;
    const t = setTimeout(() => {
      call<Preview>("people/segmentPreview", { ...at, rule: pruned(rule) }).then(
        (p) => {
          if (mine === asked.current) {
            setPreview(p);
            setUnready(null);
          }
        },
        (e) => {
          if (mine === asked.current) {
            setPreview(null);
            setUnready(messageOf(e));
          }
        },
      );
    }, 400);
    return () => clearTimeout(t);
  }, [rule, ruled]);

  const describe = async () => {
    if (!words.trim() || busy) return;
    setBusy("describe");
    setError(null);
    try {
      const got = await call<Described>("people/segmentDescribe", { ...at, words });
      setDescribed(got);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (saving.current || busy) return;
    saving.current = true;
    setBusy("save");
    setError(null);
    const sent = { name, words, rule };
    try {
      const body = {
        ...(start.id ? { id: start.id } : {}),
        name: name.trim(),
        kind,
        ...(ruled ? { rule: pruned(rule) } : {}),
        words: words.trim() || null,
        ...(start.version ? { expect: start.version } : {}),
      };
      // A new one is made once: a retry of the same rule is the same group.
      await ACTIONS.run(`segment-save:${client}:${JSON.stringify(body)}`, (requestId) =>
        send({ ...body, requestId }),
      );
      nameEdit.saved(sent.name);
      wordsEdit.saved(sent.words);
      ruleEdit.saved(sent.rule);
      textEdit.discard();
      onDone(true);
    } catch (e) {
      setError(messageOf(e));
      setBusy(null);
    } finally {
      saving.current = false;
    }
  };

  if (!ctx)
    return (error ?? ctxError) ? (
      <p className={`m-0 ${ERROR}`} role="alert">
        {error ?? ctxError}
      </p>
    ) : (
      <Tag tone="neutral">Loading</Tag>
    );
  const others = { ...ctx, segments: ctx.segments.filter((s) => s.id !== start.id) };
  const n = count(rule);
  const canSave = !!name.trim() && (!ruled || n > 0) && !busy && text === null;

  return (
    <div className="flex w-full min-w-0 basis-full flex-col gap-4 border border-(--ui-hair) p-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-0 flex-col gap-1 text-[13px] text-(--ui-ink-2) max-sm:basis-full">
          Name
          <Input className="w-64 max-sm:w-full" {...nameEdit.field} maxLength={120} />
          <EditConflict
            conflict={nameEdit.conflict}
            onKeepMine={nameEdit.keepMine}
            onTakeTheirs={nameEdit.takeTheirs}
            what="The name"
          />
        </label>
        <div className="flex min-w-0 flex-col gap-1 text-[13px] text-(--ui-ink-2) max-sm:basis-full">
          <span>Kind</span>
          {start.id ? (
            <span className="min-h-[38px] py-2 text-[14.5px] text-(--ui-ink)">{KINDS[kind]}</span>
          ) : (
            <Pick label="Kind" value={kind} options={KINDS} onChange={setKind} />
          )}
        </div>
      </div>

      {ruled ? (
        <>
          {ctx.describe ? (
            <div className="flex min-w-0 flex-col gap-2">
              <label className="flex flex-col gap-1 text-[13px] text-(--ui-ink-2)">
                Describe who's in it
                <Textarea
                  rows={2}
                  {...wordsEdit.field}
                  placeholder="People who opened an email in the last 30 days but never booked"
                />
                <EditConflict
                  conflict={wordsEdit.conflict}
                  onKeepMine={wordsEdit.keepMine}
                  onTakeTheirs={wordsEdit.takeTheirs}
                  what="The description"
                />
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="dense"
                  tone="quiet"
                  busy={busy === "describe"}
                  disabled={!words.trim() || !!busy}
                  onClick={describe}
                >
                  Write the rule
                </Button>
              </div>
              {described ? (
                <div
                  className="flex flex-col gap-2 border border-(--ui-hair) p-3 text-[14px]"
                  role="status"
                >
                  <p className="m-0">
                    <span className={QUIET}>Read as: </span>
                    {described.words}
                  </p>
                  {described.unknownTraits.length ? (
                    <p className={`m-0 ${ERROR}`}>
                      Nobody has {described.unknownTraits.join(", ")} yet.
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="dense"
                      onClick={() => {
                        setRule(described.rule);
                        if (!name.trim()) nameEdit.set(described.name);
                        setDescribed(null);
                      }}
                    >
                      Use this rule
                    </Button>
                    <Button size="dense" tone="quiet" onClick={() => setDescribed(null)}>
                      Not this
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
          <fieldset className="m-0 min-w-0 border-0 p-0">
            <legend className="mb-2 p-0 text-[13px] font-medium">Rule</legend>
            <EditConflict
              conflict={ruleEdit.conflict}
              onKeepMine={ruleEdit.keepMine}
              onTakeTheirs={ruleEdit.takeTheirs}
              what="The rule"
            />
            {text === null ? (
              <RuleKey.Provider value={ruleEdit.key}>
                <GroupBox g={rule} ctx={others} depth={0} total={n} onChange={setRule} />
              </RuleKey.Provider>
            ) : (
              <div className="flex min-w-0 flex-col gap-2">
                <Textarea
                  aria-label="Rule as text"
                  rows={Math.min(14, text.split("\n").length + 2)}
                  className="font-mono text-[13px]"
                  {...textEdit.field}
                />
                {textProblems.length ? (
                  <ul className={`m-0 list-none p-0 ${ERROR}`} role="alert">
                    {textProblems.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            )}
            <div className="flex flex-wrap gap-2 pt-2">
              {text === null ? (
                <Button
                  size="dense"
                  tone="quiet"
                  onClick={() => {
                    setTextOn(true);
                    textEdit.set(
                      ruleText(pruned(rule), new Map(ctx.segments.map((s) => [s.id, s.name]))),
                    );
                    setTextProblems([]);
                  }}
                >
                  Edit as text
                </Button>
              ) : (
                <>
                  <Button
                    size="dense"
                    onClick={() => {
                      const got = parseRule(text, new Map(ctx.segments.map((s) => [s.name, s.id])));
                      if ("problems" in got) return setTextProblems(got.problems);
                      setRule(got.rule);
                      setTextOn(false);
                      textEdit.discard();
                      setTextProblems([]);
                    }}
                  >
                    Use this text
                  </Button>
                  <Button
                    size="dense"
                    tone="quiet"
                    onClick={() => {
                      setTextOn(false);
                      textEdit.discard();
                    }}
                  >
                    Back to boxes
                  </Button>
                </>
              )}
            </div>
          </fieldset>
          {preview ? (
            <div className="grid gap-1 text-[14px]" role="status">
              <p className="m-0">
                <span className="font-medium">
                  {preview.size} {preview.size === 1 ? "person" : "people"} now.
                </span>{" "}
                <span className={QUIET}>{preview.words}</span>
              </p>
              {preview.sample.length ? (
                <p className={`m-0 text-[13px] ${QUIET}`}>
                  {preview.sample.map((p) => p.name).join(", ")}
                  {preview.size > preview.sample.length ? ", and more" : ""}
                </p>
              ) : null}
            </div>
          ) : unready ? (
            <p className={`m-0 text-[14px] ${QUIET}`} role="status">
              To count it: {unready}
            </p>
          ) : null}
        </>
      ) : (
        <p className={`m-0 text-[14px] ${QUIET}`}>
          Add people from the People list: pick them, then Add to group.
        </p>
      )}

      {error ? (
        <p className={`m-0 ${ERROR}`} role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          tone="primary"
          size="dense"
          busy={busy === "save"}
          disabled={!canSave}
          onClick={save}
        >
          {start.id ? "Save changes" : "Save group"}
          {ruled && preview ? ` (${preview.size})` : ""}
        </Button>
        <Button
          size="dense"
          tone="quiet"
          onClick={() => {
            nameEdit.discard();
            wordsEdit.discard();
            ruleEdit.discard();
            textEdit.discard();
            onDone(false);
          }}
        >
          Cancel
        </Button>
        <UnsavedMark
          edit={{
            dirty: nameEdit.dirty || wordsEdit.dirty || ruleEdit.dirty || textEdit.dirty,
            conflict: null,
          }}
        />
        <span className="text-[13px] text-(--ui-ink-3)">Nobody is messaged.</span>
      </div>
    </div>
  );
}

/** The list's head: New group opens the editor. */
function SegmentsHead({ client, reload }: { client: string; reload: () => void }) {
  const [open, setOpen] = useState(false);
  // Words kept from before open the editor again.
  const kept = useKeptSegment("new", { name: "", words: null, rule: null }, null);
  if (!open && !kept)
    return (
      <Button tone="primary" size="dense" onClick={() => setOpen(true)}>
        New group
      </Button>
    );
  return (
    <SegmentEditor
      client={client}
      start={{ name: "", kind: "live", rule: null, words: null }}
      onDone={(saved) => {
        setOpen(false);
        if (saved) reload();
      }}
    />
  );
}

/** A group's rule, in words, with Edit; who came and went lately. */
function RuleSection({
  client,
  row,
  d,
  act,
}: {
  client: string;
  row: Record<string, unknown>;
  d: SegmentDetail;
  act: RecordAct;
}) {
  const [editing, setEditing] = useState(false);
  const active = row.state === "active";
  // Words kept from before open the editor again.
  const kept = useKeptSegment(
    Number(row.id),
    { name: String(row.name ?? ""), words: (row.words as string | null) ?? null, rule: d.rule },
    d.version,
  );
  if (editing || kept)
    return (
      <SegmentEditor
        client={client}
        start={{
          id: Number(row.id),
          name: String(row.name ?? ""),
          kind: row.kind as Kind,
          rule: d.rule,
          words: (row.words as string | null) ?? null,
          version: d.version,
        }}
        onDone={() => setEditing(false)}
        // The record's own action, so the page reads it again after.
        send={(input) => act("people.segmentSave", input)}
      />
    );
  const m = d.moves;
  return (
    <div className="flex flex-col gap-2 text-[14.5px]">
      <p className="m-0">{d.ruleWords ?? "People added by hand."}</p>
      <p className={`m-0 text-[13.5px] ${QUIET}`}>
        Last 7 days: {m.entered7} in, {m.left7} out. Last 30: {m.entered30} in, {m.left30} out.
      </p>
      {active ? (
        <div>
          <Button size="dense" tone="quiet" onClick={() => setEditing(true)}>
            Edit
          </Button>
        </div>
      ) : null}
      <Versions client={client} id={Number(row.id)} at={d.version} />
    </div>
  );
}

/** Every save of a group, newest first, each rule as text. */
function Versions({ client, id, at }: { client: string; id: number; at: string }) {
  const [open, setOpen] = useState(false);
  // Keyed by the group's version: a save reads the list again.
  const got = useCall(open ? `people:segmentVersions:${client}:${id}:${at}` : null, () =>
    call<{ versions: SegmentVersion[] }>("people/segmentVersions", { ...atOf(client), id }),
  );
  const list = got.data?.versions ?? (got.error ? [] : null);
  if (!open)
    return (
      <div>
        <Button size="dense" tone="quiet" onClick={() => setOpen(true)}>
          Past versions
        </Button>
      </div>
    );
  if (!list) return <Tag tone="neutral">Loading</Tag>;
  return (
    <ol className="m-0 grid list-none gap-3 p-0 text-[13.5px]">
      {list.map((v) => (
        <li key={v.version} className="grid gap-1">
          <span>
            <span className="tabular-nums">v{v.version}</span>{" "}
            <span className={QUIET}>
              {new Date(v.at).toLocaleDateString("en-CA")}, {v.by}
              {v.name ? `, ${v.name}` : ""}
            </span>
          </span>
          <pre className="m-0 overflow-x-auto whitespace-pre-wrap font-mono text-[12.5px] text-(--ui-ink-2)">
            {v.rule ? ruleText(v.rule) : "People added by hand."}
          </pre>
        </li>
      ))}
    </ol>
  );
}

export const groupsPage: ListPage = {
  id: "groups",
  label: "Groups",
  about:
    "A group is a saved list of people: a live one follows its rule, a manual one holds who you put in it.",
  template: "list",
  record: "people.segment",
  columns: ["name", "kind", "size", "usedBy", "computedAt", "usedAt"],
  empty: {
    active: "No groups yet. Make one with New group.",
    archived: "Nothing archived. A group unused for 90 days moves here.",
    all: "No groups yet. Make one with New group.",
  },
  actions: [
    { id: "people.segmentSave", label: "Save", handler: "people/segmentSave", inline: true },
    {
      id: "people.segmentRetake",
      label: "Count again",
      icon: "retry",
      handler: "people/segmentRetake",
      when: { kind: ["snapshot"], state: ["active"] },
      confirm: "Count who matches now and keep that?",
      done: () => "Counted again",
    },
    {
      id: "people.segmentArchive",
      label: "Archive",
      icon: "archive",
      handler: "people/segmentArchive",
      when: { state: ["active"] },
      bulk: true,
      // Its members stay; it stops updating. Restore is the undo.
      undo: "people/segmentRestore",
      done: () => "Archived",
    },
    {
      id: "people.segmentRestore",
      label: "Restore",
      icon: "restore",
      handler: "people/segmentRestore",
      when: { state: ["archived"] },
      bulk: true,
      key: "r",
      // One click: archiving again is the undo.
      undo: "people/segmentArchive",
      done: () => "Restored",
    },
  ],
  head: (_meta, reload, at) =>
    at.demo ? null : <SegmentsHead client={at.client} reload={reload} />,
  extras: (detail, at) => {
    const d = detail as SegmentDetail | null;
    if (!d) return {} satisfies RecordExtras;
    return {
      sections: [
        ["Rule", <RuleSection key="rule" client={at.client} row={at.row} d={d} act={at.act} />],
      ],
    } satisfies RecordExtras;
  },
};

/** Who is in a group: opened from a group's Its people link. */
export const membersPage: ListPage = {
  id: "members",
  label: "Members",
  about: "Who is in each group, and since when.",
  hidden: true,
  template: "list",
  record: "people.member",
  columns: ["name", "segment", "emails", "phones", "since"],
  empty: "Nobody is in this group now.",
  actions: [
    {
      id: "people.memberRemove",
      label: "Take out",
      icon: "trash",
      handler: "people/memberRemove",
      when: { segmentKind: ["manual"] },
      bulk: true,
      confirm: "Take them out of this group?",
      done: () => "Taken out",
    },
  ],
};

/** On the People list: put the picked people in a manual group, or in a new one. */
export const addToGroup: Action = {
  id: "people.memberAdd",
  label: "Add to group",
  icon: "addTo",
  handler: "people/memberAdd",
  bulk: true,
  each: true,
  form: [
    {
      field: "group",
      label: "Group",
      type: "combo",
      choices: {
        handler: "people/segmentContext",
        list: (answer) =>
          ((answer as { segments?: { name: string; kind: string }[] }).segments ?? [])
            .filter((g) => g.kind === "manual")
            .map((g) => g.name),
      },
      hint: "Pick a manual group, or type a new name to make one. A group is a saved list of people. A live group follows its rule; a manual group holds who you put in it.",
    },
  ],
  done: (answer) => {
    const a = answer as { group?: string; made?: boolean };
    return a.made ? `Made ${a.group} and added` : `Added to ${a.group ?? "the group"}`;
  },
};
