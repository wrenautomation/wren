/** The page's one dictation engine (engine.ts); null where there's no browser. */
import { PortalDictation } from "./engine.js";

export const dictation: PortalDictation | null =
  typeof window === "undefined" ? null : new PortalDictation();
