/**
 * Where the Map's panels sit: over the canvas, never beside it, so the graph keeps its whole
 * width. A card floats at an edge; on a phone it lies along the foot, up to half the canvas.
 * The details, History, the palette and the edit panels all take their place from here.
 */
import { cx, FLOAT_PANEL } from "@wren/ui";

const FOOT =
  "max-[900px]:top-auto max-[900px]:right-3 max-[900px]:bottom-3 max-[900px]:left-3 max-[900px]:max-h-[55%] max-[900px]:w-auto";
const SOFT = "rounded-[14px]";

/** Where a card sits on the right edge, for a part that brings its own frame. */
export const AT_RIGHT = cx("right-3 w-[360px]", SOFT, FOOT);
/** Where a card sits on the left edge (the palette: `PaletteDrawer`'s `className`). */
export const AT_LEFT = cx("left-3 w-[280px]", SOFT, FOOT);
/** A framed card on the right edge. */
export const OVER_RIGHT = cx(FLOAT_PANEL, AT_RIGHT);
