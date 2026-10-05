/** EmailConsole's handlers (`restate/console.ts`): the edge Worker opens only these, and refuses the writes on the demo. No imports, so the Worker bundles it alone. */
const CAMPAIGN_WRITES = [
  "setCampaign",
  "killSwitchOn",
  "killSwitchOff",
  "stopOpeners",
  "resumeOpeners",
] as const;
/** Copy experiments and the candidates the model writes for them. */
const EXPERIMENT_WRITES = [
  "startExperiment",
  "pauseExperiment",
  "resumeExperiment",
  "stopExperiment",
  "switchExperiment",
  "approveCandidate",
  "rejectCandidate",
] as const;
export const EMAIL_CONSOLE_WRITES = [
  "approve",
  "drop",
  "pause",
  "resume",
  ...CAMPAIGN_WRITES,
  ...EXPERIMENT_WRITES,
] as const;
/** A client's lead sheet (O1): reads, open to whoever may see that client. */
const SHEET_READS = [
  "recordsTypes",
  "recordsList",
  "recordsGet",
  "recordsExport",
  "recordsStats",
] as const;
export const EMAIL_CONSOLE_ROUTES = ["answers", ...SHEET_READS, ...EMAIL_CONSOLE_WRITES] as const;
