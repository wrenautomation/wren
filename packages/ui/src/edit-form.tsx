/**
 * Every portal form on React Hook Form (designs/2026-10-16-portal-libs.md, "Forms"). `useEditForm`
 * is RHF's `useForm` with three things added: the values typed and not yet sent are kept in the
 * one edits store (`./data/edits.ts`), so another page, a closed dialog or a reload gives them
 * back; values kept over a different starting point come back as a conflict the person settles;
 * and `onSend` runs the form's write (the one write path), forgets the kept values once it lands
 * and shows a refusal as the form's error. The fields below are the one field set every form
 * draws with: each is an RHF controller, so it validates with the form's schema and carries the
 * `data-edit` mark the edits guard looks for.
 */

import { zodResolver } from "@hookform/resolvers/zod";
import type { AccountOption, AccountPick } from "@wren/core/record-accounts";
import { cn } from "cn";
import {
  type BaseSyntheticEvent,
  type ComponentProps,
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type Control,
  type DefaultValues,
  type FieldPath,
  type FieldValues,
  type Resolver,
  type UseFormReturn,
  useController,
  useForm,
} from "react-hook-form";
import type { z } from "zod";
import { AccountPicker } from "./accounts.js";
import { Input } from "./components/ui/input.js";
import { Textarea } from "./components/ui/textarea.js";
import { EditConflict } from "./data/use-edit.js";
import { browserEnv } from "./save/env.js";
import { readKept, writeForm } from "./save/journal.js";
import { stableKey } from "./save/writes.js";

type Values = Record<string, unknown>;

/** The fields of `values` that differ from `from`: what is worth keeping. */
export function changedFrom(from: Values, values: Values): Values {
  const out: Values = {};
  for (const [k, v] of Object.entries(values)) if (stableKey(v) !== stableKey(from[k])) out[k] = v;
  return out;
}

export interface EditForm<V extends FieldValues> extends UseFormReturn<V> {
  /** Kept values came back from before: another page, a closed dialog, a reload. */
  restored: boolean;
  /**
   * Values kept over another starting point: the form shows them until the person picks. `theirs`
   * is what those fields hold now.
   */
  conflict: { mine: Partial<V>; theirs: Partial<V> } | null;
  keepMine: () => void;
  takeTheirs: () => void;
  /** Values typed and not sent. */
  unsent: boolean;
  /**
   * The form's submit: validate, run `send` (the write), then forget the kept values. `send`
   * returning `false` means it didn't land (its own error shows): the values stay. A throw shows
   * as `error`. After it lands the form holds what was sent, or starts over with `clear`.
   */
  onSend: (
    send: (values: V) => Promise<unknown> | unknown,
    o?: { clear?: boolean },
  ) => (e?: BaseSyntheticEvent) => Promise<void>;
  /** The values went some other way: forget them; the form starts from `next` or its defaults. */
  forget: (next?: V) => void;
  /** Why the last send failed, in words. */
  error: string | null;
}

export interface EditFormOptions<V extends FieldValues> {
  /** Where the unsent values are kept in the edits store; null keeps nothing. */
  key: string | null;
  /** What the form starts from: the server's values, or blanks for a new thing. */
  defaults: V;
  /** Checks the values before `send`; its messages show under each field. */
  schema?: z.ZodType<V> | undefined;
  /** The starting point's version; the defaults themselves when left out. */
  base?: string | undefined;
}

/** A field's value as words: a list as its items. */
const textOf = (v: unknown): string =>
  Array.isArray(v) ? v.map(textOf).join(", ") : v == null ? "" : String(v);

/** Forget what a form kept under `key`, from outside it (the box moved on before the send landed). */
export function forgetKept(key: string) {
  writeForm(browserEnv().storage, key, null, "", Date.now());
}

/** A form whose unsent values survive a page switch, on React Hook Form. */
export function useEditForm<V extends FieldValues>(o: EditFormOptions<V>): EditForm<V> {
  const env = useMemo(() => browserEnv(), []);
  // The server's starting point: a new one (another row, a moved value) starts over.
  const at = `${o.key}\u0000${o.base ?? stableKey(o.defaults)}`;
  // Values just sent stand as the starting point until the server's own catch up.
  const [since, setSince] = useState<{ at: string; values: V } | null>(null);
  const sent = since?.at === at ? since.values : null;
  const defaults = sent ?? o.defaults;
  const base = sent ? stableKey(sent) : (o.base ?? stableKey(o.defaults));
  const load = (key: string | null) => {
    const got = key ? readKept(env.storage, key, env.now()) : null;
    const mine = (got?.values ?? {}) as Partial<V>;
    // Kept over the values now shown (typed after a send the server since caught up with) is no
    // conflict: only a starting point that moved to something else is.
    const same = !!got && (got.base === base || got.base === stableKey(o.defaults));
    return {
      at,
      values: { ...o.defaults, ...mine } as V,
      restored: same,
      conflict: got && !same ? { mine, on: got.base } : null,
    };
  };
  const [first] = useState(() => load(o.key));
  const [state, setState] = useState(first);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<V>({
    defaultValues: first.values as DefaultValues<V>,
    ...(o.schema ? { resolver: zodResolver(o.schema as never) as unknown as Resolver<V> } : {}),
  });

  // What the kept values are measured against, and where they go, as of this render.
  const live = useRef({ key: o.key, defaults, base, on: first.conflict?.on ?? base });
  live.current = { key: o.key, defaults, base, on: state.conflict?.on ?? base };

  // A reset isn't typing: it keeps nothing.
  const muted = useRef(false);
  const resetTo = useCallback(
    (values: V) => {
      muted.current = true;
      try {
        form.reset(values);
      } finally {
        muted.current = false;
      }
    },
    [form],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: `at` stands for the key and base.
  useEffect(() => {
    if (state.at === at) return;
    const next = load(o.key);
    setState(next);
    setSince(null);
    setError(null);
    resetTo(next.values);
  }, [at]);

  // Each change is kept, field by field against the starting point; none left keeps nothing.
  useEffect(() => {
    const sub = form.watch((values) => {
      const { key, defaults, on } = live.current;
      if (!key || muted.current) return;
      const keep = changedFrom(defaults, values as Values);
      writeForm(env.storage, key, Object.keys(keep).length ? (keep as never) : null, on, env.now());
    });
    return () => sub.unsubscribe();
  }, [form, env]);

  const forget = useCallback(
    (next?: V) => {
      const { key, defaults } = live.current;
      if (key) writeForm(env.storage, key, null, "", env.now());
      setState((s) => ({ ...s, restored: false, conflict: null }));
      if (next) setSince({ at, values: next });
      resetTo(next ?? defaults);
    },
    [resetTo, env, at],
  );

  const values = form.watch();
  return {
    ...form,
    restored: state.restored,
    conflict: state.conflict
      ? {
          mine: state.conflict.mine,
          theirs: Object.fromEntries(
            Object.keys(state.conflict.mine).map((k) => [k, (defaults as Values)[k]]),
          ) as Partial<V>,
        }
      : null,
    unsent: Object.keys(changedFrom(defaults, values as Values)).length > 0,
    keepMine: () => {
      const { key, defaults } = live.current;
      if (key)
        writeForm(
          env.storage,
          key,
          changedFrom(defaults, form.getValues() as Values) as never,
          base,
          env.now(),
        );
      setState((s) => ({ ...s, restored: true, conflict: null }));
    },
    takeTheirs: () => forget(),
    onSend: (send, so = {}) =>
      form.handleSubmit(async (sent) => {
        setError(null);
        try {
          if ((await send(sent)) === false) return;
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
          return;
        }
        forget(so.clear ? undefined : sent);
      }),
    forget,
    error,
  };
}

// --- the field set --------------------------------------------------------------------------

/** A field's label above its box; the class every form's fields share. */
export const FIELD_CLASS = "flex min-w-0 flex-col gap-1.5 text-[13px] text-(--ui-ink-2)";
export const SELECT_CLASS =
  "min-h-[38px] w-full border border-(--ui-hair) bg-(--ui-paper) px-3 py-2 text-[14.5px] text-(--ui-ink) focus-visible:border-(--ui-focus) focus:outline-none";

interface FieldBase<V extends FieldValues> {
  form: { control: Control<V> };
  name: FieldPath<V>;
  /** Shown above the box; with none, `aria-label` names it. */
  label?: ReactNode;
  /** Under the label, quieter: what the field is for. */
  hint?: ReactNode;
  /** The wrapping label's classes, joined to `FIELD_CLASS`. */
  className?: string | undefined;
  /** The box's own classes, joined to its look. */
  box?: string | undefined;
}

/** The label, the box, and the field's error under it. */
function Frame({
  label,
  hint,
  error,
  className,
  children,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | undefined;
  className?: string | undefined;
  children: ReactNode;
}) {
  const said = error ? <span className="text-[12px] text-(--ui-bad)">{error}</span> : null;
  if (!label && !hint)
    return said ? (
      <span className={cn("grid gap-1", className)}>
        {children}
        {said}
      </span>
    ) : (
      children
    );
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the box comes in as children.
    <label className={cn(FIELD_CLASS, className)}>
      {label ? <span>{label}</span> : null}
      {hint ? <span className="text-[12px] text-(--ui-ink-3)">{hint}</span> : null}
      {children}
      {said}
    </label>
  );
}

/** The form's ref and the caller's both get the box (a dictation button needs it too). */
function bothRefs<T>(mine: (el: T | null) => void, theirs: Ref<T> | undefined) {
  return (el: T | null) => {
    mine(el);
    if (typeof theirs === "function") theirs(el);
    else if (theirs) (theirs as { current: T | null }).current = el;
  };
}

/** One line of text: a name, a URL, an email. */
export function TextField<V extends FieldValues>({
  form,
  name,
  label,
  hint,
  className,
  box: boxClass,
  ref,
  onChange,
  ...box
}: FieldBase<V> & Omit<ComponentProps<typeof Input>, "form" | "name" | "value" | "defaultValue">) {
  const { field, fieldState } = useController({ control: form.control, name });
  return (
    <Frame label={label} hint={hint} error={fieldState.error?.message} className={className}>
      <Input
        {...box}
        className={boxClass}
        data-edit={`form:${name}`}
        name={field.name}
        ref={bothRefs(field.ref, ref)}
        value={(field.value as string | undefined) ?? ""}
        onChange={(e) => {
          field.onChange(e.target.value);
          onChange?.(e as never);
        }}
        onBlur={field.onBlur}
        aria-invalid={fieldState.invalid || undefined}
      />
    </Frame>
  );
}

/** Several lines of text. */
export function TextAreaField<V extends FieldValues>({
  form,
  name,
  label,
  hint,
  className,
  box: boxClass,
  ref,
  onChange,
  ...box
}: FieldBase<V> &
  Omit<ComponentProps<typeof Textarea>, "form" | "name" | "value" | "defaultValue">) {
  const { field, fieldState } = useController({ control: form.control, name });
  return (
    <Frame label={label} hint={hint} error={fieldState.error?.message} className={className}>
      <Textarea
        {...box}
        className={boxClass}
        data-edit={`form:${name}`}
        name={field.name}
        ref={bothRefs(field.ref, ref)}
        value={(field.value as string | undefined) ?? ""}
        onChange={(e) => {
          field.onChange(e.target.value);
          onChange?.(e as never);
        }}
        onBlur={field.onBlur}
        aria-invalid={fieldState.invalid || undefined}
      />
    </Frame>
  );
}

/** One of a few choices: `[value, label]` pairs; a third `true` shows one that can't be picked. */
export function SelectField<V extends FieldValues>({
  form,
  name,
  label,
  hint,
  className,
  box: boxClass,
  options,
  ...box
}: FieldBase<V> & {
  options: readonly (readonly [string, string] | readonly [string, string, boolean])[];
} & Omit<ComponentProps<"select">, "form" | "name" | "value" | "defaultValue" | "children">) {
  const { field, fieldState } = useController({ control: form.control, name });
  return (
    <Frame label={label} hint={hint} error={fieldState.error?.message} className={className}>
      <select
        {...box}
        data-edit={`form:${name}`}
        name={field.name}
        ref={field.ref}
        value={(field.value as string | undefined) ?? ""}
        onChange={(e) => field.onChange(e.target.value)}
        onBlur={field.onBlur}
        aria-invalid={fieldState.invalid || undefined}
        className={cn(SELECT_CLASS, boxClass)}
      >
        {options.map(([v, l, off]) => (
          <option key={v} value={v} disabled={off}>
            {l}
          </option>
        ))}
      </select>
    </Frame>
  );
}

/** Yes or no. */
export function CheckField<V extends FieldValues>({
  form,
  name,
  label,
  className,
  disabled,
  required,
}: FieldBase<V> & { disabled?: boolean | undefined; required?: boolean | undefined }) {
  const { field, fieldState } = useController({ control: form.control, name });
  const said = fieldState.error?.message;
  return (
    <label
      className={cn("flex flex-wrap items-center gap-2 text-[13.5px] text-(--ui-ink)", className)}
    >
      <input
        type="checkbox"
        data-edit={`form:${name}`}
        name={field.name}
        ref={field.ref}
        checked={!!field.value}
        disabled={disabled}
        required={required}
        aria-invalid={fieldState.invalid || undefined}
        onChange={(e) => field.onChange(e.target.checked)}
        onBlur={field.onBlur}
        className="size-3.5 accent-(--ui-ink)"
      />
      {label}
      {said ? <span className="basis-full text-[12px] text-(--ui-bad)">{said}</span> : null}
    </label>
  );
}

/** Any of a set: the picked values, in the options' order. */
export function ChecksField<V extends FieldValues>({
  form,
  name,
  label,
  className,
  options,
}: FieldBase<V> & { options: readonly (readonly [string, ReactNode])[] }) {
  const { field, fieldState } = useController({ control: form.control, name });
  const on = new Set((field.value as string[] | undefined) ?? []);
  const flip = (v: string) => {
    const next = new Set(on);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    field.onChange(options.map(([k]) => k).filter((k) => next.has(k)));
  };
  return (
    <fieldset className={cn("m-0 grid gap-1.5 border-0 p-0", className)}>
      {label ? <legend className="mb-1 text-[13px] font-medium">{label}</legend> : null}
      {options.map(([v, l]) => (
        <label key={v} className="flex items-baseline gap-2 text-[13.5px]">
          <input
            type="checkbox"
            data-edit={`form:${name}.${v}`}
            name={field.name}
            value={v}
            checked={on.has(v)}
            onChange={() => flip(v)}
            onBlur={field.onBlur}
          />
          <span>{l}</span>
        </label>
      ))}
      {fieldState.error?.message ? (
        <span className="text-[12px] text-(--ui-bad)">{fieldState.error.message}</span>
      ) : null}
    </fieldset>
  );
}

/** One of a few choices, all in view: `[value, label]` pairs. */
export function RadioField<V extends FieldValues>({
  form,
  name,
  label,
  className,
  options,
}: FieldBase<V> & { options: readonly (readonly [string, ReactNode])[] }) {
  const { field, fieldState } = useController({ control: form.control, name });
  return (
    <fieldset className={cn("m-0 grid gap-1.5 border-0 p-0", className)}>
      {label ? <legend className="mb-1 text-[13px] font-medium">{label}</legend> : null}
      {options.map(([v, l]) => (
        <label key={v} className="flex items-baseline gap-2 text-[13.5px]">
          <input
            type="radio"
            data-edit={`form:${name}.${v}`}
            name={field.name}
            value={v}
            checked={field.value === v}
            onChange={() => field.onChange(v)}
            onBlur={field.onBlur}
          />
          <span>{l}</span>
        </label>
      ))}
      {fieldState.error?.message ? (
        <span className="text-[12px] text-(--ui-bad)">{fieldState.error.message}</span>
      ) : null}
    </fieldset>
  );
}

/** A day, "2026-10-16". */
export function DateField<V extends FieldValues>(
  p: FieldBase<V> & Omit<ComponentProps<typeof Input>, "form" | "name" | "value" | "type">,
) {
  return <TextField {...p} type="date" />;
}

/** Dollars as typed ("1,250.50"); `centsOf` reads them for the write. */
export function MoneyField<V extends FieldValues>(
  p: FieldBase<V> &
    Omit<ComponentProps<typeof Input>, "form" | "name" | "value" | "type" | "inputMode">,
) {
  return (
    <TextField
      placeholder="0.00"
      {...p}
      type="text"
      inputMode="decimal"
      box={cn("tabular-nums", p.box)}
    />
  );
}

/** "1,250.50" -> 125050; null when it isn't an amount. */
export function centsOf(text: string): number | null {
  const t = text.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}

/** Which account it goes out as: the account picker, held in the form until it sends. */
export function AccountField<V extends FieldValues>({
  form,
  name,
  pick,
}: Omit<FieldBase<V>, "label" | "hint" | "className"> & {
  /** The platform and its accounts; the field's value is the pick. */
  pick: Omit<AccountPick, "current" | "picked">;
}) {
  const { field } = useController({ control: form.control, name });
  const current = (field.value as string | null | undefined) ?? null;
  return (
    <AccountPicker
      pick={{ ...pick, current: current ?? pick.fallback, picked: current !== null }}
      onPick={(key) => field.onChange(key)}
      unsaved={current !== null}
    />
  );
}
export type { AccountOption };

/** Kept values from before, or a conflict with what the form starts from now: said once. */
export function FormKept<V extends FieldValues>({
  form,
  what = "changes",
  labels,
}: {
  form: Pick<EditForm<V>, "restored" | "conflict" | "unsent" | "keepMine" | "takeTheirs">;
  what?: string;
  /** Names for the fields a conflict shows, when it shows more than one. */
  labels?: Partial<Record<keyof V, string>>;
}) {
  if (form.conflict) {
    const keys = Object.keys(form.conflict.mine);
    const says = (vals: Partial<V>) =>
      keys
        .map((k) => {
          const v = textOf(vals[k]);
          const label = labels?.[k as keyof V];
          return keys.length > 1 && label ? `${label}: ${v}` : v;
        })
        .join("\n");
    return (
      <EditConflict
        conflict={{ mine: says(form.conflict.mine), theirs: says(form.conflict.theirs) }}
        onKeepMine={form.keepMine}
        onTakeTheirs={form.takeTheirs}
      />
    );
  }
  if (form.restored && form.unsent)
    return (
      <p className="flex items-center gap-2 text-[12.5px] text-(--ui-ink-2)">
        Your unsaved {what} are back.
        <button
          type="button"
          onClick={form.takeTheirs}
          className="border-0 bg-transparent p-0 text-(--ui-ink) underline underline-offset-2"
        >
          Discard
        </button>
      </p>
    );
  return null;
}
