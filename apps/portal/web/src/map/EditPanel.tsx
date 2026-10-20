/**
 * The Map's edit panels, cards over the canvas: one node's fields by kind, and one line's label,
 * kind and removal. Every change goes to the draft (`onChange`) and nowhere else; nothing here
 * saves. The advance rules reuse the workflow editor's trigger form. Removing a node that people
 * sit on asks where they go first.
 */
import { LOGIC, startWith } from "@wren/core/logic";
import type { BlameLine } from "@wren/pipeline/history";
import { ACTIONS, type Advance, RESEARCH_LEVELS, type ShapeNode, VIAS } from "@wren/pipeline/model";
import {
  Button,
  cx,
  FIELD_CLASS,
  Input,
  LoadFailed,
  Loading,
  PanelBlock,
  SELECT_CLASS,
} from "@wren/ui";
import { type ReactNode, useMemo, useState } from "react";
import { useCall } from "../load.js";
import { LogicForm, TRIGGER_NOTE } from "../modules/wren/logic-form.js";
import type { PaletteLogic } from "../modules/wren/wiring.js";
import { BlameList } from "./BlameList.js";
import {
  type Draft,
  kindReason,
  labelEdge,
  offerBefore,
  peopleOn,
  removeEdge,
  removeNode,
  renameNode,
  rulesOf,
  setField,
  setKind,
  setRules,
  TITLE,
} from "./edit.js";
import type { Person } from "./model.js";
import { OVER_RIGHT } from "./overlay.js";
import { listAll } from "./read.js";

interface PanelProps {
  draft: Draft;
  onChange: (next: Draft) => void;
  onClose: () => void;
}

const SAY = "text-[12.5px] text-(--ui-ink-3)";

const VIA_LABEL: Record<(typeof VIAS)[number], string> = {
  organic: "Organic posts",
  outbound: "Outbound messages",
  ads: "Ads",
  referral: "Referrals",
  sourced: "A list",
  group: "A saved group",
  manual: "By hand",
};

const ACTION_LABEL: Record<(typeof ACTIONS)[number], string> = {
  comment: "Comment",
  reply: "Reply",
  dm: "Direct message",
  email: "Email",
  text: "Text",
  call: "Call",
  cta: "Call to action",
  visit: "Visit",
  form: "Form",
  book: "Booking",
  held: "Meeting held",
  proposal: "Proposal",
  signed: "Signed",
  other: "Other",
};

const RESEARCH_LABEL: Record<(typeof RESEARCH_LEVELS)[number], string> = {
  none: "None",
  light: "Light",
  full: "Full",
};

/** A labelled control. */
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string | undefined;
  children: ReactNode;
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is the child
    <label className={FIELD_CLASS}>
      <span>{label}</span>
      {children}
      {hint ? <span className={SAY}>{hint}</span> : null}
    </label>
  );
}

/**
 * A text box that tells the draft once: on blur or Enter, not on each key. It starts over from
 * `value` when that changes (another node picked, the draft reset).
 */
function CommitInput({
  scope,
  value,
  label,
  placeholder,
  maxLength,
  onCommit,
}: {
  /** What the box belongs to: a new one starts over. */
  scope: string;
  value: string;
  label: string;
  placeholder?: string;
  maxLength?: number;
  onCommit: (value: string) => void;
}) {
  const send = (el: HTMLInputElement) => {
    if (el.value !== value) onCommit(el.value);
  };
  return (
    <Field label={label}>
      <Input
        key={`${scope}:${value}`}
        defaultValue={value}
        placeholder={placeholder}
        maxLength={maxLength}
        onBlur={(e) => send(e.currentTarget)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
    </Field>
  );
}

/** A pick among `options` ([value, words]). */
function Pick({
  label,
  value,
  options,
  empty,
  onPick,
  hint,
}: {
  label: string;
  value: string;
  options: readonly (readonly [string, string])[];
  /** The words for no pick, when none is a choice. */
  empty?: string;
  onPick: (value: string) => void;
  hint?: string | undefined;
}) {
  const known = options.some(([v]) => v === value);
  return (
    <Field label={label} hint={hint}>
      <select className={SELECT_CLASS} value={value} onChange={(e) => onPick(e.target.value)}>
        {empty !== undefined ? <option value="">{empty}</option> : null}
        {value && !known ? <option value={value}>{value}</option> : null}
        {options.map(([v, words]) => (
          <option key={v} value={v}>
            {words}
          </option>
        ))}
      </select>
    </Field>
  );
}

// --- the advance rules -----------------------------------------------------------------------

/** Every trigger as the workflow editor's form wants it. */
const TRIGGERS: readonly PaletteLogic[] = LOGIC.filter((l) => l.group === "trigger").map((l) => ({
  id: l.id,
  name: l.name,
  blurb: l.blurb,
  icon: l.icon,
  group: l.group,
  ready: l.ready,
  effects: [],
  settings: l.settings,
  start: startWith(l),
}));
const TRIGGER_BY_ID = new Map(TRIGGERS.map((t) => [t.id, t]));

/** What moves a person to a node: a list of triggers, each with its own settings. */
function Rules({
  rules,
  onChange,
}: {
  rules: readonly Advance[];
  onChange: (next: Advance[]) => void;
}) {
  const withStart = (t: PaletteLogic): Advance =>
    Object.keys(t.start).length ? { trigger: t.id, with: { ...t.start } } : { trigger: t.id };
  const offered = TRIGGERS.filter((t) => t.ready);
  const at = (i: number, fn: (r: Advance) => Advance) =>
    onChange(rules.map((r, n) => (n === i ? fn(r) : r)));
  return (
    <PanelBlock title="What moves a person here">
      <p className={SAY}>A person moves here when one of these happens.</p>
      {rules.length ? (
        <ul className="m-0 grid list-none gap-3 p-0">
          {rules.map((r, i) => {
            const t = TRIGGER_BY_ID.get(r.trigger);
            const key = `${i}:${r.trigger}`;
            return (
              <li
                key={key}
                className="grid gap-2.5 rounded-(--ui-radius) border border-(--ui-hair) p-3"
              >
                <div className="flex items-end gap-2">
                  <div className="min-w-0 flex-1">
                    <Pick
                      label={`Rule ${i + 1}`}
                      value={r.trigger}
                      options={[
                        ...offered.map((o) => [o.id, o.name] as const),
                        ...(t && !t.ready ? ([[t.id, t.name]] as const) : []),
                      ]}
                      onPick={(id) => {
                        const next = TRIGGER_BY_ID.get(id);
                        if (next) at(i, () => withStart(next));
                      }}
                    />
                  </div>
                  <Button
                    tone="quiet"
                    size="dense"
                    icon="close"
                    aria-label={`Remove rule ${i + 1}`}
                    onClick={() => onChange(rules.filter((_, n) => n !== i))}
                  >
                    Remove
                  </Button>
                </div>
                {t ? (
                  <>
                    <p className={SAY}>{TRIGGER_NOTE[t.id] ?? t.blurb}</p>
                    <LogicForm
                      logic={t}
                      values={r.with ?? {}}
                      set={(field, v) =>
                        at(i, (x) => ({ ...x, with: { ...(x.with ?? {}), [field]: v } }))
                      }
                    />
                  </>
                ) : (
                  <p className={SAY}>This trigger is not known.</p>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className={SAY}>Nothing yet. People get here only when you move them.</p>
      )}
      <Pick
        label="Add a rule"
        value=""
        empty="Pick a trigger"
        options={offered.map((o) => [o.id, o.name] as const)}
        onPick={(id) => {
          const next = TRIGGER_BY_ID.get(id);
          if (next) onChange([...rules, withStart(next)]);
        }}
      />
    </PanelBlock>
  );
}

// --- the fields of one kind ------------------------------------------------------------------

/** Offers the registry holds, to pick the one an offer node makes. */
function OfferPick({
  at,
  value,
  onPick,
}: {
  at: Record<string, string>;
  value: string;
  onPick: (id: string) => void;
}) {
  const offers = useCall(`map:offers:${JSON.stringify(at)}`, () =>
    listAll(at, { record: "pipeline.offer" }),
  );
  if (offers.error && !offers.data)
    return <LoadFailed error={offers.error} onRetry={offers.retry} what="offers" />;
  if (!offers.data) return <Loading lines={2} />;
  return (
    <Pick
      label="Offer"
      value={value}
      empty="Pick an offer"
      options={offers.data.map((o) => [String(o.id), String(o.name ?? o.id)] as const)}
      onPick={onPick}
    />
  );
}

/** The plans of one offer's terms, to pick the one a plan node signs under. */
function TermsPick({
  at,
  offer,
  value,
  onPick,
}: {
  at: Record<string, string>;
  offer: string | null;
  value: string;
  onPick: (plan: string) => void;
}) {
  const terms = useCall(`map:terms:${JSON.stringify(at)}`, () =>
    listAll(at, { record: "pipeline.terms" }),
  );
  const plans = useMemo(
    () => [
      ...new Set(
        (terms.data ?? []).filter((r) => String(r.offer) === offer).map((r) => String(r.plan)),
      ),
    ],
    [terms.data, offer],
  );
  if (!offer)
    return <p className={SAY}>Draw a flow line from an offer to this plan, then pick its terms.</p>;
  if (terms.error && !terms.data)
    return <LoadFailed error={terms.error} onRetry={terms.retry} what="terms" />;
  if (!terms.data) return <Loading lines={2} />;
  return (
    <Pick
      label="Terms"
      value={value}
      empty={plans.length ? "Pick a plan" : "No plans for this offer yet"}
      options={plans.map((p) => [p, p] as const)}
      onPick={onPick}
      hint={`The plans of ${offer}.`}
    />
  );
}

/** The days a person may sit before the node reads stale. */
function IdleDays({
  value,
  onChange,
}: {
  value: number | undefined;
  onChange: (n: number | undefined) => void;
}) {
  return (
    <Field label="Stale after (days)" hint="Leave empty for no limit.">
      <Input
        type="number"
        min={1}
        max={365}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
      />
    </Field>
  );
}

function Fields({
  node,
  draft,
  at,
  onChange,
}: {
  node: ShapeNode;
  draft: Draft;
  at: Record<string, string>;
  onChange: (next: Draft) => void;
}) {
  const put = (key: string, value: unknown) =>
    onChange({ ...draft, body: setField(draft.body, node.id, key, value) });
  const text = (key: "channel" | "campaign" | "source" | "group", label: string, hint?: string) => (
    <CommitInput
      scope={`${node.id}:${key}`}
      value={(node as unknown as Record<string, string | undefined>)[key] ?? ""}
      label={label}
      maxLength={120}
      {...(hint ? { placeholder: hint } : {})}
      onCommit={(v) => put(key, v.trim())}
    />
  );
  switch (node.kind) {
    case "source":
      return (
        <PanelBlock title="Where people come from">
          <Pick
            label="Found by"
            value={node.via}
            options={VIAS.map((v) => [v, VIA_LABEL[v]] as const)}
            onPick={(via) =>
              onChange({
                ...draft,
                body: setField(
                  setField(
                    setField(draft.body, node.id, "via", via),
                    node.id,
                    "source",
                    via === "sourced" ? node.source : undefined,
                  ),
                  node.id,
                  "group",
                  via === "group" ? node.group : undefined,
                ),
              })
            }
          />
          {text("channel", "Channel", "email")}
          {text("campaign", "Campaign")}
          {node.via === "sourced" ? text("source", "List", "import:12") : null}
          {node.via === "group" ? text("group", "Group", "12") : null}
          <label className="flex items-start gap-2 text-[13.5px] text-(--ui-ink)">
            <input
              type="checkbox"
              checked={node.parked === true}
              onChange={(e) => put("parked", e.target.checked ? true : undefined)}
              className="mt-0.5"
            />
            <span>
              Parked
              <span className={cx(SAY, "block")}>Opens nothing. Keeps its numbers.</span>
            </span>
          </label>
        </PanelBlock>
      );
    case "step":
      return (
        <>
          <PanelBlock title="This step">
            <Pick
              label="What happens"
              value={node.action}
              options={ACTIONS.map((a) => [a, ACTION_LABEL[a]] as const)}
              onPick={(a) => put("action", a)}
            />
            <Pick
              label="Research on arrival"
              value={node.research ?? "none"}
              options={RESEARCH_LEVELS.map((r) => [r, RESEARCH_LABEL[r]] as const)}
              onPick={(r) => put("research", r === "none" ? undefined : r)}
            />
            <IdleDays value={node.idleDays} onChange={(n) => put("idleDays", n)} />
          </PanelBlock>
          <Rules
            rules={rulesOf(node)}
            onChange={(r) => onChange({ ...draft, body: setRules(draft.body, node.id, r) })}
          />
        </>
      );
    case "offer":
      return (
        <>
          <PanelBlock title="This offer">
            <OfferPick at={at} value={node.offer} onPick={(id) => put("offer", id)} />
            <Pick
              label="Research on arrival"
              value={node.research ?? "none"}
              options={RESEARCH_LEVELS.map((r) => [r, RESEARCH_LABEL[r]] as const)}
              onPick={(r) => put("research", r === "none" ? undefined : r)}
            />
            <IdleDays value={node.idleDays} onChange={(n) => put("idleDays", n)} />
          </PanelBlock>
          <Rules
            rules={rulesOf(node)}
            onChange={(r) => onChange({ ...draft, body: setRules(draft.body, node.id, r) })}
          />
        </>
      );
    case "plan":
      return (
        <>
          <PanelBlock title="This plan">
            <TermsPick
              at={at}
              offer={offerBefore(draft.body, node.id)}
              value={node.terms}
              onPick={(p) => put("terms", p)}
            />
            <IdleDays value={node.idleDays} onChange={(n) => put("idleDays", n)} />
          </PanelBlock>
          <Rules
            rules={rulesOf(node)}
            onChange={(r) => onChange({ ...draft, body: setRules(draft.body, node.id, r) })}
          />
        </>
      );
  }
}

// --- remove ----------------------------------------------------------------------------------

/**
 * Removing a node. People on it make the person choose: move them to another node, or let them
 * stay as ghosts (the Map keeps showing them on the dropped node). The server leaves ghosts in
 * any case; the move is an order it carries out in the same save.
 */
function Remove({
  node,
  here,
  draft,
  onChange,
  onGone,
}: {
  node: ShapeNode;
  here: readonly Person[];
  draft: Draft;
  onChange: (next: Draft) => void;
  onGone: () => void;
}) {
  const targets = draft.body.nodes.filter((n) => n.id !== node.id && n.kind !== "source");
  // Held here until the node goes: a move for a node still in the shape means nothing to the draft.
  const [target, setTarget] = useState("");
  const drop = (moveTo?: string) => {
    const moves = { ...draft.moves };
    if (moveTo) moves[node.id] = moveTo;
    else delete moves[node.id];
    onChange({ body: removeNode(draft.body, node.id), moves });
    onGone();
  };
  return (
    <PanelBlock title="Remove">
      {here.length ? (
        <>
          <p role="status" className="text-(--ui-ink)">
            {here.length === 1 ? "1 person is here." : `${here.length} people are here.`} They stay
            on a removed node as ghosts, or you move them.
          </p>
          <Pick
            label="Move them to"
            value={target}
            empty="Pick a node"
            options={targets.map((n) => [n.id, n.name] as const)}
            onPick={setTarget}
          />
          <div className="flex flex-wrap gap-2">
            <Button tone="secondary" size="dense" disabled={!target} onClick={() => drop(target)}>
              Move them and remove
            </Button>
            <Button tone="quiet" size="dense" onClick={() => drop()}>
              Keep as ghosts
            </Button>
          </div>
        </>
      ) : (
        <div>
          <Button tone="secondary" size="dense" onClick={() => drop()}>
            Remove {node.name}
          </Button>
        </div>
      )}
    </PanelBlock>
  );
}

// --- the panels ------------------------------------------------------------------------------

function Head({ title, sub, onClose }: { title: string; sub: string; onClose: () => void }) {
  return (
    <header className="flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-[17px]/6 font-semibold">{title}</h2>
        <p className="text-[13px] text-(--ui-ink-3)">{sub}</p>
      </div>
      <Button tone="quiet" size="dense" icon="close" onClick={onClose}>
        Close
      </Button>
    </header>
  );
}

/** One node's fields: its name, the fields of its kind, its rules and its removal. */
export function NodeEdit({
  id,
  draft,
  people,
  at,
  onChange,
  onHistory,
  onClose,
}: PanelProps & {
  id: string;
  /** Open journeys on the saved shape's nodes. */
  people: readonly Person[];
  at: Record<string, string>;
  /** A line of the node's history was picked: History opens on its version. */
  onHistory: (line: BlameLine) => void;
}) {
  const node = draft.body.nodes.find((n) => n.id === id);
  if (!node) return null;
  const here = peopleOn(people, id);
  return (
    <section
      aria-label={`${node.name}, edit`}
      className={cx(OVER_RIGHT, "text-[14px] text-(--ui-ink)")}
    >
      <Head
        title={node.name}
        sub={`${TITLE[node.kind]}${node.kind === "source" ? "" : ` · ${here.length === 1 ? "1 person" : `${here.length} people`} here`}`}
        onClose={onClose}
      />
      <CommitInput
        scope={id}
        value={node.name}
        label="Name"
        maxLength={80}
        onCommit={(v) =>
          v.trim() && onChange({ ...draft, body: renameNode(draft.body, id, v.trim()) })
        }
      />
      <Fields node={node} draft={draft} at={at} onChange={onChange} />
      <BlameList at={at} ask={{ node: id }} label="Node history" onOpen={onHistory} />
      <Remove key={id} node={node} here={here} draft={draft} onChange={onChange} onGone={onClose} />
    </section>
  );
}

/** One line's label and kind, and its removal. */
export function EdgeEdit({
  id,
  draft,
  at,
  onChange,
  onHistory,
  onClose,
}: PanelProps & {
  id: string;
  at: Record<string, string>;
  /** A line of the wire's history was picked: History opens on its version. */
  onHistory: (line: BlameLine) => void;
}) {
  const edge = draft.body.edges.find((e) => e.id === id);
  if (!edge) return null;
  const nameOf = (n: string) => draft.body.nodes.find((x) => x.id === n)?.name ?? n;
  // The other kind, and why the line may not become it.
  const other = edge.kind === "loop" ? "flow" : "loop";
  const why = kindReason(draft.body, id, other);
  return (
    <section
      aria-label={`${nameOf(edge.from)} to ${nameOf(edge.to)}, edit`}
      className={cx(OVER_RIGHT, "text-[14px] text-(--ui-ink)")}
    >
      <Head
        title={`${nameOf(edge.from)} to ${nameOf(edge.to)}`}
        sub={edge.kind === "loop" ? "Loop line" : "Flow line"}
        onClose={onClose}
      />
      <PanelBlock title="This line">
        <CommitInput
          scope={id}
          value={edge.label ?? ""}
          label="Label"
          maxLength={60}
          placeholder="Replied"
          onCommit={(v) => onChange({ ...draft, body: labelEdge(draft.body, id, v) })}
        />
        <Pick
          label="Kind"
          value={edge.kind}
          options={[
            ["flow", "Flow: forward through the shape"],
            ["loop", "Loop: back to an earlier node"],
          ]}
          onPick={(k) => {
            if (k === other && !why) onChange({ ...draft, body: setKind(draft.body, id, other) });
          }}
          hint={why ?? undefined}
        />
      </PanelBlock>
      <BlameList at={at} ask={{ edge: id }} label="Line history" onOpen={onHistory} />
      <PanelBlock title="Remove">
        <div>
          <Button
            tone="secondary"
            size="dense"
            onClick={() => {
              onChange({ ...draft, body: removeEdge(draft.body, id) });
              onClose();
            }}
          >
            Remove this line
          </Button>
        </div>
      </PanelBlock>
    </section>
  );
}
