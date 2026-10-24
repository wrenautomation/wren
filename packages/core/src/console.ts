/**
 * ConsolePortal: Wren's team reads a view by name, as JSON or CSV. A portal card, a CSV export
 * and an agent read the same answer. Each package says which of its views it allows; the worker
 * passes the lists in, so core never names a product's view.
 *
 * Loops are core's: `loops` lists every object with a `running` key from Restate's admin SQL,
 * so a loop added later shows up with no list to update, and `setLoop` stops or starts one.
 *
 * Records (`./records.ts`) for the team: each package passes its types in, as with views, and
 * the loops ride along as one more type, `console.loop`, read from Restate instead of a view.
 *
 * `addClient` makes a client from the console: its database, migrated, then its row. Its people
 * are added after with DeliveryPortal's `invite` (`delivery.invite`), as anywhere else.
 *
 * `setLook` stores a client's portal look: an operator's for any client, an owner's for their own.
 *
 * Components (`./components.ts`): the catalog is `console.component`, every one for the team and
 * what a client can have for anyone else. `install`, `configure` and `uninstall` write a client's
 * `clients.products[id]`, operator only, each a runs row; `ask` is a client's "Ask for this".
 */

export {
  type ComponentRequest,
  componentRecord,
  type InstallRequest,
} from "./console/components.js";
export {
  type AddClientRequest,
  type AskRequest,
  type CallRequest,
  type Cell,
  type ConnectRequest,
  callCommand,
  consoleApi,
  consoleTypes,
  type DoorRequest,
  type EditRequest,
  type IdsRequest,
  type KeepRequest,
  type SetLookRequest,
  SHOWCASE_LOOKS,
  showcaseIn,
  type TeamSeatRequest,
  type TemplateRequest,
  type UndoRequest,
  type ViewAnswer,
  type ViewRequest,
  type ViewTable,
  type WorkflowSaveRequest,
  type WorkflowTestRequest,
  workflowEffects,
} from "./console/console-api.js";
export { makeConsolePortal } from "./console/console-portal.js";
export {
  checkRecord,
  type ExecutionStep,
  executionId,
  executionRecord,
  executionRecordOf,
  executionSteps,
  holdRecord,
  nowAtLabels,
} from "./console/executions.js";
export {
  formOf,
  type HandlerField,
  type HandlerRow,
  handlerRecord,
  handlersOf,
  inputSchemaOf,
} from "./console/handlers.js";
export {
  type AgentLine,
  eventRecord,
  LOOPS_SQL,
  type LoopRow,
  loopRecord,
  loopsOf,
  type SetLoopRequest,
} from "./console/loops.js";
export {
  type RestateAdmin,
  type RestateAdminGet,
  restateAdmin,
  restateAdminGet,
  runningLoops,
} from "./console/restate-admin.js";
export {
  builtWords,
  settingRecord,
  settingShown,
  settingsForm,
  shownSettings,
} from "./console/settings.js";
export { accountsLacking, lacking } from "./installs.js";
export { toCsv } from "./records-serve.js";
