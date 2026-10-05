/**
 * ⌘K: what you can do here first (this view, the open record: `./palette-scope.ts`), then jump
 * to any app or page. Import it from `@wren/ui/palette` and load it on the first ⌘K: cmdk and
 * the dialog stay out of the first load.
 */
import { useState } from "react";
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
import { Icon, type IconName } from "./icons.js";
import { type ScopeItem, useScoped } from "./palette-scope.js";

export interface PaletteItem {
  label: string;
  /** Its heading in the list: the app's name. */
  group: string;
  href: string;
  icon?: IconName | undefined;
  /** A second line, faint: what it does. */
  hint?: string | undefined;
}

export function CommandPalette({
  items,
  onPick,
  open,
  onOpenChange,
  ask,
}: {
  items: PaletteItem[];
  onPick: (href: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Wren's team: what's typed can go to Claude Code as a question, from this page. */
  ask?: ((question: string) => void) | undefined;
}) {
  const scope = useScoped();
  const [q, setQ] = useState("");
  const groups = [...new Set(items.map((i) => i.group))];
  const here = [...new Set(scope.items.map((i) => i.group))];
  const run = (i: Pick<ScopeItem, "run">) => () => {
    onOpenChange(false);
    i.run();
  };
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Go to"
      description="Do something here, or go to an app or page"
    >
      <Command>
        <CommandInput placeholder="Do or go to…" value={q} onValueChange={setQ} />
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
          {ask && q.trim() ? (
            <CommandGroup heading="Ask">
              <CommandItem
                value={`ask ${q}`}
                forceMount
                onSelect={run({ run: () => ask(q.trim()) })}
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
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
