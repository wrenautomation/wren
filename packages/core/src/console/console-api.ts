/**
 * `consoleApi`: every ConsolePortal handler as a plain function over the deps the worker
 * passes in. One call builds the context (`./api/context.ts`: the deps and the closures the
 * handlers share), then spreads one handler group per file under `./api/`; the request shapes
 * they take are `./api/requests.ts` and `consoleTypes`, the record types the console serves, is
 * the context's. `makeConsolePortal` (`./console-portal.ts`) binds them, by these names: Restate
 * journals and the portal's calls are keyed by them, so no handler is renamed.
 */
import { createDb } from "@wren/db";
import { accessApi } from "../access-console.js";
import { clientUrl, findClient } from "../clients/index.js";
import { customApi } from "../custom-console.js";
import { PortalRefusal } from "../portal.js";
import { callsHandlers } from "./api/calls.js";
import { clientsHandlers } from "./api/clients.js";
import { componentsHandlers } from "./api/components.js";
import { type ConsoleDeps, consoleContext } from "./api/context.js";
import { executionsHandlers } from "./api/executions.js";
import { libraryHandlers } from "./api/library.js";
import { loopsHandlers } from "./api/loops.js";
import { recordsHandlers } from "./api/records.js";
import { workflowsHandlers } from "./api/workflows.js";

export { consoleTypes } from "./api/context.js";
export {
  type AddClientRequest,
  type AskRequest,
  type CallRequest,
  type Cell,
  type ConnectRequest,
  callCommand,
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
} from "./api/requests.js";
export { workflowEffects } from "./api/workflows.js";

export function consoleApi(deps: ConsoleDeps) {
  const ctx = consoleContext(deps);
  const { main, mainUrl, typesFor, rowAt } = ctx;
  return {
    ...accessApi({ main, typesFor, rowAt }),
    ...customApi(main, async (id, fn) => {
      const client = await findClient(main, id);
      if (!client) throw new PortalRefusal("no such client", 404);
      if (!mainUrl) throw new PortalRefusal("this worker can't reach the client's database", 503);
      const handle = createDb(clientUrl(mainUrl, client), { max: 1, app: "wren-console" });
      try {
        return await fn(handle.db);
      } finally {
        await handle.close();
      }
    }),
    ...loopsHandlers(ctx),
    ...recordsHandlers(ctx),
    ...libraryHandlers(ctx),
    ...clientsHandlers(ctx),
    ...componentsHandlers(ctx),
    ...workflowsHandlers(ctx),
    ...executionsHandlers(ctx),
    ...callsHandlers(ctx),
  };
}
