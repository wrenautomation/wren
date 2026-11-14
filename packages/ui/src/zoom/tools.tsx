/** Zoom in, out, fit and full screen: the same buttons on every graph (GraphFrame, the variants tree). */
import { cn } from "cn";
import type { FullScreen } from "../full-screen.js";
import { tipProps } from "../hint.js";
import { Icon } from "../icons.js";

const TOOL =
  "inline-flex size-8 items-center justify-center border-0 bg-(--ui-paper) text-(--ui-ink-2) shadow-[inset_0_0_0_1px_var(--ui-hair)] hover:bg-(--ui-hover) hover:text-(--ui-ink) cursor-pointer";

export interface ZoomToolsProps {
  onIn: () => void;
  onOut: () => void;
  onFit: () => void;
  /** double-click on fit: back to the start */
  onRest?: (() => void) | undefined;
  /** all of it shows at rest; when not, the fit button says so in words */
  fits?: boolean | undefined;
  /** useFullScreen() of the part: adds the full-screen button */
  full?: FullScreen | undefined;
  className?: string | undefined;
}

export function ZoomTools({
  onIn,
  onOut,
  onFit,
  onRest,
  fits = true,
  full,
  className,
}: ZoomToolsProps) {
  return (
    <div className={cn("flex gap-px", className)}>
      <button
        type="button"
        className={TOOL}
        {...tipProps("Zoom in", { keys: "+", as: "none" })}
        aria-label="Zoom in"
        onClick={onIn}
      >
        <Icon name="plus" className="size-3.5" />
      </button>
      <button
        type="button"
        className={TOOL}
        {...tipProps("Zoom out", { keys: "−", as: "none" })}
        aria-label="Zoom out"
        onClick={onOut}
      >
        <Icon name="minus" className="size-3.5" />
      </button>
      <button
        type="button"
        className={cn(TOOL, !fits && "w-auto gap-1.5 px-2.5 text-[12.5px] font-medium")}
        {...tipProps(onRest ? "Fit all. Double-click: back to the start" : "Fit all", {
          keys: "F",
          as: "none",
        })}
        aria-label="Fit all"
        onClick={onFit}
        onDoubleClick={onRest}
      >
        <Icon name="fit" className="size-3.5" />
        {fits ? null : "Fit all"}
      </button>
      {full ? <FullScreenButton full={full} /> : null}
    </div>
  );
}

/** The full-screen switch, in the zoom tools' look: alone on a part with no zoom tools (the metro map). */
export function FullScreenButton({
  full,
  className,
}: {
  full: FullScreen;
  className?: string | undefined;
}) {
  return (
    <button
      type="button"
      className={cn(TOOL, className)}
      {...tipProps(full.label, full.full ? { keys: "Esc", as: "none" } : { as: "none" })}
      aria-label={full.label}
      aria-pressed={full.full}
      onClick={full.toggle}
    >
      <Icon name={full.icon} className="size-3.5" />
    </button>
  );
}
