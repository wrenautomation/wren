import type { Need } from "@wren/core/access";

/**
 * VoiceConsole's handlers and what each needs: the edge Worker opens only these. Wren's own
 * agent, so Wren's team. Type imports only.
 */
export const VOICE_CONSOLE_ROUTES = {
  saveTest: "wren:act",
} as const satisfies Record<string, Need>;
export const VOICE_CONSOLE_WRITES: readonly (keyof typeof VOICE_CONSOLE_ROUTES)[] = ["saveTest"];
