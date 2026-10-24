/**
 * Cold SMS: the sender, events, reviews, desk, watch, site forms and console.
 */
import {
  callHooks,
  makeReviews,
  makeSmsConsole,
  makeSmsDesk,
  makeSmsEvents,
  makeSmsForms,
  makeSmsSender,
  makeSmsWatch,
} from "@wren/channel-sms/restate";
import type { AnyService, Deps } from "./deps.js";

/** The sms domain's services, in the order they were served from `services.ts`. */
export function smsServices(deps: Deps): AnyService[] {
  const { clientDb, clientTexts, db, fireAll, keys, openClient, sms } = deps;
  const services: AnyService[] = [];
  services.push(
    makeSmsSender(clientTexts),
    makeSmsEvents({
      ...sms,
      fire: fireAll,
      calls: callHooks({ main: db, clientDb }),
      keys,
    }),
    makeReviews({ main: db, clientDb }),
    makeSmsDesk(clientTexts),
    makeSmsWatch(clientTexts),
    // The lander's push: each site application stepped at once (form.ts).
    makeSmsForms(sms),
    makeSmsConsole({ db, open: openClient }),
  );
  return services;
}
