/**
 * Accounts on records (designs/2026-10-15-accounts-first-class.md): the badge, the list's Account
 * filter and the draft's account picker. A record declares its account field once
 * (`RecordMeta.account`); the list bar, cells, cards and the draft box draw these from it, on
 * the desktop and the phone shell alike.
 */
import type { AccountOption, AccountPick } from "@wren/core/record-accounts";
import type { FieldMeta, RecordMeta, State } from "@wren/core/records";
import { cn } from "cn";
import { Check, ChevronDown, TriangleAlert, User } from "lucide-react";
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "./components/ui/popover.js";
import { tipProps } from "./hint.js";
import { useHoverPop } from "./hover-pop.js";
import { PlatformMark, TintSwatch } from "./marks.js";
import type { Place } from "./records.js";

/** The record's account field, when it declares one. */
export const accountFieldOf = (meta: RecordMeta): FieldMeta | null =>
  meta.account ? (meta.fields.find((f) => f.key === meta.account) ?? null) : null;

/** An account's state on a field: its label and platform mark; an unknown key reads as itself. */
export const accountState = (field: FieldMeta | null | undefined, key: string): State =>
  field?.states?.[key] ?? { label: key, tone: "neutral" };

const CHIP =
  "inline-flex h-8 pointer-coarse:h-11 shrink-0 items-center gap-1.5 border border-(--ui-hair) bg-(--ui-paper) px-2.5 text-[13px] text-(--ui-ink-2) hover:bg-(--ui-hover) hover:text-(--ui-ink)";
const POP = "w-72 gap-0 overflow-hidden bg-(--ui-paper) p-0 text-(--ui-ink)";
const ROW =
  "flex min-h-8 pointer-coarse:min-h-11 w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-3 py-1.5 text-left text-[13px] text-(--ui-ink) hover:bg-(--ui-hover)";

function Face({ state, size = 14 }: { state: State; size?: number }) {
  if (state.mark) return <PlatformMark mark={state.mark} size={size} />;
  if (state.tint !== undefined) return <TintSwatch tint={state.tint} />;
  return <User aria-hidden className="size-3.5 shrink-0 text-(--ui-ink-3)" />;
}

/** One account as a row shows it: its platform's mark and its name ("u/handle"). */
export function AccountBadge({
  field,
  value,
  warn,
}: {
  field?: FieldMeta | null | undefined;
  value: string;
  /** Said beside it: the account misses a rule where it is going. */
  warn?: string | null | undefined;
}) {
  const state = accountState(field, value);
  return (
    <span
      className="inline-flex max-w-full min-w-0 items-center gap-1.5 whitespace-nowrap"
      data-account={value}
      {...tipProps(warn ?? (state.label === value ? null : value))}
    >
      <Face state={state} />
      <span className="min-w-0 truncate">{state.label}</span>
      {warn ? (
        <TriangleAlert aria-label="Warning" className="size-3.5 shrink-0 text-(--ui-warn-ink)" />
      ) : null}
    </span>
  );
}

/**
 * The list's Account filter, on the bar whenever the record declares an account and has two or
 * more: one tap narrows the list to an account. It rides in the address as the field's filter,
 * so saved views keep it.
 */
export function AccountFilter({ meta, place }: { meta: RecordMeta; place: Place }) {
  const pop = useHoverPop();
  const field = accountFieldOf(meta);
  const states = Object.entries(field?.states ?? {});
  if (!field || states.length < 2) return null;
  const raw = place.params.get(field.key) ?? "";
  const picked = raw.split(",").filter((k) => field.states?.[k]);
  const one = picked.length === 1 ? (picked[0] ?? null) : null;
  const pick = (key: string | null) => {
    pop.setOpen(false);
    place.go(place.link({ [field.key]: key, pg: null }), true);
  };
  const ordered = [...states].sort(([, a], [, b]) =>
    `${a.mark ?? ""}${a.label}`.localeCompare(`${b.mark ?? ""}${b.label}`),
  );
  return (
    <Popover {...pop.root}>
      <PopoverTrigger
        {...pop.trigger}
        aria-label={`${field.label}: ${one ? accountState(field, one).label : picked.length ? `${picked.length} accounts` : "all"}`}
        className={cn(CHIP, picked.length && "text-(--ui-ink)")}
        data-account-filter=""
      >
        {one ? <Face state={accountState(field, one)} /> : <User className="size-3.5" />}
        <span className="max-w-[160px] truncate">
          {one
            ? accountState(field, one).label
            : picked.length
              ? `${picked.length} accounts`
              : "All accounts"}
        </span>
        <ChevronDown className="size-3.5 text-(--ui-ink-3)" />
      </PopoverTrigger>
      <PopoverContent align="start" className={POP}>
        <div className="grid py-1" role="listbox" aria-label={field.label}>
          <button
            type="button"
            role="option"
            aria-selected={!picked.length}
            className={ROW}
            onClick={() => pick(null)}
          >
            <User aria-hidden className="size-3.5 shrink-0 text-(--ui-ink-3)" />
            <span className="flex-1">All accounts</span>
            {!picked.length ? <Check className="size-3.5" /> : null}
          </button>
          {ordered.map(([key, state]) => (
            <button
              key={key}
              type="button"
              role="option"
              aria-selected={picked.includes(key)}
              className={ROW}
              onClick={() => pick(key)}
            >
              <Face state={state} />
              <span className="min-w-0 flex-1 truncate">{state.label}</span>
              {picked.includes(key) ? <Check className="size-3.5" /> : null}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

const optionOf = (pick: AccountPick, key: string | null): AccountOption | undefined =>
  key === null ? undefined : pick.options.find((o) => o.key === key);
const STATE_WORDS: Record<string, string> = { warming: "warming up", paused: "paused" };

/**
 * Which account a draft goes out as, above its words: the one it uses now, and every other on
 * its platform with a warning where one misses the place's rule. Picking saves it with the draft
 * (the box's own save); the default puts back the place's or conversation's own.
 */
export function AccountPicker({
  pick,
  onPick,
  busy,
  unsaved,
}: {
  pick: AccountPick;
  /** Save the pick; null goes back to the default. */
  onPick: (key: string | null) => void | Promise<void>;
  busy?: boolean | undefined;
  /** The pick isn't on the server yet (still going, or kept after a failed save). */
  unsaved?: boolean | undefined;
}) {
  const [open, setOpen] = useState(false);
  const current = optionOf(pick, pick.current);
  const fallback = optionOf(pick, pick.fallback);
  const label = current?.label ?? fallback?.label ?? "Default account";
  const choose = (key: string | null) => {
    setOpen(false);
    if (key === (pick.picked ? pick.current : null)) return;
    void onPick(key);
  };
  return (
    <div className="grid gap-1" data-account-picker="">
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <span className="text-(--ui-ink-2)">Send as</span>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            disabled={busy}
            aria-label={`Send as ${label}`}
            className={cn(CHIP, "text-(--ui-ink)", busy && "opacity-60")}
          >
            <PlatformMark mark={pick.platform} />
            <span className="max-w-[200px] truncate">{label}</span>
            {current?.warn ? (
              <TriangleAlert aria-hidden className="size-3.5 text-(--ui-warn-ink)" />
            ) : null}
            <ChevronDown className="size-3.5 text-(--ui-ink-3)" />
          </PopoverTrigger>
          <PopoverContent align="start" className={POP}>
            <div className="grid py-1" role="listbox" aria-label="Send as">
              {pick.options.map((o) => (
                <button
                  key={o.key}
                  type="button"
                  role="option"
                  aria-selected={o.key === pick.current}
                  className={cn(ROW, "items-start")}
                  onClick={() => choose(o.key)}
                >
                  <span className="mt-0.5">
                    <PlatformMark mark={pick.platform} />
                  </span>
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span className="truncate">
                      {o.label}
                      {o.key === pick.fallback ? (
                        <span className="text-(--ui-ink-3)"> · default</span>
                      ) : null}
                      {o.state && STATE_WORDS[o.state] ? (
                        <span className="text-(--ui-ink-3)"> · {STATE_WORDS[o.state]}</span>
                      ) : null}
                    </span>
                    {o.warn ? (
                      <span className="text-[12px] text-(--ui-warn-ink)">{o.warn}</span>
                    ) : null}
                  </span>
                  {o.key === pick.current ? <Check className="mt-0.5 size-3.5" /> : null}
                </button>
              ))}
              {pick.picked ? (
                <button
                  type="button"
                  className={cn(ROW, "border-t border-(--ui-hair) text-(--ui-ink-2)")}
                  onClick={() => choose(null)}
                >
                  Use the default{fallback ? ` (${fallback.label})` : ""}
                </button>
              ) : null}
            </div>
          </PopoverContent>
        </Popover>
        {unsaved ? (
          <span className="text-(--ui-warn-ink)">Not saved yet</span>
        ) : pick.picked ? (
          <span className="text-(--ui-ink-3)">Picked</span>
        ) : null}
      </div>
      {current?.warn ? (
        <p className="m-0 flex items-start gap-1.5 text-[12.5px] text-(--ui-warn-ink)">
          <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span>{current.warn}</span>
        </p>
      ) : null}
    </div>
  );
}
