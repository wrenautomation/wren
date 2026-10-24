/**
 * The request shapes every ConsolePortal handler takes (`consoleApi`, `../console-api.ts`), and
 * the public constants beside them: a look's showcase presets and the runs row's command line.
 */
import type { RoleId } from "../../access.js";
import type { PortalRequest } from "../../portal.js";

export interface ViewRequest extends PortalRequest {
  view: string;
  format?: "json" | "csv";
}

export type Cell = string | number | boolean | null;

export interface ViewTable {
  view: string;
  columns: string[];
  rows: Cell[][];
}

export type ViewAnswer = ViewTable | { view: string; csv: string };

/** SQL over Restate's own tables, through its admin API. */
export interface AddClientRequest extends PortalRequest {
  id: string;
  name: string;
}

export interface SetLookRequest extends PortalRequest {
  /** A preset's name, `readTheme` input, or null for Wren's. */
  look: unknown;
}

/** A seat on Wren's team: a field left out keeps its value; `clients` null is every client. */
export interface TeamSeatRequest extends PortalRequest {
  email: string;
  role?: RoleId;
  /** Ids, or a form's comma list; null, blank or "all" is every client. */
  clients?: string[] | string | null;
}

/** A template on a client (designs/2026-10-07-template-install.md). */
export interface TemplateRequest extends PortalRequest {
  template?: unknown;
  /** The template's id, typed, when it has effects. */
  confirm?: unknown;
  /** True once the plan of an update was read. */
  update?: unknown;
}

/** To approve items (`workflow:<id>`) a person approves or declines. */
export interface IdsRequest extends PortalRequest {
  ids?: unknown;
}

/** One of a client's accounts (`ACCOUNTS`), set by Wren's team; an empty `account` removes it. */
export interface ConnectRequest extends PortalRequest {
  site: string;
  account: string;
}

/** A workflow's routed wires and custom steps from the canvas; `reset` goes back to the code's. */
export interface WorkflowSaveRequest extends PortalRequest {
  workflow: string;
  wires?: unknown;
  steps?: unknown;
  /** Built-in logic nodes' settings as the draft has them (`WorkflowEdits.settings`). */
  settings?: unknown;
  /** Auto-retry tries, 0 (off) to 5 (`WorkflowEdits.retry`). */
  retry?: unknown;
  reset?: boolean;
  /** A made workflow's new name, kept on its draft. */
  name?: unknown;
  /** The workflow's id, typed: a workflow with a node that sends, posts or spends needs it. */
  confirm?: string;
  /**
   * The newest save the editor read (its draft's or live's id; 0 for none). A save made since
   * refuses this one as changed elsewhere. Absent: no check (the CLI).
   */
  expect?: unknown;
}

/** A door of a workflow's node: its id, for Reveal and Rotate. */
export interface DoorRequest extends PortalRequest {
  workflow?: string;
  id?: unknown;
}

/** A dry test of a draft: from its first input, or one `node` at `port`; a sample or a real event. */
export interface WorkflowTestRequest extends PortalRequest {
  workflow: string;
  wires?: unknown;
  steps?: unknown;
  settings?: unknown;
  node?: unknown;
  port?: unknown;
  kind?: unknown;
  data?: unknown;
  /** Where a whole test enters: "in.<port>" or a trigger's "<node>.<port>". */
  from?: unknown;
  /** A real arrival's id: its data, pinned. */
  event?: unknown;
  /** What every rule answers; yes when left out. */
  rules?: unknown;
  /** What the test's store heard (`UNTILS`): a Wait until one of them lets go at once. */
  heard?: unknown;
}

/**
 * Wren's loud looks (`SHOWCASE` in @wren/ui's theme.tsx; a test keeps the names the same) and
 * the tokens only they use. A client's portal stays plain: none of these on a client.
 */
export const SHOWCASE_LOOKS: readonly string[] = [
  "aurora",
  "synthwave",
  "terminal",
  "gilded",
  "riso",
  "brutal",
];

export const showcaseIn = (look: unknown): boolean => {
  if (typeof look === "string") return SHOWCASE_LOOKS.includes(look);
  if (!look || typeof look !== "object") return false;
  const l = look as Record<string, unknown>;
  return (
    (typeof l.preset === "string" && SHOWCASE_LOOKS.includes(l.preset)) ||
    "backdrop" in l ||
    "grain" in l
  );
};

/** One record of Wren's that declares edits. */
interface RecordRequest extends PortalRequest {
  record?: unknown;
  id?: unknown;
}

export interface EditRequest extends RecordRequest {
  patch?: unknown;
  /** The version the editor started from (`edit.version` on the record). */
  expect?: unknown;
  /** Claude's ask whose patch this is: Accept. */
  run?: unknown;
}

export interface UndoRequest extends RecordRequest {
  change?: unknown;
}

export interface AskRequest extends RecordRequest {
  message?: unknown;
}

/** Saved views and prefs (`./saved-views.ts`): what each handler reads of it, checked there. */
export interface KeepRequest extends PortalRequest {
  record?: unknown;
  id?: unknown;
  name?: unknown;
  params?: unknown;
  shared?: unknown;
  ids?: unknown[];
  key?: unknown;
  keys?: unknown[];
  value?: unknown;
}

export interface CallRequest extends PortalRequest {
  service: string;
  handler: string;
  /** The object's or workflow's key; a plain service takes none. */
  key?: string;
  input?: unknown;
  /** The handler's name typed in: a handler with an effect runs only with it. */
  confirm?: string;
  /** Start it and answer at once: a read that takes minutes would outlast the page's request. */
  send?: boolean;
  /**
   * The row the call is about (a record type and its id). A login without `run` over all of
   * Wren calls only that type's `calls`, on a row it may act on, with the input naming the row.
   */
  on?: { record?: unknown; id?: unknown };
}

/** The runs row's command: one line on the run trail, as a CLI command would be. */
export const callCommand = (service: string, handler: string) =>
  `console ${service}/${handler}`.slice(0, 64);
