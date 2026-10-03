/** EmailConsole's handlers (`restate/console.ts`): the edge Worker opens only these, and refuses the writes on the demo. No imports, so the Worker bundles it alone. */
export const EMAIL_CONSOLE_ROUTES = ["answers", "approve", "drop", "pause", "resume"] as const;
export const EMAIL_CONSOLE_WRITES = ["approve", "drop", "pause", "resume"] as const;
