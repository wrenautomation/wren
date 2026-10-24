/**
 * ⌘K: what you can do here first (this view, the open record: `./palette-scope.ts`), then jump
 * to any app or page. Typing finds records in each app, grouped by app, the ones opened lately
 * first; with nothing typed, those recent ones lead. Its box takes dictation. Import it from
 * `@wren/ui/palette` and load it on the first ⌘K: cmdk and the dialog stay out of the first load.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "./components/ui/command.js";
import { DictateField } from "./dictate.js";
import { Icon, type IconName } from "./icons.js";
import { type ScopeItem, useOpened, useScoped } from "./palette-scope.js";
import { toast } from "./toast.js";

export interface PaletteItem {
  label: string;
  /** Its heading in the list: the app's name. */
  group: string;
  href: string;
  icon?: IconName | undefined;
  /** A second line, faint: what it does. */
  hint?: string | undefined;
}

const RECENT = 8;
const recentAt = (key: string) => `wren.palette.recent:${key}`;
/** The records last opened from ⌘K in this workspace, newest first; none where storage is shut. */
function readRecent(key: string | undefined): PaletteItem[] {
  if (!key) return [];
  try {
    const got = JSON.parse(localStorage.getItem(recentAt(key)) ?? "[]");
    return Array.isArray(got) ? (got as PaletteItem[]).filter((i) => i?.href && i.label) : [];
  } catch {
    return [];
  }
}
function keepRecent(key: string | undefined, item: PaletteItem) {
  if (!key) return;
  try {
    const next = [item, ...readRecent(key).filter((i) => i.href !== item.href)].slice(0, RECENT);
    localStorage.setItem(recentAt(key), JSON.stringify(next));
  } catch {}
}

/**
 * Found records with the recent ones first: their groups lead, and inside each group they come
 * before the rest, newest first. Otherwise the order `find` gave.
 */
export function byRecent(found: readonly PaletteItem[], recent: readonly string[]): PaletteItem[] {
  const at = (i: PaletteItem) => {
    const n = recent.indexOf(i.href);
    return n < 0 ? recent.length : n;
  };
  const groupAt = new Map<string, number>();
  found.forEach((i, n) => {
    const g = groupAt.get(i.group);
    const rank = at(i) * 1000 + n;
    if (g === undefined || rank < g) groupAt.set(i.group, rank);
  });
  return found
    .map((i, n) => ({ i, n }))
    .sort(
      (a, b) =>
        (groupAt.get(a.i.group) ?? 0) - (groupAt.get(b.i.group) ?? 0) ||
        at(a.i) - at(b.i) ||
        a.n - b.n,
    )
    .map(({ i }) => i);
}

/** What a "note:" line says, without the prefix; anything else typed counts too. */
const noted = (q: string) => q.replace(/^\s*note:\s*/i, "").trim();

/** What a "card:" line says, without the prefix. */
const carded = (q: string) => q.replace(/^\s*card:\s*/i, "").trim();

export function CommandPalette({
  items,
  onPick,
  open,
  onOpenChange,
  ask,
  capture,
  card,
  find,
  recentKey,
}: {
  items: PaletteItem[];
  onPick: (href: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Wren's team: what's typed can go to Claude Code as a question, from this page. */
  ask?: ((question: string) => void) | undefined;
  /** What's typed goes into the viewer's notes ("note: call Sam back"). */
  capture?: ((words: string) => void) | undefined;
  /** What's typed becomes a card on the Work board ("card: order the sign"). */
  card?: ((title: string) => void) | undefined;
  /** Records that match what's typed, asked after a pause: Learn's items, by their app. */
  find?: ((q: string) => Promise<PaletteItem[]>) | undefined;
  /** Where the records opened from here are remembered: the workspace. None, none kept. */
  recentKey?: string | undefined;
}) {
  const scope = useScoped();
  const record = useOpened();
  const [q, setQ] = useState("");
  const box = useRef<HTMLInputElement>(null);
  const recent = useMemo(() => (open ? readRecent(recentKey) : []), [open, recentKey]);
  const finding = useFound(find, q);
  const found = byRecent(
    finding.items,
    recent.map((i) => i.href),
  );
  const foundGroups = [...new Set(found.map((i) => i.group))];
  const pickFound = (i: PaletteItem) => () => {
    keepRecent(recentKey, i);
    onOpenChange(false);
    onPick(i.href);
  };
  const groups = [...new Set(items.map((i) => i.group))];
  const here = [...new Set(scope.items.map((i) => i.group))];
  const run = (i: Pick<ScopeItem, "run">) => () => {
    onOpenChange(false);
    i.run();
  };
  // "note: …" leads the list; anything else typed can still be kept, last.
  const lead = /^\s*note:/i.test(q);
  const leadCard = /^\s*card:/i.test(q);
  const note =
    capture && noted(q) && !leadCard ? (
      // Forced, like its item: cmdk hides a group none of whose items its filter matched.
      <CommandGroup heading="Note" forceMount>
        <CommandItem
          value={`note ${q}`}
          forceMount
          onSelect={run({ run: () => capture(noted(q)) })}
        >
          <Icon name="note" />
          <span>Add to your notes: “{noted(q)}”</span>
        </CommandItem>
      </CommandGroup>
    ) : null;
  const made =
    card && carded(q) && !lead ? (
      <CommandGroup heading="Card" forceMount>
        <CommandItem value={`card ${q}`} forceMount onSelect={run({ run: () => card(carded(q)) })}>
          <Icon name="board" />
          <span>New card: “{carded(q)}”</span>
        </CommandItem>
      </CommandGroup>
    ) : null;
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Go to"
      description="Do something here, or go to an app or page"
      // The artifact's panel leaf (6 and 24) on the frame and the list it clips.
      className="rounded-[6px_24px_6px_24px]! shadow-(--ui-shadow)"
    >
      <Command className="rounded-[6px_24px_6px_24px]!">
        {/* The box sits 4px into its wrapper, so the mic does too. */}
        <DictateField target={box} line className="[&>button]:top-2 [&>button]:right-2">
          <CommandInput
            ref={box}
            placeholder="Do or go to…"
            value={q}
            onValueChange={setQ}
            busy={finding.pending}
          />
        </DictateField>
        <CommandList>
          {note || made || found.length || finding.pending ? null : (
            <CommandEmpty>Nothing by that name.</CommandEmpty>
          )}
          {scope.search && q.trim() ? (
            <CommandGroup heading="Search">
              <CommandItem
                value={`search ${q}`}
                forceMount
                onSelect={run({ run: () => scope.search?.run(q.trim()) })}
              >
                <Icon name="search" />
                <span>
                  {scope.search.label} for “{q.trim()}”
                </span>
              </CommandItem>
            </CommandGroup>
          ) : null}
          {lead ? note : null}
          {leadCard ? made : null}
          {card && !lead && !leadCard ? (
            <CommandGroup heading="Make">
              <CommandItem value="new card" onSelect={() => setQ("card: ")}>
                <Icon name="board" />
                <span>New card</span>
                <CommandShortcut>card: title</CommandShortcut>
              </CommandItem>
            </CommandGroup>
          ) : null}
          {!q.trim() && recent.length ? (
            <CommandGroup heading="Recent">
              {recent.map((i) => (
                <CommandItem
                  key={`recent ${i.href}`}
                  value={`recent ${i.label} ${i.href}`}
                  onSelect={pickFound(i)}
                >
                  {i.icon ? <Icon name={i.icon} /> : null}
                  <span className="wrap-anywhere whitespace-normal">{i.label}</span>
                  <CommandShortcut>{i.hint ? `${i.group} · ${i.hint}` : i.group}</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {ask && q.trim() ? (
            <CommandGroup heading="Ask">
              {record?.ask ? (
                <CommandItem
                  value={`ask record ${q}`}
                  forceMount
                  onSelect={run({
                    run: () =>
                      void record
                        .ask?.(q.trim())
                        .catch((err: unknown) =>
                          toast.error(err instanceof Error ? err.message : String(err)),
                        ),
                  })}
                >
                  <Icon name="reply" />
                  <span>
                    Ask Claude to change this {record.one}: “{q.trim()}”
                  </span>
                </CommandItem>
              ) : null}
              <CommandItem
                value={`ask ${q}`}
                forceMount
                onSelect={run({
                  run: () =>
                    ask(
                      record
                        ? `${q.trim()}\n\n(Asked with the ${record.one} "${record.title}" open: ${record.type} ${record.id}.)`
                        : q.trim(),
                    ),
                })}
              >
                <Icon name="reply" />
                <span>Ask Claude Code “{q.trim()}”</span>
              </CommandItem>
            </CommandGroup>
          ) : null}
          {here.map((g) => (
            <CommandGroup key={`here ${g}`} heading={g}>
              {scope.items
                .filter((i) => i.group === g)
                .map((i) => (
                  <CommandItem key={i.label} value={`${g} ${i.label}`} onSelect={run(i)}>
                    {i.icon ? <Icon name={i.icon} /> : null}
                    <span>{i.label}</span>
                    {i.hint ? <CommandShortcut>{i.hint}</CommandShortcut> : null}
                  </CommandItem>
                ))}
            </CommandGroup>
          ))}
          {foundGroups.map((g) => (
            // Forced: the server already matched them, by words cmdk's filter can't see.
            <CommandGroup key={`found ${g}`} heading={`In ${g}`} forceMount>
              {found
                .filter((i) => i.group === g)
                .map((i) => (
                  <CommandItem
                    key={i.href}
                    value={`found ${i.href}`}
                    forceMount
                    onSelect={pickFound(i)}
                  >
                    {i.icon ? <Icon name={i.icon} /> : null}
                    <span className="wrap-anywhere whitespace-normal">{i.label}</span>
                    {i.hint ? <CommandShortcut>{i.hint}</CommandShortcut> : null}
                  </CommandItem>
                ))}
            </CommandGroup>
          ))}
          {groups.map((g) => (
            <CommandGroup key={g} heading={g}>
              {items
                .filter((i) => i.group === g)
                .map((i) => (
                  <CommandItem
                    key={i.href}
                    value={`${g} ${i.label} ${i.href}`}
                    onSelect={() => {
                      onOpenChange(false);
                      onPick(i.href);
                    }}
                  >
                    {i.icon ? <Icon name={i.icon} /> : null}
                    <span>{i.label}</span>
                    {i.hint ? <CommandShortcut>{i.hint}</CommandShortcut> : null}
                  </CommandItem>
                ))}
            </CommandGroup>
          ))}
          {lead || leadCard ? null : note}
          {lead || leadCard ? null : made}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}

/**
 * What `find` answers for the words typed, asked 250 ms after the last key; a late answer is
 * dropped. The last answer stays on screen until the next lands; `pending` says one is out.
 */
function useFound(
  find: ((q: string) => Promise<PaletteItem[]>) | undefined,
  q: string,
): { items: PaletteItem[]; pending: boolean } {
  const [found, setFound] = useState<{ q: string; items: PaletteItem[] }>({ q: "", items: [] });
  const words = q.trim();
  // The latest `find`, so a parent's new function each render never asks again.
  const latest = useRef(find);
  latest.current = find;
  const can = !!find;
  // read-ok: a search as it's typed; a late answer is dropped and none is kept.
  useEffect(() => {
    const ask = latest.current;
    if (!can || !ask || words.length < 2) return;
    let live = true;
    const t = setTimeout(() => {
      ask(words)
        .then((items) => live && setFound({ q: words, items }))
        .catch(() => live && setFound({ q: words, items: [] }));
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [can, words]);
  if (!can || words.length < 2) return { items: [], pending: false };
  return { items: found.items, pending: found.q !== words };
}
