import { Command as CommandPrimitive } from "cmdk";
import { cn } from "cn";
import type * as React from "react";
import { Ring } from "../../busy.js";
import { Icon } from "../../icons.js";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./dialog.js";
import { InputGroup, InputGroupAddon } from "./input-group.js";

function Command({ className, ...props }: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn(
        "flex size-full flex-col overflow-hidden rounded-(--ui-leaf-sheet)! bg-popover p-1 text-popover-foreground",
        className,
      )}
      {...props}
    />
  );
}

function CommandDialog({
  title = "Command Palette",
  description = "Search for a command to run...",
  children,
  className,
  showCloseButton = false,
  ...props
}: Omit<React.ComponentProps<typeof Dialog>, "children"> & {
  title?: string;
  description?: string;
  className?: string;
  showCloseButton?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Dialog {...props}>
      <DialogHeader className="sr-only">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <DialogContent
        className={cn(
          "top-1/3 translate-y-0 overflow-hidden rounded-(--ui-leaf-sheet)! p-0 data-open:animate-none data-closed:animate-none",
          className,
        )}
        showCloseButton={showCloseButton}
        overlayClassName="data-open:animate-none data-closed:animate-none"
      >
        {children}
      </DialogContent>
    </Dialog>
  );
}

function CommandInput({
  className,
  busy,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input> & {
  /** A search is out: the ring turns in the search mark's place, old results stay. */
  busy?: boolean;
}) {
  return (
    <div data-slot="command-input-wrapper" className="p-1 pb-0">
      <InputGroup className="h-auto! min-h-[38px] rounded-(--ui-leaf-button)! border-(--ui-hair) bg-transparent shadow-none! *:data-[slot=input-group-addon]:pl-3!">
        <CommandPrimitive.Input
          data-slot="command-input"
          className={cn(
            "w-full py-[9px] pr-7 text-[14px]/[1.55] outline-hidden disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
          {...props}
        />
        <InputGroupAddon>
          <Icon name="search" className="opacity-50" />
        </InputGroupAddon>
        {/* The artifact's `.frg`: the ring waits at the right and fades in while results load. */}
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 leading-none opacity-0 transition-opacity duration-200 [&_.ui-busy]:m-0",
            busy && "opacity-100",
          )}
        >
          <Ring on={!!busy} />
        </span>
      </InputGroup>
    </div>
  );
}

function CommandList({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn(
        "no-scrollbar max-h-72 scroll-py-1 overflow-x-hidden overflow-y-auto outline-none",
        className,
      )}
      {...props}
    />
  );
}

function CommandEmpty({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className={cn("py-6 text-center text-sm", className)}
      {...props}
    />
  );
}

function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        "overflow-hidden p-1 text-foreground **:[[cmdk-group-heading]]:px-1 **:[[cmdk-group-heading]]:pt-2 **:[[cmdk-group-heading]]:pb-1 **:[[cmdk-group-heading]]:text-[12.5px] **:[[cmdk-group-heading]]:font-semibold **:[[cmdk-group-heading]]:text-(--ui-ink-3) **:[[cmdk-group-heading]]:[text-transform:var(--ui-label-case)] **:[[cmdk-group-heading]]:tracking-(--ui-label-tracking)",
        className,
      )}
      {...props}
    />
  );
}

function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      data-slot="command-separator"
      className={cn("-mx-1 h-px bg-(--ui-hair)", className)}
      {...props}
    />
  );
}

function CommandItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        "group/command-item relative flex cursor-default items-center gap-3 rounded-(--ui-leaf-button) px-1 py-2.5 text-[14px]/[1.55] font-semibold outline-hidden select-none border-t border-(--ui-hair) first:border-t-0 data-selected:border-transparent [[data-selected]+&]:border-transparent data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-selected:bg-(--ui-wash) data-selected:text-(--ui-ink) [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 data-selected:*:[svg]:text-foreground",
        className,
      )}
      {...props}
    >
      {children}
      <Icon
        name="check"
        className="ml-auto opacity-0 group-has-data-[slot=command-shortcut]/command-item:hidden group-data-[checked=true]/command-item:opacity-100"
      />
    </CommandPrimitive.Item>
  );
}

function CommandShortcut({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="command-shortcut"
      className={cn(
        "ml-auto rounded-(--ui-leaf-chip) bg-(--ui-fill) px-2.5 py-[3px] text-[12.5px]/[1.55] font-semibold text-(--ui-ink-2)",
        className,
      )}
      {...props}
    />
  );
}

export {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
};
