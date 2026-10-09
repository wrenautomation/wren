/** The page's one reading-aloud engine (engine.ts); null where there's no browser. */
import { PortalReading } from "./engine.js";

export const reading: PortalReading | null =
  typeof window === "undefined" ? null : new PortalReading();
