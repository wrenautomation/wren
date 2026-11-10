/** Zoom in, out and fit: the same three buttons on every graph (GraphFrame, the variants tree). */
import { cn } from "cn";
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
  className?: string | undefined;
}

export function ZoomTools({ onIn, onOut, onFit, onRest, fits = true, className }: ZoomToolsProps) {
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
    </div>
  );
}
