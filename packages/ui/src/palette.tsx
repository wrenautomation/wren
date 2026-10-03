/**
 * ⌘K: jump to any app or page. Actions join as they're built. Import it from `@wren/ui/palette`
 * and load it on the first ⌘K: cmdk and the dialog stay out of the first load.
 */
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
}: {
  items: PaletteItem[];
  onPick: (href: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const groups = [...new Set(items.map((i) => i.group))];
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Go to"
      description="An app or a page"
    >
      <Command>
        <CommandInput placeholder="Go to an app or page…" />
        <CommandList>
          <CommandEmpty>Nothing by that name.</CommandEmpty>
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
