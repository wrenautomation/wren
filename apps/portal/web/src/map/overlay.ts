/**
 * Where the Map's panels sit: over the canvas, never beside it, so the graph keeps its whole
 * width. A card floats at the right edge; on a phone it lies along the foot, up to half the
 * canvas. The details and History take their place from here.
 */
import { cx, FLOAT_PANEL } from "@wren/ui";

const FOOT =
  "max-[900px]:top-auto max-[900px]:right-3 max-[900px]:bottom-3 max-[900px]:left-3 max-[900px]:max-h-[55%] max-[900px]:w-auto";

/** A framed card on the right edge. */
export const OVER_RIGHT = cx(FLOAT_PANEL, "right-3 w-[360px] rounded-[14px]", FOOT);
