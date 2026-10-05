import type { Need } from "@wren/core/access";

/**
 * EmailConsole's handlers (`restate/console.ts`) and what each needs. With no `client` they work
 * Wren's own (the need is checked at `wren`); with one, that client's. The edge Worker opens only
 * these and refuses the writes on the demo. Type imports only, so the Worker bundles it alone.
 */
export const EMAIL_CONSOLE_ROUTES = {
  answers: "read",
  // A client's lead sheet (O1): open to whoever may see that client.
  recordsTypes: "read",
  recordsList: "read",
  recordsGet: "read",
  recordsExport: "read",
  recordsStats: "read",
  // Warm replies and inboxes.
  approve: "act",
  drop: "act",
  pause: "act",
  resume: "act",
  // Campaign controls: the kill switch and opener stops stop or start sends.
  setCampaign: "run",
  killSwitchOn: "effect",
  killSwitchOff: "effect",
  stopOpeners: "effect",
  resumeOpeners: "effect",
  // Copy experiments and the candidates the model writes for them.
  startExperiment: "run",
  pauseExperiment: "run",
  resumeExperiment: "run",
  stopExperiment: "run",
  switchExperiment: "run",
  approveCandidate: "act",
  rejectCandidate: "act",
} as const satisfies Record<string, Need>;
export type EmailConsoleRoute = keyof typeof EMAIL_CONSOLE_ROUTES;
/** The ones that change something: never cached, never on the demo. */
export const EMAIL_CONSOLE_WRITES: readonly EmailConsoleRoute[] = (
  Object.keys(EMAIL_CONSOLE_ROUTES) as EmailConsoleRoute[]
).filter((r) => r !== "answers" && !r.startsWith("records"));
