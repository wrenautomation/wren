/**
 * ⌘K: what you can do here first (this view, the open record: `./palette-scope.ts`), then jump
 * to any app or page. Its box takes dictation. Import it from `@wren/ui/palette` and load it on the first ⌘K: cmdk and
 * the dialog stay out of the first load.
 */
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
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

export interface PaletteItem {
  label: string;
  /** Its heading in the list: the app's name. */
  group: string;
  href: string;
  icon?: IconName | undefined;
  /** A second line, faint: what it does. */
  hint?: string | undefined;
}

/** What a "note:" line says, without the prefix; anything else typed counts too. */
const noted = (q: string) => q.replace(/^\s*note:\s*/i, "").trim();

export function CommandPalette({
  items,
  onPick,
  open,
  onOpenChange,
  ask,
  capture,
  find,
}: {
  items: PaletteItem[];
  onPick: (href: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Wren's team: what's typed can go to Claude Code as a question, from this page. */
  ask?: ((question: string) => void) | undefined;
  /** What's typed goes into the viewer's notes ("note: call Sam back"). */
  capture?: ((words: string) => void) | undefined;
  /** Records that match what's typed, asked after a pause: Learn's items, by their app. */
  find?: ((q: string) => Promise<PaletteItem[]>) | undefined;
}) {
  const scope = useScoped();
  const record = useOpened();
  const [q, setQ] = useState("");
  const box = useRef<HTMLInputElement>(null);
  const found = useFound(find, q);
  const foundGroups = [...new Set(found.map((i) => i.group))];
  const groups = [...new Set(items.map((i) => i.group))];
  const here = [...new Set(scope.items.map((i) => i.group))];
  const run = (i: Pick<ScopeItem, "run">) => () => {
    onOpenChange(false);
    i.run();
  };
  // "note: …" leads the list; anything else typed can still be kept, last.
  const lead = /^\s*note:/i.test(q);
  const note =
    capture && noted(q) ? (
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
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Go to"
      description="Do something here, or go to an app or page"
    >
      <Command>
        {/* The box sits 4px into its wrapper, so the mic does too. */}
        <DictateField target={box} line className="[&>button]:top-2 [&>button]:right-2">
          <CommandInput ref={box} placeholder="Do or go to…" value={q} onValueChange={setQ} />
        </DictateField>
        <CommandList>
          {note || found.length ? null : <CommandEmpty>Nothing by that name.</CommandEmpty>}
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
                    onSelect={() => {
                      onOpenChange(false);
                      onPick(i.href);
                    }}
                  >
                    {i.icon ? <Icon name={i.icon} /> : null}
                    <span className="truncate">{i.label}</span>
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
          {lead ? null : note}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}

/** What `find` answers for the words typed, asked 250 ms after the last key; a late answer is dropped. */
function useFound(
  find: ((q: string) => Promise<PaletteItem[]>) | undefined,
  q: string,
): PaletteItem[] {
  const [found, setFound] = useState<{ q: string; items: PaletteItem[] }>({ q: "", items: [] });
  const words = q.trim();
  // The latest `find`, so a parent's new function each render never asks again.
  const latest = useRef(find);
  latest.current = find;
  const can = !!find;
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
  return found.q === words ? found.items : [];
}
