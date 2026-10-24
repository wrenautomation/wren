/**
 * People: a client's People console, segments, the people map, the touch and sourced feeds,
 * and broadcasts.
 */
import { landerHits } from "@wren/channel-email/calls";
import { makeBroadcast } from "@wren/core/broadcast-run";
import { listClients } from "@wren/core/clients";
import { meteredModel } from "@wren/core/metered";
import { makePeopleConsole, PEOPLE_RECORDS } from "@wren/core/people/console";
import { siteCountReader } from "@wren/core/people-map";
import { makePeopleMap, makePeopleMapNet } from "@wren/core/people-map-pass";
import { profileRecords } from "@wren/core/profile-records";
import { makeSegments, makeSegmentsNet } from "@wren/core/segments-pass";
import { editsOf, savedWorkflows } from "@wren/core/spine";
import { makeTouchFeed } from "@wren/core/touch-feed";
import { flowsWith } from "@wren/core/workflows";
import { llmForKey } from "@wren/llm";
import { COMPONENTS } from "../components.js";
import { makeSourcedFeed } from "../sourced-feed.js";
import { WORKFLOWS } from "../workflows.js";
import type { AnyService, Deps } from "./deps.js";

/** The people domain's services, in the order they were served from `services.ts`. */
export function peopleServices(deps: Deps): AnyService[] {
  const { clientDb, db, keys, llm, mailOf, openClient, settings } = deps;
  const services: AnyService[] = [];
  services.push(
    // A client's People (the sent log, profiles, segments) from its own database; Wren's segments.
    makePeopleConsole({
      db,
      open: openClient,
      records: [...PEOPLE_RECORDS, ...profileRecords(WORKFLOWS)],
      // Broadcasts (B6): each workspace's email and its tests; a text test only to the operator's phone.
      mail: (client, cdb) => mailOf(client, cdb),
      testPhone: settings.operatorPhone ?? null,
      // Describe segment: Wren's model for Wren, a client's own key or Wren's, metered on its share.
      model: (client) =>
        client
          ? meteredModel(llm, {
              main: db,
              client,
              part: "people.segments",
              now: () => new Date(),
              store: keys,
              own: llmForKey,
              unset: "managed",
            })
          : llm,
    }),
    // Segments (B5): each workspace's live segments kept true, entries, exits, trait changes and
    // dates told to the spine; woken on a changed row, the net every 15 minutes.
    ...(() => {
      const segments = {
        main: db,
        clientDb,
        flows: async (client: string | null) =>
          flowsWith(WORKFLOWS, editsOf(await savedWorkflows(db, client)), COMPONENTS).flows,
        clients: async () => (await listClients(db)).map((c) => c.id),
      };
      return [makeSegments(segments), makeSegmentsNet(segments)];
    })(),
    // People map: each profile's stage, warmth and persona rebuilt; the net every 15 minutes.
    // Wren's site counts come from the lander's log, 200 visitors a pass.
    ...(() => {
      const map = {
        main: db,
        clientDb,
        clients: async () => (await listClients(db)).map((c) => c.id),
        site: settings.siteExportToken
          ? siteCountReader(
              landerHits({ baseUrl: settings.siteBaseUrl, exportToken: settings.siteExportToken }),
            )
          : null,
      };
      return [makePeopleMap(map), makePeopleMapNet(map)];
    })(),
    // Touch feed (designs/2026-10-18-journeys.md): each workspace's new touches told to the spine
    // once each, every minute, for `trigger.touch`. Started by hand, never on its own.
    makeTouchFeed({
      main: db,
      clientDb,
      clients: async () => (await listClients(db)).map((c) => c.id),
    }),
    // Sourced entries: people added to a list a live source takes entries from open journeys.
    makeSourcedFeed({
      main: db,
      clientDb,
      clients: async () => (await listClients(db)).map((c) => c.id),
    }),
    // Broadcasts (B6): each approved one started on its time and sent a batch per run.
    makeBroadcast({ main: db, clientDb, mail: (client, cdb) => mailOf(client, cdb) }),
  );
  return services;
}
