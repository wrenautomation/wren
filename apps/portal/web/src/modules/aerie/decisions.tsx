/**
 * Aerie › Decisions (aerie D13, D16): what only a person decides, one card each. An answer is held for
 * the undo (`holdWithUndo`, Studio's Approve): the card leaves at once, the call goes when the toast
 * does. A card that blocks tasks locks while the board says web writes are off (the route refuses it).
 */

import {
  Button,
  Copyable,
  cx,
  Empty,
  holdWithUndo,
  Icon,
  Leaves,
  LoadFailed,
  Loading,
  RisingNumber,
  recordKey,
  relative,
  Segmented,
  useEdit,
  useHeld,
} from "@wren/ui";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { PageProps } from "../../module.js";
import { href } from "../../route.js";
import { Markdown } from "../canon/parts.js";
import { dayLabel } from "../work/bits.js";
import { TASKS } from "./address.js";
import {
  type DecisionRow,
  decide,
  decisionOrder,
  useBoard,
  useDecisions,
  useRows,
} from "./data.js";
import { who } from "./look.js";
import { isNoActor, NoActor } from "./no-actor.js";

const DECISIONS = "/aerie/decisions";
const MANY = "aerie-decisions";

const EYEBROW =
  "m-0 text-[13px] leading-[18px] font-semibold text-(--ui-ink-3) outline-none [letter-spacing:var(--ui-label-tracking)] [text-transform:var(--ui-label-case)] max-sm:text-[12px]";
// one key column for every row of a card (subgrid): "keep" and "a" share the text edge
const ROW =
  "col-span-2 grid w-full grid-cols-subgrid items-baseline rounded-(--ui-leaf-button) px-3 py-2.5 text-left";
const ACCENT = "shadow-[inset_0_0_0_1.5px_var(--ui-accent)] bg-(--ui-accent-wash)";
const HOVER = "[@media(hover:hover)_and_(pointer:fine)]:hover:bg-(--ui-hover)";
const FIELD =
  "w-full rounded-(--ui-leaf-button) border-0 bg-(--ui-paper) px-3 py-2 text-[13.5px] text-(--ui-ink) shadow-[inset_0_0_0_1px_var(--ui-hair)] outline-none placeholder:text-(--ui-ink-3) focus:shadow-[inset_0_0_0_1px_var(--ui-ink-3)]";

const today = () => new Date().toISOString().slice(0, 10);

export function DecisionsPage({ params }: PageProps) {
  const open = params.get("open") !== "0";
  const board = useBoard();
  const got = useDecisions(open);
  const tasks = useRows();
  const held = useHeld(MANY);
  const reread = got.retry;
  // a press that landed: read again, so the card it took is gone for good
  const landed = useRef(held.landed);
  useEffect(() => {
    if (landed.current === held.landed) return;
    landed.current = held.landed;
    reread();
  }, [held.landed, reread]);

  const rows = useMemo(
    () => got.data && decisionOrder(got.data, open).filter((d) => !held.ids.has(String(d.id))),
    [got.data, open, held.ids],
  );
  const titles = useMemo(
    () => tasks.data && new Map(tasks.data.rows.map((t) => [t.id, t.title])),
    [tasks.data],
  );
  // null until the board reads: a card that blocks tasks stays locked till then
  const writes = board.data ? board.data.writes : null;

  // focus after a card leaves: the next card, else the heading (never the body)
  const head = useRef<HTMLHeadingElement>(null);
  const cards = useRef(new Map<number, HTMLElement>());
  const next = useRef<number | "head" | null>(null);
  useEffect(() => {
    const n = next.current;
    if (n === null || !rows) return;
    next.current = null;
    (n === "head" ? head.current : (cards.current.get(n) ?? head.current))?.focus();
  }, [rows]);

  const answer = (d: DecisionRow, key: string, why: string) => {
    const shown = rows ?? [];
    const i = shown.indexOf(d);
    const after = shown[i + 1] ?? shown[i - 1];
    const ok = holdWithUndo({
      press: {
        key: `held aerie:decide:${d.id}`,
        what: "aerie.decide",
        label: "Answer",
        records: [recordKey(MANY, d.id)],
      },
      // a failure can still leave it answered (the store answers, then edits the tasks): read again;
      // a 403 means writes went off since the board read: the board again, so the card locks
      commit: (requestId) =>
        decide(d, key, why, requestId).catch((err) => {
          reread();
          board.retry();
          throw err;
        }),
      line: `Answered ${key}: ${d.question}`,
    });
    if (ok) next.current = after ? after.id : "head";
  };

  const err = got.error ?? board.error;
  if (isNoActor(err))
    return (
      <div className="w-full max-w-[720px] min-w-0">
        <NoActor error={err} />
      </div>
    );

  let body: ReactNode;
  const kind =
    got.error && !got.data ? "failed" : !rows ? "loading" : rows.length ? "list" : "empty";
  if (got.error && !got.data) body = <LoadFailed error={got.error} onRetry={got.retry} />;
  else if (!rows) body = <Loading shape="cards" lines={3} label="Loading decisions" />;
  else if (!rows.length)
    body = open ? (
      <Empty title="No decisions wait on you" waits>
        Agents ask here with <code>aerie ask</code>.
      </Empty>
    ) : (
      <Empty title="Nothing answered yet" waits>
        Answers you give show here.
      </Empty>
    );
  else
    body = (
      <Leaves items={rows} keyOf={(d) => String(d.id)} className="grid gap-3">
        {(d) => (
          <DecisionCard
            d={d}
            titles={titles}
            locked={open && d.blocks.length > 0 && writes !== true}
            onAnswer={(key, why) => answer(d, key, why)}
            refOf={(el) => {
              if (el) cards.current.set(d.id, el);
              else cards.current.delete(d.id);
            }}
          />
        )}
      </Leaves>
    );

  return (
    <section aria-labelledby="aerie-decisions" className="grid w-full max-w-[720px] min-w-0 gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 id="aerie-decisions" ref={head} tabIndex={-1} className={EYEBROW}>
          {open ? "Open" : "Answered"}
          {rows ? (
            <>
              {" · "}
              <RisingNumber n={rows.length} className="[font-weight:inherit]" />
            </>
          ) : null}
        </h2>
        <Segmented
          label="Which decisions"
          className="w-[184px]"
          items={[
            { id: "open", label: "Open", href: href(DECISIONS, { open: null }, params), on: open },
            {
              id: "answered",
              label: "Answered",
              href: href(DECISIONS, { open: "0" }, params),
              on: !open,
            },
          ]}
        />
      </div>
      {/* a new tab or state (loading, failed, empty, list) fades in; inside the list, cards move */}
      <div key={`${open}:${kind}`} className="[animation:ui-fade_.15s_both]">
        {body}
      </div>
    </section>
  );
}

function DecisionCard({
  d,
  titles,
  locked,
  onAnswer,
  refOf,
}: {
  d: DecisionRow;
  /** task id → title; null while the tasks read */
  titles: ReadonlyMap<string, string> | null | undefined;
  locked: boolean;
  onAnswer: (key: string, why: string) => void;
  refOf: (el: HTMLElement | null) => void;
}) {
  // a why half typed survives a reload; an answer clears it
  const why = useEdit(d.answeredAt ? null : `aerie-decide-why:${d.id}`, "");
  const own = useEdit(d.answeredAt || d.options.length ? null : `aerie-decide-own:${d.id}`, "");
  const answered = !!d.answeredAt;
  // locked: the key the CLI line runs; the recommendation until the person picks
  const [cli, setCli] = useState(d.recommendation ?? d.options[0]?.key ?? null);
  const late = !answered && !!d.due && d.due.slice(0, 10) < today();
  const send = (key: string) => {
    onAnswer(key, why.value.trim());
    why.saved();
    own.saved();
  };
  const q = `decision-${d.id}`;

  return (
    <article
      ref={refOf}
      tabIndex={-1}
      aria-labelledby={q}
      className="grid min-w-0 gap-3 rounded-(--ui-leaf-panel) bg-(--ui-paper) p-4 shadow-(--ui-raise) outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ui-focus) max-sm:p-3.5"
    >
      <p className="m-0 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] font-medium text-(--ui-ink-3)">
        {d.area ? <span className="wrap-anywhere">{d.area}</span> : null}
        {d.area ? <span aria-hidden="true">·</span> : null}
        <span className="wrap-anywhere">{who(d.askedBy)}</span>
        <span aria-hidden="true">·</span>
        <time dateTime={d.askedAt}>{relative(new Date(d.askedAt))}</time>
        {d.due && !answered ? (
          <>
            <span aria-hidden="true">·</span>
            <span
              className={cx(
                "rounded-(--ui-leaf-chip) transition-colors duration-300",
                late && "bg-(--ui-warn-tint) px-1.5 text-(--ui-warn-ink)",
              )}
            >
              {late ? "Overdue, " : ""}due {dayLabel(d.due)}
            </span>
          </>
        ) : null}
      </p>
      <h3
        id={q}
        className="m-0 text-[15px]/[1.4] font-semibold text-pretty wrap-anywhere text-(--ui-ink)"
      >
        {d.question}
      </h3>
      {d.brief ? (
        <div className="min-w-0 text-[13.5px]/[1.55] text-(--ui-ink-2) wrap-anywhere">
          <Markdown text={d.brief} />
        </div>
      ) : null}
      {d.blocks.length ? <Blocks ids={d.blocks} titles={titles} /> : null}

      {d.options.length ? (
        <fieldset
          aria-label={locked && !answered ? "Answer to run in the CLI" : "Answers"}
          className="m-0 grid min-w-0 grid-cols-[auto_1fr] gap-x-2 gap-y-1.5 border-0 p-0"
        >
          {d.options.map((o) => (
            <Option
              key={o.key}
              o={o}
              recommended={o.key === d.recommendation}
              picked={answered ? o.key === d.answer : null}
              onPick={locked || answered ? null : () => send(o.key)}
              choose={
                locked && !answered
                  ? { name: q, on: o.key === cli, pick: () => setCli(o.key) }
                  : null
              }
            />
          ))}
        </fieldset>
      ) : answered ? null : (
        <form
          className="flex gap-2 max-sm:flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            const v = own.value.trim();
            if (v && !locked) send(v);
          }}
        >
          <input
            {...own.field}
            aria-label="Your answer"
            placeholder="Your answer"
            className={FIELD}
            disabled={locked}
          />
          <Button size="sm" tone="primary" type="submit" disabled={locked || !own.value.trim()}>
            Answer
          </Button>
        </form>
      )}

      {answered ? (
        <p className="m-0 text-[12.5px] text-(--ui-ink-2)">
          <span className="wrap-anywhere text-pretty">
            {d.options.some((o) => o.key === d.answer) ? `${d.answer}` : `“${d.answer}”`} from{" "}
            {who(d.answeredBy ?? "")}
            {d.answeredAt ? ` · ${relative(new Date(d.answeredAt))}` : ""}
            {d.why ? `. Why: ${d.why}` : ""}
          </span>
        </p>
      ) : locked ? (
        <div className="grid gap-1.5 text-[12.5px] text-(--ui-ink-2) [animation:ui-fade_.15s_both]">
          <span>
            Answers that move tasks wait for the switch.{" "}
            {d.options.length ? "Run the one you pick in the CLI:" : "Answer in the CLI:"}
          </span>
          {/* a new pick: the line fades to its new key */}
          <div key={cli} className="[animation:ui-fade_.15s_both]">
            <Copyable text={`aerie decide ${d.id} ${cli ?? "<answer>"}`} />
          </div>
        </div>
      ) : d.options.length ? (
        <input
          {...why.field}
          aria-label="Why (optional)"
          placeholder="Why (optional)"
          className={FIELD}
        />
      ) : null}
    </article>
  );
}

function Option({
  o,
  recommended,
  picked,
  onPick,
  choose,
}: {
  o: DecisionRow["options"][number];
  recommended: boolean;
  /** answered: was this the answer; null while open */
  picked: boolean | null;
  /** null: shown, not pressable (locked, or answered) */
  onPick: (() => void) | null;
  /** locked: a radio that picks the CLI line's key; the picked row is outlined */
  choose: { name: string; on: boolean; pick: () => void } | null;
}) {
  const inner = (
    <>
      <span className="min-w-5 text-[12px] font-semibold text-(--ui-ink-3) tabular-nums">
        {picked ? <Icon name="check" size={13} className="text-(--ui-good)" /> : o.key}
      </span>
      <span className="grid min-w-0 gap-0.5">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span
            className={cx(
              "text-[13.5px]/[1.45] wrap-anywhere",
              picked === false ? "text-(--ui-ink-3)" : "text-(--ui-ink)",
            )}
          >
            {o.text}
          </span>
          {recommended ? (
            <span className="text-[11.5px] font-semibold text-(--ui-accent)">Recommended</span>
          ) : null}
        </span>
        {o.cost ? (
          <span className="text-[12px] text-(--ui-ink-3) wrap-anywhere">{o.cost}</span>
        ) : null}
      </span>
    </>
  );
  const edge = recommended ? ACCENT : "shadow-[inset_0_0_0_1px_var(--ui-hair)]";
  if (choose)
    // plain rows, so a locked card never reads as one click away; the outline is the pick
    return (
      <label
        className={cx(
          ROW,
          "relative cursor-pointer transition-[background-color,box-shadow] duration-150 ease-(--ui-ease) has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-(--ui-focus)",
          choose.on ? ACCENT : HOVER,
        )}
      >
        <input
          type="radio"
          name={choose.name}
          checked={choose.on}
          onChange={choose.pick}
          className="sr-only"
        />
        {inner}
      </label>
    );
  if (!onPick)
    return (
      <div
        className={cx(
          ROW,
          picked
            ? "bg-(--ui-canvas) shadow-[inset_0_0_0_1px_var(--ui-hair)]"
            : picked === null && edge,
        )}
      >
        {inner}
      </div>
    );
  return (
    <button
      type="button"
      onClick={onPick}
      className={cx(
        ROW,
        edge,
        "cursor-pointer border-0 transition-[background-color,transform] duration-150 ease-(--ui-ease) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ui-focus) active:scale-[0.98] motion-reduce:active:scale-100",
        HOVER,
        !recommended && "bg-transparent",
      )}
    >
      {inner}
    </button>
  );
}

/** the tasks an answer moves: linked while their row is known; an archived one is the id alone */
function Blocks({
  ids,
  titles,
}: {
  ids: readonly string[];
  titles: ReadonlyMap<string, string> | null | undefined;
}) {
  return (
    <p className="m-0 flex flex-wrap gap-x-3 gap-y-1 text-[12.5px] text-(--ui-ink-2)">
      <span className="text-(--ui-ink-3)">Blocks</span>
      {ids.map((id) => {
        const title = titles?.get(id);
        const gone = titles && title === undefined;
        return gone ? (
          <span key={id} className="tabular-nums">
            {id}
          </span>
        ) : (
          <a
            key={id}
            href={href(TASKS, { task: id })}
            className="min-w-0 text-(--ui-link) no-underline hover:underline wrap-anywhere"
          >
            <span className="tabular-nums">{id}</span>
            {title ? (
              <>
                {" "}
                <span className="text-(--ui-ink-2)">{title}</span>
              </>
            ) : null}
          </a>
        );
      })}
    </p>
  );
}
