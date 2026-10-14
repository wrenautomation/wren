/**
 * People > Segments (designs/2026-10-14-customerio-audit.md, B5): named groups of people, by a
 * rule or by hand. The head makes one: describe it in words (the model writes the rule) or build
 * the rule, see how many it matches, then save. A segment's page shows its rule in words, who
 * came and went, and edits it. Nothing here sends.
 */

import { TIMELINE_KIND_NAMES, TIMELINE_KINDS } from "@wren/core/profiles-schema";
import type { SegmentDetail } from "@wren/core/segment-records";
import {
  CONSENT_CHANNELS,
  CONSENT_CONDITION_STATES,
  type Condition,
  type Group,
  MESSAGE_CHANNELS,
  MESSAGE_STATES,
  type Node,
  RULE_MOST,
  type Rule,
  TRAIT_OPS,
} from "@wren/core/segments";
import type { Action } from "@wren/ui";
import { Button, Input, type RecordAct, type RecordExtras, Tag, Textarea } from "@wren/ui";
import { useEffect, useRef, useState } from "react";
import { ApiError, call } from "../../api.js";
import { type ListPage, WREN } from "../../module.js";
import { ERROR, QUIET, SELECT } from "../work/bits.js";

/** Whose segments a call is about: none named is Wren's own. */
export const atOf = (client: string): Record<string, string> =>
  client === WREN.id ? {} : { client };

const said = (err: unknown) => (err instanceof ApiError ? err.message : String(err));

interface Context {
  traits: string[];
  segments: { id: number; name: string; kind: string }[];
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
/** What the editor starts from: a new segment, or one being changed. */
export interface Start {
  id?: number;
  name: string;
  kind: Kind;
  rule: Rule | null;
  words: string | null;
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
  segment: "In a segment",
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

/** "at least N times in the last D days"; an empty D is ever. */
function Times({
  atLeast,
  days,
  set,
}: {
  atLeast: number;
  days: number | null;
  set: (p: { atLeast?: number; days?: number | null }) => void;
}) {
  return (
    <>
      <span className={QUIET}>at least</span>
      <Input
        aria-label="At least how many times"
        className={NUM}
        type="number"
        min={1}
        value={atLeast}
        onChange={(e) => set({ atLeast: Math.max(1, Number(e.target.value) || 1) })}
      />
      <span className={QUIET}>times in the last</span>
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
              placeholder={["before", "after"].includes(c.op) ? "2026-12-31" : ""}
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
          <Times atLeast={c.atLeast} days={c.days} set={set} />
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
          <Times atLeast={c.atLeast} days={c.days} set={set} />
        </>
      ) : null}
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
            label="Segment"
            value={String(c.segment)}
            options={Object.fromEntries(ctx.segments.map((s) => [String(s.id), s.name]))}
            onChange={(v) => set({ segment: Number(v) })}
          />
        ) : (
          <span className={QUIET}>No other segment yet.</span>
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

/**
 * Make or change a segment: words to a rule (the model), the rule by hand, a live count, then
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
  const [ctx, setCtx] = useState<Context | null>(null);
  const [name, setName] = useState(start.name);
  const [kind, setKind] = useState<Kind>(start.kind);
  const [rule, setRule] = useState<Rule>(start.rule ?? EMPTY);
  const [words, setWords] = useState(start.words ?? "");
  const [described, setDescribed] = useState<Described | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  /** What the rule still needs before it can be counted: a hint, not an error. */
  const [unready, setUnready] = useState<string | null>(null);
  const [busy, setBusy] = useState<"describe" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const asked = useRef(0);
  const ruled = kind !== "manual";

  // biome-ignore lint/correctness/useExhaustiveDependencies: once per workspace
  useEffect(() => {
    call<Context>("people/segmentContext", at).then(setCtx, (e) => setError(said(e)));
  }, [client]);

  // The count follows the rule, a beat after the last change.
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
            setUnready(said(e));
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
      setError(said(e));
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (busy) return;
    setBusy("save");
    setError(null);
    try {
      await send({
        ...(start.id ? { id: start.id } : {}),
        name: name.trim(),
        kind,
        ...(ruled ? { rule: pruned(rule) } : {}),
        words: words.trim() || null,
      });
      onDone(true);
    } catch (e) {
      setError(said(e));
      setBusy(null);
    }
  };

  if (!ctx)
    return error ? (
      <p className={`m-0 ${ERROR}`} role="alert">
        {error}
      </p>
    ) : (
      <Tag tone="neutral">Loading</Tag>
    );
  const others = { ...ctx, segments: ctx.segments.filter((s) => s.id !== start.id) };
  const n = count(rule);
  const canSave = !!name.trim() && (!ruled || n > 0) && !busy;

  return (
    <div className="flex w-full min-w-0 basis-full flex-col gap-4 border border-(--ui-hair) p-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-0 flex-col gap-1 text-[13px] text-(--ui-ink-2) max-sm:basis-full">
          Name
          <Input
            className="w-64 max-sm:w-full"
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
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
                  value={words}
                  placeholder="People who opened an email in the last 30 days but never booked"
                  onChange={(e) => setWords(e.target.value)}
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
                        if (!name.trim()) setName(described.name);
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
            <GroupBox g={rule} ctx={others} depth={0} total={n} onChange={setRule} />
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
          Add people from the People list: pick them, then Add to segment.
        </p>
      )}

      {error ? (
        <p className={`m-0 ${ERROR}`} role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="dense" busy={busy === "save"} disabled={!canSave} onClick={save}>
          {start.id ? "Save changes" : "Save segment"}
          {ruled && preview ? ` (${preview.size})` : ""}
        </Button>
        <Button size="dense" tone="quiet" onClick={() => onDone(false)}>
          Cancel
        </Button>
        <span className="text-[13px] text-(--ui-ink-3)">Nobody is messaged.</span>
      </div>
    </div>
  );
}

/** The list's head: New segment opens the editor. */
function SegmentsHead({ client, reload }: { client: string; reload: () => void }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <Button size="dense" onClick={() => setOpen(true)}>
        New segment
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

/** A segment's rule, in words, with Edit; who came and went lately. */
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
  if (editing)
    return (
      <SegmentEditor
        client={client}
        start={{
          id: Number(row.id),
          name: String(row.name ?? ""),
          kind: row.kind as Kind,
          rule: d.rule,
          words: (row.words as string | null) ?? null,
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
    </div>
  );
}

export const segmentsPage: ListPage = {
  id: "segments",
  label: "Segments",
  about: "Groups of people, picked by a rule or by hand.",
  template: "list",
  record: "people.segment",
  columns: ["name", "kind", "size", "usedBy", "computedAt", "usedAt"],
  empty: {
    active: "No segments yet. Make one with New segment.",
    archived: "Nothing archived. A segment unused for 90 days moves here.",
    all: "No segments yet. Make one with New segment.",
  },
  actions: [
    { id: "people.segmentSave", label: "Save", handler: "people/segmentSave", inline: true },
    {
      id: "people.segmentRetake",
      label: "Count again",
      handler: "people/segmentRetake",
      when: { kind: ["snapshot"], state: ["active"] },
      confirm: "Count who matches now and keep that?",
      done: () => "Counted again",
    },
    {
      id: "people.segmentArchive",
      label: "Archive",
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

/** Who is in a segment: opened from a segment's Its people link. */
export const membersPage: ListPage = {
  id: "members",
  label: "Members",
  about: "Who is in each segment, and since when.",
  hidden: true,
  template: "list",
  record: "people.member",
  columns: ["name", "segment", "emails", "phones", "since"],
  empty: "Nobody is in this segment now.",
  actions: [
    {
      id: "people.memberRemove",
      label: "Take out",
      handler: "people/memberRemove",
      when: { segmentKind: ["manual"] },
      bulk: true,
      confirm: "Take them out of this segment?",
      done: () => "Taken out",
    },
  ],
};

/** On the People list: put the picked people in a manual segment. */
export const addToSegment: Action = {
  id: "people.memberAdd",
  label: "Add to segment",
  handler: "people/memberAdd",
  bulk: true,
  each: true,
  form: [{ field: "segment", label: "Segment", hint: "A manual segment's name" }],
  done: () => "Added",
};
