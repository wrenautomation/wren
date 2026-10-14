/**
 * PeopleConsole: a client's People records, from its own database, for anyone who may open that
 * client (designs/2026-10-14-customerio-audit.md). Today the sent log; B1's profiles join
 * `PEOPLE_RECORDS`. Read only. Wren's own People is served by the console.
 */
import type * as restate from "@restatedev/restate-sdk";
import { type Db, snapshot } from "@wren/db";
import { z } from "zod";
import type { Client } from "./clients/schema.js";
import { PEOPLE_CONSOLE_APPS, PEOPLE_CONSOLE_ROUTES } from "./people-console-routes.js";
import { answer, type PortalRequest, pickClient, portalService } from "./portal.js";
import { metaOf, type RecordType } from "./records.js";
import {
  type ExportAsk,
  fenceFor,
  type GetAsk,
  type ListAsk,
  meOf,
  opens,
  type RecordsApi,
  type StatsAsk,
  serveRecords,
} from "./records-serve.js";
import { PORTAL_FIELDS, serviceHandler } from "./restate/form.js";
import { SENT_RECORDS } from "./sent-records.js";

/** The record types a client's People serves. Each build adds its own here. */
export const PEOPLE_RECORDS = [...SENT_RECORDS];

export interface PeopleConsoleDeps {
  /** Main: the client registry. */
  db: Db;
  /** A client's database. */
  open: (client: Pick<Client, "id" | "database">) => Db;
  /** Left out: `PEOPLE_RECORDS`. */
  records?: readonly RecordType[];
}

/** The handlers as plain functions: the service wraps them, tests call them. */
export function peopleConsoleApi({ db, open, records = PEOPLE_RECORDS }: PeopleConsoleDeps) {
  const read = async <T>(req: PortalRequest, use: (api: RecordsApi) => Promise<T>) => {
    const client = await pickClient(db, req);
    return snapshot(open(client), (tx) =>
      use(serveRecords(records, tx, undefined, fenceFor(req, client.id), meOf(req))),
    );
  };
  return {
    recordsTypes: async (req: PortalRequest) => {
      const fence = fenceFor(req, (await pickClient(db, req)).id);
      return records.filter((t) => !fence || opens(t, fence(t))).map((t) => metaOf(t, false));
    },
    recordsList: (req: PortalRequest & ListAsk) => read(req, (r) => r.list(req)),
    recordsGet: (req: PortalRequest & GetAsk) => read(req, (r) => r.get(req)),
    recordsExport: (req: PortalRequest & ExportAsk) => read(req, (r) => r.export(req)),
    recordsStats: (req: PortalRequest & StatsAsk) => read(req, (r) => r.stats(req)),
  };
}

const RECORDS = { input: z.looseObject(PORTAL_FIELDS) };

export function makePeopleConsole(deps: PeopleConsoleDeps) {
  const api = peopleConsoleApi(deps);
  return portalService({
    name: "PeopleConsole",
    main: deps.db,
    routes: PEOPLE_CONSOLE_ROUTES,
    apps: PEOPLE_CONSOLE_APPS,
    unnamed: "first",
    handlers: {
      recordsTypes: serviceHandler(RECORDS, (_: restate.Context, req: PortalRequest) =>
        answer(() => api.recordsTypes(req)),
      ),
      recordsList: serviceHandler(RECORDS, (_: restate.Context, req: PortalRequest & ListAsk) =>
        answer(() => api.recordsList(req)),
      ),
      recordsGet: serviceHandler(RECORDS, (_: restate.Context, req: PortalRequest & GetAsk) =>
        answer(() => api.recordsGet(req)),
      ),
      recordsExport: serviceHandler(RECORDS, (_: restate.Context, req: PortalRequest & ExportAsk) =>
        answer(() => api.recordsExport(req)),
      ),
      recordsStats: serviceHandler(RECORDS, (_: restate.Context, req: PortalRequest & StatsAsk) =>
        answer(() => api.recordsStats(req)),
      ),
    },
  });
}

export type PeopleConsoleService = ReturnType<typeof makePeopleConsole>;
