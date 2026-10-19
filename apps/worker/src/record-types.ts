/**
 * Every record type the worker serves, built without a database, a bucket or the lander: Wren's
 * console (`consoleRecords` and the console's own), each client component's, People's and a
 * client's Marketing. The page stories' fake server answers with their metas
 * (`virtual:record-types` in `apps/portal/.storybook/main.ts`).
 */
import type { SendPolicy } from "@wren/channel-email/send/policy";
import { ACCESS_SHAPES } from "@wren/core/access-records";
import { type Client, clientRecord } from "@wren/core/clients";
import { componentRecord, consoleTypes } from "@wren/core/console";
import { MESSAGE_DEFAULTS } from "@wren/core/message-settings";
import { PEOPLE_RECORDS } from "@wren/core/people/console";
import { metaOf, type RecordMeta, type RecordType } from "@wren/core/records";
import type { Queryable } from "@wren/db";
import { deliveryRecords } from "@wren/delivery/records";
import { DOCUMENTS_RECORDS } from "@wren/documents/records";
import { PAYMENTS_RECORDS } from "@wren/payments/records";
import { REACTIVATION_RECORDS, settingOf } from "@wren/reactivation/records";
import { COMPONENTS } from "./components.js";
import { consoleRecords } from "./console-records.js";
import { clientMarketing } from "./marketing.js";
import { WORKFLOWS } from "./workflows.js";

/** Each type once, by id: the console's first, then the clients'. */
export function recordTypes(): RecordType[] {
  const all = [
    ...consoleTypes({
      records: consoleRecords({
        email: { roster: [], policy: {} as SendPolicy },
        sessions: { site: { baseUrl: "", exportToken: "" }, signGet: async () => "" },
      }),
      admin: async () => [],
      adminGet: async () => ({}),
      components: COMPONENTS,
      workflows: WORKFLOWS,
    }),
    clientRecord,
    componentRecord(COMPONENTS, null, true),
    ...ACCESS_SHAPES,
    ...deliveryRecords(
      {} as Queryable,
      "synthetic",
      true,
      undefined,
      undefined,
      undefined,
      async () => MESSAGE_DEFAULTS,
    ),
    ...REACTIVATION_RECORDS,
    settingOf({} as Client),
    ...DOCUMENTS_RECORDS,
    ...PAYMENTS_RECORDS,
    ...PEOPLE_RECORDS,
    ...clientMarketing(),
  ];
  const seen = new Set<string>();
  return all.filter((t) => !seen.has(t.id) && !!seen.add(t.id));
}

/** The metas the portal reads (`recordsTypes`), sorted by id so the snapshot diffs cleanly. */
export const recordMetas = (): RecordMeta[] =>
  recordTypes()
    .map((t) => metaOf(t, false))
    .sort((a, b) => a.id.localeCompare(b.id));
