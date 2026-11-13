/**
 * The record panel (DESIGN.md): one thing open beside the page. A wide screen gets a right sheet,
 * 560 wide, 8 px in; a phone gets a bottom sheet. Canon's records and Aerie's tasks open in it.
 */
import type { ReactNode } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "./components/ui/sheet.js";
import { Icon } from "./icons.js";
import { BottomSheet } from "./phone.js";
import { usePhone } from "./phone-shell.js";

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="Close"
      onClick={onClick}
      className="inline-grid size-8 cursor-pointer place-items-center border-0 bg-transparent text-(--ui-ink-2) hover:bg-(--ui-hover) hover:text-(--ui-ink) pointer-coarse:size-11"
    >
      <Icon name="close" className="size-4" />
    </button>
  );
}

export function DetailSheet({
  title,
  about,
  onClose,
  children,
}: {
  /** the sheet's name for screen readers; the body shows its own heading */
  title: string;
  about: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const phone = usePhone();
  if (phone)
    return (
      <BottomSheet
        label={title}
        start="large"
        onClose={onClose}
        bodyClassName="px-4 pt-2 pb-[calc(96px+env(safe-area-inset-bottom))]"
        head={
          <div className="flex h-11 items-center border-b border-(--ui-hair) px-2">
            <CloseButton onClick={onClose} />
          </div>
        }
      >
        {children}
      </BottomSheet>
    );
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        // DESIGN.md record panel: 560 wide, floats 8 in, sheet radius
        className="w-full overflow-y-auto data-[side=right]:sm:top-2 data-[side=right]:sm:right-2 data-[side=right]:sm:bottom-2 data-[side=right]:sm:h-auto data-[side=right]:sm:max-w-[560px] data-[side=right]:sm:rounded-(--ui-radius-sheet) data-[side=right]:sm:border"
      >
        {/* the body's heading shows the title; the close button sits top right */}
        <SheetHeader className="sr-only">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{about}</SheetDescription>
        </SheetHeader>
        <div className="px-5 pt-12 pb-10">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
