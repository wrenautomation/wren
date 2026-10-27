/**
 * Reactivation: a client's portal, the loop, and the CLI's `crm run` door.
 */
import { defaultLocalChecker } from "@wren/channel-email";
import { ingressOf } from "@wren/config";
import { sitesHost } from "@wren/core/content/box";
import { ingressSites } from "@wren/core/content/ingress";
import { meteredModel, meteredSites } from "@wren/core/metered";
import { llmForKey } from "@wren/llm";
import { makeCrmRun, makeReactivation, makeReactivationPortal } from "@wren/reactivation/restate";
import { PoliteFetcher } from "@wrenautomation/weaver/fetch";
import { type AnyService, BOOKS_DESK_TIMEOUT_MS, type Deps } from "./deps.js";

/** The reactivation domain's services, in the order they were served from `services.ts`. */
export function reactivationServices(deps: Deps): AnyService[] {
  const {
    classify,
    clientsNotify,
    db,
    freeVerdicts,
    keys,
    llm,
    openClient,
    settings,
    transport,
    ua,
    verifier,
  } = deps;
  const services: AnyService[] = [];
  services.push(
    makeReactivationPortal({ main: db, open: openClient }),
    makeReactivation({
      main: db,
      open: openClient,
      crm: { verifier, checker: defaultLocalChecker(), llm: classify ? llm : null },
      // A client's pass on its own model key or Wren's, metered on its share.
      clientLlm: (client, base) =>
        meteredModel(base, {
          main: db,
          client,
          part: "reactivation.pass",
          now: () => new Date(),
          store: keys,
          own: llmForKey,
          unset: "managed",
        }),
      freeVerify: freeVerdicts,
      transport,
      ...clientsNotify,
    }),
    // `crm run`, `lookup`, `redraft` and `settle` from the CLI: here a client's own keys open.
    makeCrmRun({
      main: db,
      open: openClient,
      crm: {
        verifier,
        checker: defaultLocalChecker(),
        fetcher: ua ? new PoliteFetcher(ua, { timeout: 10, retries: 1 }) : null,
        llm: classify ? llm : null,
      },
      clientLlm: (client, base, { part, runId }) =>
        meteredModel(base, {
          main: db,
          client,
          part,
          runId,
          now: () => new Date(),
          store: keys,
          own: llmForKey,
          unset: "managed",
        }),
      // Inside the call's step, so through the ingress. Exa, X and YouTube on the client's own
      // key, gated and metered on its share; no mode: Wren's, metered, not gated (as signals).
      clientSites: (client, { part, runId }) =>
        meteredSites(
          ingressSites(ingressOf(settings), {
            caller: `wren:crm-run:${client}`,
            ...sitesHost(settings.autobrowseInstanceId),
            timeoutMs: BOOKS_DESK_TIMEOUT_MS,
          }),
          { main: db, client, part, runId, now: () => new Date(), store: keys, unset: "managed" },
        ),
      timezone: settings.sendTimezone,
    }),
  );
  return services;
}
