/**
 * People: a client's People console, segments, the people map, the touch and sourced feeds,
 * and broadcasts.
 */

import { landerHits } from "@wren/calendar/calls";
import { makeBroadcast } from "@wren/core/broadcast-run";
import { loopClients } from "@wren/core/clients";
import { editsOf, savedWorkflows } from "@wren/core/executor";
import { meteredModel } from "@wren/core/metered";
import { makePeopleConsole, PEOPLE_RECORDS } from "@wren/core/people/console";
import { siteCountReader } from "@wren/core/people-map";
import { makePeopleMap } from "@wren/core/people-map-pass";
import { profileRecords } from "@wren/core/profile-records";
import { makeSegments, makeSegmentsRefresh } from "@wren/core/segments-pass";
import { makeTouchToJourney } from "@wren/core/touch-feed";
import { flowsWith } from "@wren/core/workflows";
import { llmForKey } from "@wren/llm";
import { journeyOfProfile } from "@wren/pipeline/records";
import { COMPONENTS } from "../components.js";
import { makeMapLineFeed } from "../line-feed.js";
import { makeListToJourney } from "../sourced-feed.js";
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
      records: [...PEOPLE_RECORDS, ...profileRecords(WORKFLOWS, { journey: journeyOfProfile })],
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
    // dates told to the executor; woken on a changed row, the net every hour.
    ...(() => {
      const segments = {
        main: db,
        clientDb,
        flows: async (client: string | null) =>
          flowsWith(WORKFLOWS, editsOf(await savedWorkflows(db, client)), COMPONENTS).flows,
        clients: () => loopClients(db),
      };
      return [makeSegments(segments), makeSegmentsRefresh(segments)];
    })(),
    // People map: each profile's stage, warmth and persona rebuilt; the net every 30 minutes.
    // Wren's site counts come from the lander's log, 200 visitors a pass.
    ...(() => {
      const map = {
        main: db,
        clientDb,
        clients: () => loopClients(db),
        site: settings.siteExportToken
          ? siteCountReader(
              landerHits({ baseUrl: settings.siteBaseUrl, exportToken: settings.siteExportToken }),
            )
          : null,
      };
      return [makePeopleMap(map)];
    })(),
    // Touch feed (designs/2026-10-18-journeys.md): each workspace's new touches told to the executor
    // once each, for `trigger.touch`: woken by a new touch, the net every 15 minutes. Started by
    // hand, never on its own.
    makeTouchToJourney({
      main: db,
      clientDb,
      clients: () => loopClients(db),
    }),
    // Sourced entries: people added to a list a live source takes entries from open journeys.
    makeListToJourney({
      main: db,
      clientDb,
      clients: () => loopClients(db),
    }),
    // Content lines: documents a find takes, and jobs that end at a station, told to the executor.
    makeMapLineFeed({ main: db }),
    // Broadcasts (B6): each approved one started on its time and sent a batch per run.
    makeBroadcast({ main: db, clientDb, mail: (client, cdb) => mailOf(client, cdb) }),
  );
  return services;
}
