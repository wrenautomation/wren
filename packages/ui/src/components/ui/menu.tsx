/**
 * A menu of actions (base-ui Menu): roles, arrow keys, typeahead and Escape come from base-ui. It looks like
 * the kit popover and, on a phone, rises as the same sheet.
 */
import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { cn } from "cn";
import * as React from "react";
import { Icon } from "../../icons.js";
import { SHEET, useDragDown } from "./popover.js";

const Menu = MenuPrimitive.Root;
const MenuTrigger = MenuPrimitive.Trigger;
const createMenuHandle = MenuPrimitive.createHandle;
type MenuHandle<P> = MenuPrimitive.Handle<P>;

function MenuContent({
  className,
  align = "end",
  side = "bottom",
  sideOffset = 4,
  ...props
}: MenuPrimitive.Popup.Props &
  Pick<MenuPrimitive.Positioner.Props, "align" | "side" | "sideOffset">) {
  const popup = React.useRef<HTMLDivElement>(null);
  useDragDown(popup);
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Backdrop className="fixed inset-0 z-50 hidden bg-(--ui-scrim) duration-200 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 max-[900px]:block" />
      <MenuPrimitive.Positioner
        align={align}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-50 max-[900px]:fixed! max-[900px]:inset-x-0! max-[900px]:top-auto! max-[900px]:bottom-0! max-[900px]:transform-none!"
      >
        <MenuPrimitive.Popup
          ref={popup}
          data-slot="menu-content"
          className={cn(
            "z-50 flex w-60 origin-(--transform-origin) flex-col rounded-(--ui-leaf-box) bg-popover p-1 text-sm text-popover-foreground shadow-(--ui-float) outline-hidden duration-100 ease-(--ui-ease) data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className,
            SHEET,
          )}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}

function MenuLabel({ className, ...props }: MenuPrimitive.GroupLabel.Props) {
  return (
    <MenuPrimitive.GroupLabel
      className={cn("px-2 pt-1.5 pb-1 text-[12px] text-(--ui-ink-3)", className)}
      {...props}
    />
  );
}

const MenuRadioGroup = MenuPrimitive.RadioGroup;

/** a row with the picked one ticked; a pick closes the menu */
function MenuRadioItem({
  className,
  children,
  closeOnClick = true,
  ...props
}: MenuPrimitive.RadioItem.Props) {
  return (
    <MenuPrimitive.RadioItem
      closeOnClick={closeOnClick}
      className={cn(
        "flex min-h-8 w-full cursor-pointer items-center gap-2.5 rounded-[calc(var(--ui-leaf-box)-4px)] px-2 py-1 text-left text-[13px] text-(--ui-ink) outline-none select-none data-highlighted:bg-(--ui-hover) max-[900px]:min-h-11",
        className,
      )}
      {...props}
    >
      <span className="min-w-0 flex-1 wrap-anywhere">{children}</span>
      <MenuPrimitive.RadioItemIndicator className="flex-none text-(--ui-ink)">
        <Icon name="check" className="size-3.5" strokeWidth={2.5} />
      </MenuPrimitive.RadioItemIndicator>
    </MenuPrimitive.RadioItem>
  );
}

export {
  createMenuHandle,
  Menu,
  MenuContent,
  type MenuHandle,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
};
