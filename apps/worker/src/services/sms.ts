/**
 * Cold SMS: the sender, events, desk, watch, site forms and console.
 */

import { makeSmsConsole } from "@wren/delivery/sms";
import { liveCampaignsOf } from "@wren/pipeline/store";
import { makeSmsForms } from "@wren/starling-inbound/sms";
import { makeSmsDesk, makeSmsEvents, makeSmsSend, makeSmsUpkeep } from "@wren/starling-sms/restate";
import type { AnyService, Deps } from "./deps.js";

/** The sms domain's services, in the order they were served from `services.ts`. */
export function smsServices(deps: Deps): AnyService[] {
  const { clientTexts, db, fireAll, keys, openClient, sms } = deps;
  const services: AnyService[] = [];
  services.push(
    makeSmsSend(clientTexts),
    makeSmsEvents({
      ...sms,
      fire: fireAll,
      keys,
    }),
    makeSmsDesk(clientTexts, liveCampaignsOf),
    makeSmsUpkeep(clientTexts),
    // The lander's push: each site application stepped at once (form.ts).
    makeSmsForms(sms),
    makeSmsConsole({ db, open: openClient }),
  );
  return services;
}
