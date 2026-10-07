/**
 * ⌘K: what you can do here first (this view, the open record: `./palette-scope.ts`), then jump
 * to any app or page. Its box takes dictation. Import it from `@wren/ui/palette` and load it on the first ⌘K: cmdk and
 * the dialog stay out of the first load.
 */
import { useRef, useState } from "react";
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
}: {
  items: PaletteItem[];
  onPick: (href: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Wren's team: what's typed can go to Claude Code as a question, from this page. */
  ask?: ((question: string) => void) | undefined;
  /** What's typed goes into the viewer's notes ("note: call Sam back"). */
  capture?: ((words: string) => void) | undefined;
}) {
  const scope = useScoped();
  const record = useOpened();
  const [q, setQ] = useState("");
  const box = useRef<HTMLInputElement>(null);
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
      <CommandGroup heading="Note">
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
          <CommandEmpty>Nothing by that name.</CommandEmpty>
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
