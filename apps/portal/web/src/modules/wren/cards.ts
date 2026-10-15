/** Loops as cards (Rows / Cards in the list's bar): is it healthy, when it ran, what broke. */
import type { CardSpec } from "@wren/ui";

export const LOOP_CARD: CardSpec = {
  badge: "health",
  body: "error",
  facts: ["key", "state", "lastAt", "nextAt", "failures"],
};
