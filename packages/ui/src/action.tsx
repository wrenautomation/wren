/**
 * A record's actions: `useRun` asks first when the action says to, calls the handler by id, says
 * how it went in a toast, and offers undo.
 */
import { type ReactNode, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import type { Access } from "./access.js";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog.js";
import { Input } from "./components/ui/input.js";
import { Toaster } from "./components/ui/sonner.js";
import { Textarea } from "./components/ui/textarea.js";
import { Button } from "./controls.js";
import { tellTabsLanded } from "./data/local.js";
import { refreshAll, useLoad } from "./data/query.js";
import { EditConflict } from "./data/use-edit.js";
import { DictateField } from "./dictate.js";
import { forgetKept, useEditForm } from "./edit-form.js";
import { type MessageKind, MessagePreview } from "./preview.js";
import {
  type PressOptions,
  recordKey,
  stableKey,
  WRITES,
  type Write,
  type Writes,
} from "./save/writes.js";
import { InsertSnippet } from "./snippets.js";

/** A box a form action asks for, required unless `optional`. */
export interface FormField {
  /** Its path in the input: `parent.child` sends `{ parent: { child } }`. */
  field: string;
  label: string;
  /**
   * Left out: a line of text. A file is sent as the `File`; the `Call` puts it up. `lines` and
   * `numbers` are one item per line, `json` any JSON value, `pick` any of `options` as a list.
   * `combo` is a line of text with `choices` offered under it: a typed value that matches none
   * is still sent.
   */
  type?:
    | "long"
    | "date"
    | "number"
    | "url"
    | "file"
    | "switch"
    | "select"
    | "lines"
    | "numbers"
    | "pick"
    | "combo"
    | "json";
  optional?: true;
  /** A select's or a pick's choices. */
  options?: readonly string[];
  /** A combo's choices: a read handler (called with no input) and the values in its answer. */
  choices?: { handler: string; list: (answer: unknown) => readonly string[] };
  /** A choice as people read it, by value; the value itself when absent. */
  labels?: Readonly<Record<string, string>>;
  /** Said under the box. */
  hint?: string;
  /** The pattern its value must match, as in HTML. */
  pattern?: string;
  /** Its value until typed over, from the fields before it: a short name from the name. */
  from?: (values: Record<string, string>) => string;
}

/** Something to do. A button, the ⌘K palette and a form all read this one definition. */
export interface Action {
  id: string;
  label: string;
  /** The portal handler it calls: "delivery/approve". */
  handler: string;
  /** The handler's zod schema, for a generated form. */
  input?: unknown;
  requires?: Access;
  /** Asked before it runs. */
  confirm?: string;
  /**
   * A text asked before it runs, into `field` of the input: "why" for a pause, the draft for an
   * approve. It starts from the record's `from` field (else `field`) and goes only when changed,
   * so an untouched draft isn't sent as an edit. E opens it when no action has E for its key.
   * With `preview`, the text shows as it will look on a laptop and a phone while it's typed.
   */
  ask?: {
    field: string;
    label: string;
    from?: string;
    /** Or loaded for the record when the box opens: a line of copy needs its email around it. */
    preview?: MessageKind | ((id: string | number) => Promise<MessageKind | null>);
  };
  /**
   * Makes a record, so it takes no ids and applies to no row. The list shows its button by the
   * title; a press asks for these fields and sends them as the input.
   */
  form?: readonly FormField[];
  /** The form is asked on records instead, and sent with their `{ids}`. */
  each?: true;
  /** The toast after it worked, from the handler's answer. */
  done?: (answer: unknown) => string;
  /**
   * Said the moment it's sent ("Sent"): the records leave the list at once and the next one
   * opens while the call runs. A refusal brings them back with its words.
   */
  optimistic?: string;
  /**
   * The rest is for a record's action, called as `{ids}`; an answer's `done` ids are the ones
   * it changed. Its shortcut in a list or a queue: "a".
   */
  key?: string;
  /** Offered on a selection. */
  bulk?: true;
  /**
   * The handler that reverses it, on the same ids. Given, the action runs at once with 10 seconds
   * to undo it; without one, it asks first (`confirm`, or its label).
   */
  undo?: string;
  /** The states a record must be in for it to apply: `{ status: ["awaiting"] }`. */
  when?: Readonly<Record<string, readonly string[]>>;
  /**
   * Why it can't run on a record yet, by field and value: `{ format: { carousel: "..." } }`. The
   * button shows, turned off, with the reason; a key says the reason; a selection skips the row.
   */
  blocked?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** What it sets on a record, so the demo can do it in the browser: `{ status: "approved" }`. */
  sets?: Readonly<Record<string, string>>;
  /**
   * Run from inside the record's detail only (its draft box: save, ask, undo): never a button, a
   * key or a palette line.
   */
  inline?: true;
  /**
   * It sends the version of the record the person sees as `expect`, so the server refuses it
   * (409, `code: "conflict"`) when the record changed since: Approve on words he never read.
   */
  expect?: true;
}

/** Calls a portal handler ("email/pause") with its input; rejects with the refusal's words. */
export type Call = (handler: string, input: Record<string, unknown>) => Promise<unknown>;

/** The input as sent: the asked field only when the text differs from where it started. */
export function inputOf(
  action: Action,
  input: Record<string, unknown>,
  text: string,
): Record<string, unknown> {
  const field = action.ask?.field;
  if (!field) return input;
  const { [field]: start, ...rest } = input;
  const said = text.trim();
  return said && said !== String(start ?? "").trim() ? { ...rest, [field]: said } : rest;
}

/**
 * Words to paste by hand and the page to paste them on: a review read off Google Maps, which no
 * API answers. A handler's answer carries it as `copy`.
 */
export interface Copied {
  text: string;
  url: string;
}

/** The `copy` in a handler's answer, bare or under `answer`. */
export function copiedIn(answer: unknown): Copied | null {
  const a = answer as { copy?: Copied | null; answer?: { copy?: Copied | null } } | null;
  const c = a?.copy ?? a?.answer?.copy ?? null;
  return c && typeof c.text === "string" && /^https:\/\//.test(c.url) ? c : null;
}

/** Copy the words, then open the page. A click's own handler, so the browser allows both. */
export function copyAndOpen(c: Copied) {
  void navigator.clipboard?.writeText(c.text).then(
    () => toast.success("Copied. Paste it as the owner's reply."),
    () => toast.error("Couldn't copy. Select the words in the thread."),
  );
  window.open(c.url, "_blank", "noopener");
}

/** How long an undo is offered. */
export const UNDO_MS = 10_000;

/** The ids an answer says it changed (`done`), else all that were asked. */
export function doneOf(answer: unknown, ids: readonly (string | number)[]) {
  const done = (answer as { done?: unknown } | null)?.done;
  return Array.isArray(done) ? (done as (string | number)[]) : [...ids];
}

/** Whether a record is in a state `action` applies to. */
export function applies(action: Action, row: Record<string, unknown>): boolean {
  return (
    (!action.form || !!action.each) &&
    Object.entries(action.when ?? {}).every(([k, states]) => states.includes(String(row[k])))
  );
}

/** Why `action` can't run on this record yet, or null (`Action.blocked`). */
export function blockedOf(action: Action, row: Record<string, unknown>): string | null {
  for (const [k, why] of Object.entries(action.blocked ?? {})) {
    const v = row[k];
    if (v !== null && v !== undefined && Object.hasOwn(why, String(v)))
      return why[String(v)] ?? null;
  }
  return null;
}

/** It applies to this record and nothing blocks it: it can run now. */
export const runs = (action: Action, row: Record<string, unknown>) =>
  applies(action, row) && !blockedOf(action, row);

/** A key pressed for a blocked action: says why and runs nothing. True when it was blocked. */
export function sayBlocked(action: Action, row: Record<string, unknown>): boolean {
  const why = blockedOf(action, row);
  if (why) toast(why);
  return !!why;
}

/** Words that set a record aside rather than move it on. */
const ASIDE =
  /\b(delete|remove|archive|take out|void|drop|hide|dismiss|withdraw|retire|skip|reject|decline|don't|pass)\b/i;

/** Does an action by this label set a record aside? */
export const setsAside = (label: string) => ASIDE.test(label);

/**
 * It sets a record aside and has no handler to take it back (Delete, Archive, Skip): it never
 * asks. The record leaves at once with an undo toast, and the call goes when the toast does.
 */
export const held = (a: Action) =>
  !a.undo && !a.form && !a.ask && !a.optimistic && ASIDE.test(a.label);

/**
 * The ids of `many` out of lists now (set aside and waiting out their undo, or gone ahead of an
 * optimistic call), and a count that moves each time one of those writes lands (a list reads
 * again). Both come from `WRITES`: a hidden tab, a remount or a reload keeps them.
 */
export function useHeld(
  many: string,
  writes: Writes = WRITES,
): { ids: ReadonlySet<string>; landed: number } {
  const snap = useSyncExternalStore(writes.subscribe, writes.snapshot, writes.snapshot);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `snap` is what moves them.
  return useMemo(
    () => ({ ids: writes.hiddenIn(many), landed: writes.landed() }),
    [snap, many, writes],
  );
}

/**
 * The newest press on a record (of these actions when named), live: a box shows from it that
 * its words are still going, went, or were refused and why, after a remount or a reload too.
 */
export function useLastWrite(
  record: string | null | undefined,
  what?: readonly string[],
  writes: Writes = WRITES,
): Write | null {
  const snap = useSyncExternalStore(writes.subscribe, writes.snapshot, writes.snapshot);
  const names = what?.join("|");
  // biome-ignore lint/correctness/useExhaustiveDependencies: `snap` is what moves it; `names` is `what`.
  return useMemo(
    () => (record ? writes.lastOn(record, what) : null),
    [snap, record, names, writes],
  );
}

// How a write that settled out of sight went, said when the tab shows; the page reads again.
WRITES.use({
  reread: refreshAll,
  // The other tabs of this person read again too.
  landed: () => tellTabsLanded(),
  tell: (w) =>
    w.status === "failed"
      ? void toast.error(`${w.label ?? "A change"} didn't go through: ${w.error ?? "it failed."}`, {
          duration: Number.POSITIVE_INFINITY,
        })
      : void toast.success(w.label ? `${w.label}: done` : "Your change went through."),
});

/** A form's values: each field as typed, else as its `from` makes it. */
export function valuesOf(form: readonly FormField[], typed: Record<string, string>) {
  const values: Record<string, string> = {};
  for (const f of form)
    if (f.type !== "file") values[f.field] = typed[f.field] ?? f.from?.(values) ?? "";
  return values;
}

/** One box's text as the value it sends; a bad number or JSON throws, naming the box. */
function sentOf(f: FormField, text: string): unknown {
  const bad = (what: string): never => {
    throw new Error(`${f.label}: ${what}`);
  };
  switch (f.type) {
    case "number":
      return Number.isFinite(Number(text)) ? Number(text) : bad("not a number");
    case "switch":
      return text === "true";
    case "lines":
    case "numbers": {
      const items = text
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      if (f.type === "lines") return items;
      return items.map((l) =>
        Number.isFinite(Number(l)) ? Number(l) : bad(`${l} is not a number`),
      );
    }
    case "pick":
      return text.split(",").filter(Boolean);
    case "json":
      try {
        return JSON.parse(text);
      } catch {
        return bad("not JSON");
      }
    default:
      return text;
  }
}

/**
 * A form's values as the input it sends: each box typed (a number, a switch's true or false,
 * lines as a list, parsed JSON), `a.b` nested, and an optional box left empty left out.
 */
export function typedOf(
  form: readonly FormField[],
  values: Record<string, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of form) {
    const text = values[f.field] ?? "";
    // An untouched switch is off; left out only when it's optional.
    if (f.type === "file" || (text.trim() === "" && (f.optional || f.type !== "switch"))) continue;
    const path = f.field.split(".");
    const last = path.pop() as string;
    let at = out;
    for (const p of path) {
      at[p] ??= {};
      at = at[p] as Record<string, unknown>;
    }
    at[last] = sentOf(f, text);
  }
  return out;
}

const SELECT =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

/** One box of a form: its label, the control its type asks for, its hint. */
export function FormBox({
  f,
  id,
  value,
  onText,
  onFile,
  autoFocus,
  edit,
  call,
}: {
  f: FormField;
  id: string;
  value: string;
  onText: (text: string) => void;
  onFile?: ((file: File | undefined) => void) | undefined;
  autoFocus?: boolean | undefined;
  /** Where the form keeps its words (its `useEditForm` key); left out, the owner says why not. */
  edit?: string | null | undefined;
  /** How a combo reads its choices; without it, a combo is a plain line of text. */
  call?: Call | undefined;
}) {
  const required = !f.optional;
  const longBox = useRef<HTMLTextAreaElement>(null);
  const box =
    f.type === "switch" ? (
      <input
        id={id}
        type="checkbox"
        role="switch"
        aria-checked={value === "true"}
        checked={value === "true"}
        onChange={(e) => onText(String(e.target.checked))}
      />
    ) : f.type === "select" ? (
      <select
        id={id}
        className={SELECT}
        value={value}
        onChange={(e) => onText(e.target.value)}
        required={required}
      >
        <option value="">{required ? "Pick one" : "Not set"}</option>
        {(f.options ?? []).map((o) => (
          <option key={o} value={o}>
            {f.labels?.[o] ?? o}
          </option>
        ))}
      </select>
    ) : f.type === "pick" ? (
      <PickBox id={id} f={f} value={value} onText={onText} />
    ) : f.type === "combo" ? (
      <ComboBox
        id={id}
        f={f}
        value={value}
        onText={onText}
        call={call}
        autoFocus={autoFocus}
        edit={edit}
      />
    ) : f.type === "long" || f.type === "lines" || f.type === "numbers" || f.type === "json" ? (
      <DictateField target={longBox} off={f.type !== "long"}>
        <Textarea
          ref={longBox}
          id={id}
          value={value}
          data-edit={edit ?? undefined}
          onChange={(e) => onText(e.target.value)}
          required={required}
          autoFocus={autoFocus}
          rows={4}
          spellCheck={f.type === "long"}
          className={f.type === "json" ? "font-mono" : undefined}
        />
      </DictateField>
    ) : (
      <Input
        id={id}
        type={f.type ?? "text"}
        {...(f.type === "file"
          ? { onChange: (e) => onFile?.(e.target.files?.[0]) }
          : { value, "data-edit": edit ?? undefined, onChange: (e) => onText(e.target.value) })}
        required={required}
        autoFocus={autoFocus}
        {...(f.type === "number" ? { step: "any" } : {})}
        {...(f.pattern ? { pattern: f.pattern } : {})}
      />
    );
  const hint =
    f.hint ??
    (f.type === "lines" || f.type === "numbers"
      ? "One per line."
      : f.type === "json"
        ? "JSON."
        : undefined);
  return (
    // min-w-0: a long option or label never widens the grid it sits in.
    <div className="flex min-w-0 flex-col gap-1.5 text-sm">
      {f.type === "switch" ? (
        <label htmlFor={id} className="flex items-center gap-2">
          {box}
          {f.label}
        </label>
      ) : (
        <>
          <label htmlFor={id}>{f.label}</label>
          {box}
        </>
      )}
      {hint ? <p className="text-(--ui-ink-2)">{hint}</p> : null}
    </div>
  );
}

/**
 * A line of text with the choices of `f.choices` offered under it (a native list). A read that
 * fails says so and leaves the line to type in.
 */
function ComboBox({
  id,
  f,
  value,
  onText,
  call,
  autoFocus,
  edit,
}: {
  id: string;
  f: FormField;
  value: string;
  onText: (text: string) => void;
  call: Call | undefined;
  autoFocus: boolean | undefined;
  edit: string | null | undefined;
}) {
  const source = f.choices;
  const got = useLoad<readonly string[]>(
    call && source ? `combo:${source.handler}` : null,
    async () => (call && source ? source.list(await call(source.handler, {})) : []),
  );
  const listId = `${id}-choices`;
  return (
    <>
      <Input
        id={id}
        value={value}
        list={listId}
        autoComplete="off"
        data-edit={edit ?? undefined}
        onChange={(e) => onText(e.target.value)}
        required={!f.optional}
        autoFocus={autoFocus}
      />
      <datalist id={listId}>
        {(got.data ?? []).map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
      {got.error ? (
        <p role="alert" className="m-0 flex items-center gap-2 text-sm text-(--ui-bad)">
          The list didn't load. {got.error.message}
          <button type="button" className="underline" onClick={got.retry}>
            Try again
          </button>
        </p>
      ) : null}
    </>
  );
}

const PICK =
  "h-7 max-w-full truncate rounded-(--ui-radius) border border-(--ui-line) bg-transparent px-2.5 text-[13px] text-(--ui-ink-2) hover:bg-(--ui-hover) aria-pressed:border-(--ui-active) aria-pressed:bg-(--ui-active)/10 aria-pressed:font-medium aria-pressed:text-(--ui-ink)";

/** Any of a few choices, as toggles; kept as their values split by commas, in `options` order. */
function PickBox({
  id,
  f,
  value,
  onText,
}: {
  id: string;
  f: FormField;
  value: string;
  onText: (text: string) => void;
}) {
  const on = new Set(value.split(",").filter(Boolean));
  const flip = (o: string) => {
    const next = new Set(on);
    if (next.has(o)) next.delete(o);
    else next.add(o);
    onText((f.options ?? []).filter((x) => next.has(x)).join(","));
  };
  return (
    <fieldset id={id} className="m-0 flex min-w-0 flex-wrap gap-1.5 border-0 p-0">
      {(f.options ?? []).map((o) => (
        <button
          key={o}
          type="button"
          aria-pressed={on.has(o)}
          className={PICK}
          onClick={() => flip(o)}
        >
          {f.labels?.[o] ?? o}
        </button>
      ))}
    </fieldset>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** One press's key: the handler and the rows it acts on. */
const pressOf = (handler: string, ids: readonly (string | number)[]) =>
  `${handler}:${ids.map(String).join(",")}`;

/**
 * `call` once per press, through `WRITES`: a second press while the first is out gets the
 * first's answer, and the input carries a `requestId` that stays the same across a retry after
 * a lost answer and a resend after a reload, so the server runs it once. `press` says what it
 * is (the action, its label, its records, its words) for a box that shows how it goes.
 */
export function callOnce(
  call: Call,
  handler: string,
  ids: readonly (string | number)[],
  input: Record<string, unknown>,
  press: Omit<PressOptions, "key"> = {},
  writes: Writes = WRITES,
) {
  return writes.press(
    { key: `${pressOf(handler, ids)} ${stableKey(input)}`, ...press },
    (requestId) => call(handler, { ...input, requestId }),
  );
}

/** The rows an action acts on, as a list of ids. */
type Ids = (string | number)[];

/** The dialog open now: the action, its rows, where its text starts, and why it last failed. */
export interface Asked {
  action: Action;
  ids: Ids;
  start: string;
  /** The refusal of the last try: the dialog stays open and says it. */
  error?: string | null;
}

export interface RunState {
  asked: Asked | null;
  /** The action at work and its ids, for its button. */
  running: { action: string; ids: Ids } | null;
}

/** What a toast needs: sonner's `toast`, or a fake in tests. */
export interface ToastFns {
  success: (line: string | undefined, opts?: Parameters<typeof toast.success>[1]) => unknown;
  error: (line: string) => unknown;
}

export interface RunnerDeps {
  call: Call;
  /** Runs once each call settles, with the ids it changed, so the page reads again. */
  after: (changed: Ids) => void;
  /** The records' plural name: the held set and the dialog's kept typing are under it. */
  many: string;
  /**
   * The version of a record the person sees now (`RecordBody`'s live version, a row's `version`).
   * An action with `expect` sends it, so the server refuses one over words he never saw.
   */
  versionOf?: ((id: string | number) => string | null | undefined) | undefined;
  /** The dialog's typing is sent: forget what the device kept of it. */
  forget?: ((action: Action, ids: Ids) => void) | undefined;
  toast?: ToastFns | undefined;
  /** Where its writes go: `WRITES`, or a test's own. */
  writes?: Writes | undefined;
}

const wordsOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * The input with the record's version as `expect`, when the action asks for it and acts on one
 * record whose version is known. An `expect` already in the input stands.
 */
export function withExpect(
  action: Action,
  ids: readonly (string | number)[],
  input: Record<string, unknown>,
  versionOf?: (id: string | number) => string | null | undefined,
): Record<string, unknown> {
  const [id] = ids;
  if (!action.expect || ids.length !== 1 || id === undefined || "expect" in input) return input;
  const v = versionOf?.(id);
  return v ? { ...input, expect: v } : input;
}

/**
 * A record's actions, plain TypeScript (`useRun` draws it). One action per press: a second
 * press, a second submit or Enter while one is out does nothing. A dialog stays open while its
 * call runs, closes once it worked, and says the refusal if it didn't. One with `undo` runs at
 * once with an undo toast; a set-aside one (`held`) leaves at once and goes when its toast does,
 * or when the tab closes.
 */
export class Runner {
  private state: RunState = { asked: null, running: null };
  private readonly seen = new Set<() => void>();
  /** Presses whose call is out, optimistic ones too. */
  private readonly flying = new Set<string>();
  /** Counts dialogs opened, so a preview that loads late knows it's stale. */
  opened = 0;

  constructor(private deps: RunnerDeps) {}

  /** Take the newest callbacks (a render's `call` and `after` close over its props). */
  update(deps: RunnerDeps) {
    this.deps = deps;
  }

  readonly subscribe = (fn: () => void) => {
    this.seen.add(fn);
    return () => void this.seen.delete(fn);
  };
  readonly snapshot = (): RunState => this.state;
  private set(patch: Partial<RunState>) {
    this.state = { ...this.state, ...patch };
    for (const f of [...this.seen]) f();
  }
  private get toast(): ToastFns {
    return this.deps.toast ?? toast;
  }
  private get writes(): Writes {
    return this.deps.writes ?? WRITES;
  }
  /** What a press says in `WRITES`: its action, label and records. */
  private pressed(action: Action, ids: Ids, input?: Record<string, unknown>, hide = false) {
    return {
      what: action.id,
      label: action.label,
      records: ids.map((id) => recordKey(this.deps.many, id)),
      input: input && (action.ask || action.form) ? input : null,
      hide,
    };
  }
  get busy() {
    return this.state.running !== null;
  }
  /** The dialog open now is this action on these rows. */
  private isAsked(action: Action, ids: Ids) {
    const a = this.state.asked;
    return !!a && a.action.id === action.id && pressOf("", a.ids) === pressOf("", ids);
  }

  /** A press: held, run at once, or asked first. "asked" when its dialog opened. */
  run(action: Action, ids: Ids, start = ""): "asked" | "held" | "sent" | null {
    if ((!ids.length && (!action.form || action.each)) || this.busy) return null;
    if (this.flying.has(pressOf(action.handler, ids))) return null;
    if (held(action)) return this.hold(action, ids) ? "held" : null;
    if (action.undo && !action.ask && !action.form) {
      void this.go(action, ids, { ids });
      return "sent";
    }
    this.opened += 1;
    this.set({ asked: { action, ids, start } });
    return "asked";
  }

  /** Cancel, Esc or a click outside: the dialog closes; a call already out goes on. */
  close() {
    if (this.state.asked) this.set({ asked: null });
  }

  /** The dialog's submit, with the input its boxes make. Once per press. */
  submit(input: Record<string, unknown>): Promise<boolean> {
    const a = this.state.asked;
    if (!a || this.busy) return Promise.resolve(false);
    return this.go(a.action, a.ids, input);
  }

  /** The dialog's input could not be made (a bad number): it says why and stays open. */
  refuse(why: string) {
    const a = this.state.asked;
    if (a) this.set({ asked: { ...a, error: why } });
  }

  /** Run it with this input, no dialog (a row's own box): true once it worked. */
  send(action: Action, ids: Ids, input: Record<string, unknown>): Promise<boolean> {
    return this.busy ? Promise.resolve(false) : this.go(action, ids, input);
  }

  async go(action: Action, ids: Ids, given: Record<string, unknown>): Promise<boolean> {
    const press = pressOf(action.handler, ids);
    // A second press while the first is out: the first's answer is the one.
    if (this.flying.has(press)) return false;
    const input = withExpect(action, ids, given, this.deps.versionOf);
    if (action.optimistic && !action.form && !action.undo)
      return this.goAhead(action, ids, input, press);
    if (this.busy) return false;
    this.flying.add(press);
    const asked = this.isAsked(action, ids) ? this.state.asked : null;
    this.set({
      running: { action: action.id, ids },
      ...(asked ? { asked: { ...asked, error: null } } : {}),
    });
    let changed: Ids = [];
    let ok = false;
    try {
      const answer = await callOnce(
        this.deps.call,
        action.handler,
        ids,
        input,
        this.pressed(action, ids, input),
        this.writes,
      );
      ok = true;
      this.deps.forget?.(action, ids);
      if (this.isAsked(action, ids)) this.set({ asked: null });
      changed = doneOf(answer, ids);
      this.told(action, answer, changed);
    } catch (err) {
      // The dialog stays with its words; closed already, the toast says it (out of sight,
      // `WRITES` says it when the tab shows).
      if (this.isAsked(action, ids)) {
        const a = this.state.asked as Asked;
        this.set({ asked: { ...a, error: wordsOf(err) } });
      } else if (this.writes.showing()) this.toast.error(wordsOf(err));
    } finally {
      this.flying.delete(press);
      this.set({ running: null });
      this.deps.after(changed);
    }
    return ok;
  }

  /** The toast after it worked: its line, with Undo when it can be undone. */
  private told(action: Action, answer: unknown, done: Ids) {
    const line = action.done?.(answer) ?? `${action.label}: done`;
    const undo = action.undo;
    const copied = copiedIn(answer);
    if (copied)
      this.toast.success("Marked answered. Now paste it on Google.", {
        duration: Number.POSITIVE_INFINITY,
        action: { label: "Copy and open", onClick: () => copyAndOpen(copied) },
      });
    else if (!undo || !done.length) this.toast.success(line);
    else
      this.toast.success(line, {
        duration: UNDO_MS,
        action: {
          label: "Undo",
          onClick: () =>
            void callOnce(
              this.deps.call,
              undo,
              done,
              { ids: done },
              { label: "Undo" },
              this.writes,
            ).then(
              (back) => {
                const undone = doneOf(back, []);
                if (undone.length) this.toast.success("Undone");
                else this.toast.error("Too late to undo.");
                this.deps.after(undone);
              },
              (err: unknown) => this.toast.error(wordsOf(err)),
            ),
        },
      });
  }

  /**
   * Out of the list now, the toast now; back with the refusal's words if it fails. A dialog with
   * typing in it opens again with them (what was typed is still on the device).
   */
  private async goAhead(
    action: Action,
    ids: Ids,
    input: Record<string, unknown>,
    press: string,
  ): Promise<boolean> {
    const asked = this.isAsked(action, ids) ? this.state.asked : null;
    this.flying.add(press);
    this.set({ asked: null });
    // Out of the list while it goes: `WRITES` holds that, not this page, so a remount keeps it.
    const going = callOnce(
      this.deps.call,
      action.handler,
      ids,
      input,
      this.pressed(action, ids, input, true),
      this.writes,
    );
    this.toast.success(action.optimistic);
    this.deps.after([]);
    try {
      await going;
      this.deps.forget?.(action, ids);
      this.deps.after(ids);
      return true;
    } catch (err) {
      if (asked && (action.ask || action.form) && !this.state.asked)
        this.set({ asked: { ...asked, error: wordsOf(err) } });
      else if (this.writes.showing()) this.toast.error(`${action.label} failed: ${wordsOf(err)}`);
      this.deps.after([]);
      return false;
    } finally {
      this.flying.delete(press);
    }
  }

  /**
   * Out of the list now with an undo toast. The call goes when its deadline passes: checked by
   * `WRITES` on a return, a reminder and as the page goes, so a hidden tab can't stall it.
   */
  private hold(action: Action, ids: Ids): boolean {
    const { call, after } = this.deps;
    const h = this.writes.hold(
      { key: `held ${pressOf(action.handler, ids)}`, ...this.pressed(action, ids), ms: UNDO_MS },
      (requestId) =>
        call(action.handler, { ids, requestId }).then((answer) => {
          after(ids);
          return answer;
        }),
    );
    // Already set aside and waiting: a second press is the same one.
    if (!h) return false;
    this.set({ asked: null });
    let line = `${action.label}: done`;
    try {
      line = action.done?.(undefined) ?? line;
    } catch {}
    this.toast.success(line, {
      duration: UNDO_MS,
      action: {
        label: "Undo",
        onClick: () => {
          if (!h.undo()) return void this.toast.error("Too late to undo.");
          this.toast.success("Undone");
        },
      },
    });
    return true;
  }
}

/** Where a dialog's typing waits on the device, for this action on these rows. */
const keptKeyOf = (many: string, action: Action, ids: readonly (string | number)[]) =>
  `${many}:${action.id}:${ids.map(String).join(",")}`;

/** What a dialog's form starts from: no box typed in yet (the rest follow their `from`). */
const NO_TYPED: { typed: Record<string, string> } = { typed: {} };

/**
 * Runs a record's actions on ids (`Runner`): one with `undo` at once, with an undo toast for 10
 * seconds; any other asks first. One that `ask`s always asks, its text starting from `start` (an
 * edit's current value). `after` runs once each call settles, with the ids it changed, so the
 * page reads again and can show what moved. `running` is the action at work and its ids, for its
 * button. `versionOf` is the version of a record the person sees, for actions with `expect`.
 */
export function useRun(
  call: Call,
  after: (changed: (string | number)[]) => void,
  names: { one: string; many: string },
  opts: { versionOf?: (id: string | number) => string | null | undefined } = {},
): {
  run: (action: Action, ids: (string | number)[], start?: string) => void;
  /** Runs it with this input, no dialog (a row's own box): true once it worked. */
  send: (
    action: Action,
    ids: (string | number)[],
    input: Record<string, unknown>,
  ) => Promise<boolean>;
  busy: boolean;
  running: { action: string; ids: (string | number)[] } | null;
  dialog: ReactNode;
} {
  const deps: RunnerDeps = {
    call,
    after,
    many: names.many,
    versionOf: opts.versionOf,
    forget: (action, ids) => {
      const k = keptKeyOf(names.many, action, ids);
      forgetKept(`${k}:ask`);
      forgetKept(`${k}:fields`);
    },
  };
  const ref = useRef<Runner | null>(null);
  if (!ref.current) ref.current = new Runner(deps);
  const runner = ref.current;
  runner.update(deps);
  const { asked, running } = useSyncExternalStore(
    runner.subscribe,
    runner.snapshot,
    runner.snapshot,
  );
  // What's typed in the dialog stays on the device until it is sent: closing it, or a
  // reload, gives it back when the same action opens on the same rows.
  const keptKey = asked ? keptKeyOf(names.many, asked.action, asked.ids) : null;
  const start = asked?.start ?? "";
  const askForm = useEditForm({
    key: keptKey && `${keptKey}:ask`,
    defaults: { text: start },
    base: start,
  });
  const fieldsForm = useEditForm({ key: keptKey && `${keptKey}:fields`, defaults: NO_TYPED });
  const text = askForm.watch("text");
  const setText = (t: string) => askForm.setValue("text", t);
  const { typed } = fieldsForm.watch();
  const [files, setFiles] = useState<Record<string, File>>({});
  const [shown, setShown] = useState<MessageKind | null>(null);
  const busy = running !== null;
  const textId = useId();
  const textBox = useRef<HTMLTextAreaElement>(null);

  const run = (action: Action, ids: (string | number)[], start = "") => {
    if (runner.run(action, ids, start) !== "asked") return;
    setFiles({});
    const preview = action.ask?.preview;
    const mine = runner.opened;
    setShown(typeof preview === "function" ? null : (preview ?? null));
    if (typeof preview === "function" && ids[0] !== undefined)
      void preview(ids[0]).then(
        (kind) => mine === runner.opened && setShown(kind),
        () => undefined,
      );
  };
  const ask = asked?.action.ask;
  const form = asked?.action.form;
  const values = form ? valuesOf(form, typed) : {};
  const sendAsked = async () => {
    if (!asked || busy) return false;
    const { action, ids } = asked;
    let input: Record<string, unknown>;
    try {
      input = form
        ? { ...(action.each ? { ids } : {}), ...typedOf(form, values), ...files }
        : ask
          ? inputOf(action, { ids, [ask.field]: start }, text)
          : { ids };
    } catch (err) {
      runner.refuse(wordsOf(err));
      return false;
    }
    // The runner says a refusal in the dialog; false keeps the words.
    return (await runner.submit(input)) ? undefined : false;
  };
  const submit = (form ? fieldsForm : askForm).onSend(sendAsked, { clear: true });

  const n = asked?.ids.length ?? 0;
  const dialog = (
    <Dialog open={!!asked} onOpenChange={(open) => !open && runner.close()}>
      <DialogContent
        className={
          ask?.preview ? "max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-3xl" : undefined
        }
      >
        <form onSubmit={(e) => void submit(e)} className="grid min-w-0 grid-cols-1 gap-4">
          <DialogHeader>
            <DialogTitle>
              {asked?.action.confirm ??
                (form
                  ? asked?.action.label
                  : `${asked?.action.label} ${plural(n, names.one, names.many)}?`)}
            </DialogTitle>
          </DialogHeader>
          {n > 1 ? (
            <p className="text-sm text-(--ui-ink-2)">{plural(n, names.one, names.many)}.</p>
          ) : null}
          {ask ? (
            <div className="flex flex-col gap-1.5 text-sm">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor={textId}>{ask.label}</label>
                <InsertSnippet
                  box={textBox}
                  value={text}
                  onChange={setText}
                  channel={shown?.kind}
                />
              </div>
              <DictateField target={textBox}>
                <Textarea
                  ref={textBox}
                  id={textId}
                  value={text}
                  data-edit="form:text"
                  onChange={(e) => setText(e.target.value)}
                  rows={6}
                />
              </DictateField>
              <EditConflict
                conflict={
                  askForm.conflict
                    ? { mine: askForm.conflict.mine.text ?? "", theirs: start }
                    : null
                }
                onKeepMine={askForm.keepMine}
                onTakeTheirs={askForm.takeTheirs}
              />
              {shown && text.trim() ? <MessagePreview message={shown} body={text} /> : null}
            </div>
          ) : null}
          {form?.map((f, i) => (
            <FormBox
              key={f.field}
              f={f}
              id={`${textId}-${f.field}`}
              value={values[f.field] ?? ""}
              edit="form:typed"
              onText={(text) => fieldsForm.setValue("typed", { ...typed, [f.field]: text })}
              onFile={(file) =>
                setFiles(({ [f.field]: _, ...rest }) =>
                  file ? { ...rest, [f.field]: file } : rest,
                )
              }
              autoFocus={i === 0}
              call={call}
            />
          ))}
          {asked?.error ? (
            <p role="alert" className="m-0 text-sm text-(--ui-bad)">
              {asked.error}
            </p>
          ) : null}
          <DialogFooter>
            <Button tone="quiet" size="dense" onClick={() => runner.close()}>
              Cancel
            </Button>
            <Button tone="primary" size="dense" type="submit" busy={busy}>
              {asked?.action.label}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
  const send = (action: Action, ids: (string | number)[], input: Record<string, unknown>) =>
    runner.send(action, ids, input);
  return { run, send, busy, running, dialog };
}

/** The one place toasts show; an app mounts it once. */
/** A line at the bottom of the screen after a hand-drawn page's write: done, or why not. */
/**
 * A line for the person. Out of sight it says nothing: a write's outcome is said by `WRITES`
 * when the tab shows, and a read reads again then.
 */
export const say = {
  done: (line: string) => void (WRITES.showing() && toast.success(line)),
  failed: (err: unknown) =>
    void (WRITES.showing() && toast.error(err instanceof Error ? err.message : String(err))),
  /** Wren was deployed since this tab opened: one line until he reloads, with the reload on it. */
  stale: (line: string) =>
    void toast.error(line, {
      id: "stale-build",
      duration: Number.POSITIVE_INFINITY,
      action: { label: "Reload", onClick: () => location.reload() },
    }),
};

export function Toasts() {
  return <Toaster position="bottom-center" />;
}
