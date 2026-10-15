/**
 * View as (designs/2026-10-14-view-as.md), the parts on every page: the strip on top while this
 * tab views as someone, the Look / Act switch with its one ask, and a way to open the picker from
 * anywhere (the sidebar's button, ⌘K, a person's Access page). The picker loads on first open.
 */
import { Button } from "@wren/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@wren/ui/components/ui/dialog";
import { lazy, Suspense, useEffect, useState } from "react";
import { type Me, type ViewAsTab, viewAs, viewing } from "./api.js";

const Picker = lazy(() => import("./view-as-picker.js").then((m) => ({ default: m.Picker })));

/** ⌘K's item for the picker: its href is caught, never followed. */
export const VIEW_AS_HREF = "#view-as";

/** Where the picker opens: a client, and maybe a person there. */
export interface PickerPreset {
  client: string;
  email?: string;
}
const OPEN = "wren:view-as";

/** Open the picker, at `preset` when given. */
export const openViewAs = (preset?: PickerPreset) =>
  dispatchEvent(new CustomEvent(OPEN, { detail: preset ?? null }));

/** The picker, mounted once by the app, opened by `openViewAs`. */
export function ViewAsPicker() {
  const [open, setOpen] = useState<{ preset: PickerPreset | null } | null>(null);
  useEffect(() => {
    const on = (e: Event) => setOpen({ preset: (e as CustomEvent<PickerPreset | null>).detail });
    addEventListener(OPEN, on);
    return () => removeEventListener(OPEN, on);
  }, []);
  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <Picker preset={open.preset} onClose={() => setOpen(null)} />
    </Suspense>
  );
}

const ACTED = "wren.viewAs.acted";
/** Asked once per tab, per person: the Act yes. */
const actedOn = (key: string) => {
  try {
    return (JSON.parse(sessionStorage.getItem(ACTED) ?? "[]") as string[]).includes(key);
  } catch {
    return false;
  }
};
const keepActed = (key: string) => {
  try {
    const was = JSON.parse(sessionStorage.getItem(ACTED) ?? "[]") as string[];
    sessionStorage.setItem(ACTED, JSON.stringify([...was, key]));
  } catch {}
};

const CHIP =
  "cursor-pointer rounded-(--ui-radius) border border-solid border-current/40 bg-transparent px-2.5 py-0.5 text-[13px] text-inherit hover:bg-white/10";
const ON = "bg-white/20 border-current";

/** The strip on top under View as: who, where, Look or Act, Switch, Exit. */
export function ViewAsStrip({ me }: { me: Me | null }) {
  const [asking, setAsking] = useState(false);
  if (!viewing) return null;
  const as = me?.as;
  const who =
    as?.who ?? viewing.email ?? (viewing.role ? `someone new as ${viewing.role}` : "the owner");
  const where = as?.name ?? viewing.client;
  const act = viewing.act === true;
  const sandbox = as?.sandbox ?? false;
  // A role with nobody in it acts only in the sandbox; Act is an admin's.
  const mayAct = viewing.mayAct === true && (!!viewing.email || sandbox);
  const key = `${viewing.client}:${viewing.email ?? viewing.role ?? ""}`;
  const go = (next: ViewAsTab) => viewAs(next);
  const toAct = () => {
    if (sandbox || actedOn(key)) go({ ...viewing, act: true } as ViewAsTab);
    else setAsking(true);
  };
  return (
    <div
      role="status"
      className="flex min-h-10 flex-none flex-wrap items-center justify-center gap-x-3 gap-y-1.5 bg-(--ui-ink) px-4 py-1.5 text-[14px] text-(--ui-on-ink)"
    >
      <span className="min-w-0 break-all">
        Viewing as <strong className="font-medium">{who}</strong> at{" "}
        <strong className="font-medium">{where}</strong>.{" "}
        <span className="opacity-80">{act ? "Changes are logged as you." : "Read only."}</span>
      </span>
      <span className="flex flex-wrap items-center gap-1.5">
        {mayAct ? (
          <fieldset className="m-0 flex border-0 p-0" aria-label="Look or Act">
            <button
              type="button"
              aria-pressed={!act}
              className={`${CHIP} rounded-r-none ${act ? "" : ON}`}
              onClick={() => act && go({ ...viewing, act: false } as ViewAsTab)}
            >
              Look
            </button>
            <button
              type="button"
              aria-pressed={act}
              className={`${CHIP} -ml-px rounded-l-none ${act ? ON : ""}`}
              onClick={() => !act && toAct()}
            >
              Act
            </button>
          </fieldset>
        ) : null}
        <button
          type="button"
          className={CHIP}
          onClick={() => openViewAs({ client: viewing?.client ?? "" })}
        >
          Switch
        </button>
        <button type="button" className={CHIP} onClick={() => viewAs(null)}>
          Exit
        </button>
      </span>
      <Dialog open={asking} onOpenChange={setAsking}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Act as {who} at {where}?
            </DialogTitle>
            <DialogDescription>Every change is logged as you.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button tone="quiet" onClick={() => setAsking(false)}>
              Keep looking
            </Button>
            <Button
              tone="primary"
              onClick={() => {
                keepActed(key);
                go({ ...viewing, act: true } as ViewAsTab);
              }}
            >
              Act
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
