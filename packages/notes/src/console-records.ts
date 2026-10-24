/** Notes handlers behind the records list: boards and task cards. */
import type { PortalRequest } from "@wren/core/portal";
import { metaOf } from "@wren/core/records";
import {
  type ExportAsk,
  fenceFor,
  type GetAsk,
  type ListAsk,
  opens,
  type StatsAsk,
} from "@wren/core/records/serve";
import type { NotesApiContext } from "./console-context.js";
import { taskRecordFor } from "./task-records.js";

export function recordsHandlers(notes: NotesApiContext) {
  const { placeOf, boards, cardRecords } = notes;
  return {
    ...boards,
    async recordsTypes(req: PortalRequest) {
      const place = await placeOf(req);
      const type = taskRecordFor(place.client?.id ?? null);
      const fence = fenceFor(req, place.ws);
      return [type].filter((t) => !fence || opens(t, fence(t))).map((t) => metaOf(t, false));
    },
    recordsList: (req: PortalRequest & ListAsk) => cardRecords(req, (r) => r.list(req)),
    recordsGet: (req: PortalRequest & GetAsk) => cardRecords(req, (r) => r.get(req)),
    recordsExport: (req: PortalRequest & ExportAsk) => cardRecords(req, (r) => r.export(req)),
    recordsStats: (req: PortalRequest & StatsAsk) => cardRecords(req, (r) => r.stats(req)),
  };
}
