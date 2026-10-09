/**
 * The client's own texting setup on Telnyx (designs/2026-10-07-setup-and-vendors.md), the path Wren
 * went through: a brand with The Campaign Registry, a campaign the carriers approve, and each
 * number on that campaign. Carrier review takes days to weeks, so the approval step checks daily.
 */

import { findClient } from "@wren/core/clients";
import { SiteCallError, type SiteClient } from "@wren/core/content";
import { defineSetup, type SetupCheck } from "@wren/core/setup";
import type { Db } from "@wren/db";
import { eq, max } from "drizzle-orm";
import { TEXTS, textsSettingsSchema } from "./clients.js";
import type { Registration } from "./provider.js";
import { smsCalls } from "./schema.js";

export const TEXTING_SETUP = defineSetup({
  id: "setup.texting",
  name: "Texting registration",
  blurb: "Your business registered with US carriers, so your texts are allowed to go out.",
  site: "telnyx",
  repeat: "7 days",
  steps: [
    {
      id: "details",
      fact: "telnyx.brand_details",
      label: "Business details",
      who: "client",
      how: "Send Wren your legal business name, EIN, address and website, exactly as the IRS has them.",
      forYou:
        "Wren's team collects your details from your site and records, and asks you only what's missing.",
    },
    {
      id: "brand",
      fact: "telnyx.brand_registered",
      label: "Brand registered",
      who: "wren",
      how: "Wren registers your brand with The Campaign Registry on Telnyx.",
      forYou: "Wren registers your brand with The Campaign Registry on Telnyx.",
      goal: "register this business as a 10DLC brand on Telnyx",
      buys: true,
    },
    {
      id: "campaign",
      fact: "telnyx.campaign_submitted",
      label: "Campaign submitted",
      who: "wren",
      how: "Wren submits your texting campaign: what you send, sample texts and how people opt in.",
      forYou:
        "Wren submits your texting campaign: what you send, sample texts and how people opt in.",
      goal: "submit a 10DLC campaign for this brand on Telnyx",
      buys: true,
    },
    {
      id: "approved",
      fact: "telnyx.campaign_approved",
      label: "Carriers approve the campaign",
      who: "auto",
      how: "Carriers review the campaign. This takes days to weeks.",
      forYou: "Carriers review the campaign. This takes days to weeks.",
      check: "telnyx.campaign",
      every: "1 day",
      // Past ten days the team hears; the check keeps going until carriers answer.
      within: "10 days",
    },
  ],
});

export const NUMBER_SETUP = defineSetup({
  id: "setup.number",
  name: "Texting number",
  blurb: "A number of your own, on your approved campaign.",
  site: "number",
  repeat: "7 days",
  steps: [
    {
      id: "bought",
      fact: "number.bought",
      label: "Number bought",
      who: "wren",
      how: "Wren buys a local number on your Telnyx profile.",
      forYou: "Wren buys a local number on your Telnyx profile.",
      goal: "buy a local US number on this client's messaging profile",
      buys: true,
    },
    {
      id: "assigned",
      fact: "number.on_campaign",
      label: "Number on the campaign",
      who: "auto",
      how: "Telnyx attaches the number to your approved campaign, within hours.",
      forYou: "Telnyx attaches the number to your approved campaign, within hours.",
      check: "telnyx.number",
      every: "1 hour",
      within: "7 days",
    },
  ],
});

/**
 * Calls to a client's number reach Wren's call app, so a missed one can be texted back
 * (missed.ts). The number's voice settings point at Wren's Telnyx connection; the check passes
 * once a call to it has come in. Until then missed-call text back shows "Needs setup".
 */
export const CALL_ROUTING_SETUP = defineSetup({
  id: "setup.call_routing",
  name: "Call routing",
  blurb: "Calls to your number reach Wren, so a missed one gets a text back.",
  site: "number",
  steps: [
    {
      id: "routed",
      fact: "number.calls_routed",
      label: "Calls reach Wren",
      who: "wren",
      how: "Wren points your number's calls at its call app, then rings it once to test.",
      forYou: "Wren points your number's calls at its call app, then rings it once to test.",
      check: "telnyx.calls",
      every: "1 hour",
      within: "7 days",
    },
  ],
});

/** A Google Place ID, as Google prints it: `ChIJ` and the rest, letters, digits, `-` and `_`. */
export const PLACE_ID = /^[A-Za-z0-9_-]{16,200}$/;

/** The Google review link setup's finder, by name (SetupAgent's `finders`). */
export const PLACE_FINDER = "google_business.place";

/** What autobrowse's `web GET /place` answers. */
export interface PlaceFound {
  placeId: string | null;
  name: string | null;
  address: string | null;
  via: "place" | "list" | "none";
}

/**
 * A business's Place ID from its name and address (the account's ref), read off Google Maps by
 * autobrowse on the Mac (`web GET /place`). A ref that is already a Place ID stands. A site error
 * (the Mac off, the cap spent) is a why, not a retry: the step waits on Wren's team.
 */
export async function findPlace(
  sites: SiteClient,
  ref: string,
): Promise<{ ref: string | null; why: string }> {
  if (PLACE_ID.test(ref)) return { ref, why: "Already a Place ID" };
  let got: PlaceFound;
  try {
    got = await sites.call<PlaceFound>("web", "GET", "/place", { q: ref });
  } catch (err) {
    if (!(err instanceof SiteCallError)) throw err;
    return { ref: null, why: `Google Maps read failed: ${err.message}` };
  }
  if (!got.placeId || !PLACE_ID.test(got.placeId))
    return { ref: null, why: `Google Maps has no place named like "${ref}"` };
  const at = [got.name, got.address].filter(Boolean).join(", ");
  return { ref: got.placeId, why: `Found on Google Maps: ${at || got.placeId}` };
}

/** Where a customer writes a review of the place: Google's own form. */
export const reviewUrl = (placeId: string) =>
  `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`;

/**
 * The client's Google Business Profile, by its Place ID: the review link every ask carries
 * (reviews.ts). The account's ref is the Place ID. Done for you, the account is added under the
 * business's name and address instead, and SetupAgent's finder (`findPlace`) looks it up on
 * Google Maps and makes the Place ID its ref.
 */
export const GOOGLE_BUSINESS_SETUP = defineSetup({
  id: "setup.google_business",
  name: "Google review link",
  blurb: "Your Google Business Profile, so review requests link to your review form.",
  site: "google_business",
  repeat: "7 days",
  steps: [
    {
      id: "place",
      fact: "google_business.place_id",
      label: "Review link found",
      who: "client",
      how: "Find your business with Google's Place ID Finder and send Wren the Place ID.",
      forYou: "Wren finds your Google Business Profile from its name and address.",
      find: PLACE_FINDER,
      check: "google_business.place_id",
      every: "1 hour",
      within: "7 days",
    },
  ],
});

export const SMS_SETUPS = [TEXTING_SETUP, NUMBER_SETUP, CALL_ROUTING_SETUP, GOOGLE_BUSINESS_SETUP];

/**
 * The missed-call and review setups' checks: a call seen to the number in its owner's texts, and
 * a Place ID whose review form Google serves. `fetch` is the one network read.
 */
export function answerChecks(
  dbOf: (client: string | null) => Promise<Db>,
  get: typeof fetch,
): Record<string, SetupCheck> {
  return {
    "telnyx.calls": async ({ account }) => {
      const db = await dbOf(account.client);
      const [row] = await db
        .select({ at: max(smsCalls.startedAt) })
        .from(smsCalls)
        .where(eq(smsCalls.toE164, account.ref));
      return row?.at
        ? { ok: true, why: "A call came through", seen: { last: row.at.toISOString() } }
        : { ok: false, why: "No call to this number has reached Wren yet" };
    },
    "google_business.place_id": async ({ account }) => {
      if (!PLACE_ID.test(account.ref)) return { ok: false, why: "That isn't a Place ID" };
      const res = await get(reviewUrl(account.ref), { method: "GET", redirect: "manual" });
      return res.status < 400
        ? { ok: true, why: "Google serves its review form", seen: { status: res.status } }
        : { ok: false, why: `Google answered ${res.status}`, seen: { status: res.status } };
    },
  };
}

/**
 * Telnyx's reads for the texting setups: the client's campaign (its texts settings name it) and
 * each number's attachment. `wrenCampaign` is Wren's own, for Wren's accounts.
 */
export function smsChecks(
  main: Db,
  reg: Registration,
  wrenCampaign: string | null,
): Record<string, SetupCheck> {
  const campaignOf = async (client: string | null) => {
    if (client === null) return wrenCampaign;
    const c = await findClient(main, client);
    const t = textsSettingsSchema.safeParse(
      (c?.products as Record<string, unknown>)?.[TEXTS] ?? {},
    );
    return t.success ? t.data.campaignId : null;
  };
  return {
    "telnyx.campaign": async ({ account }) => {
      const id = await campaignOf(account.client);
      if (!id) return { ok: false, why: "No campaign id set yet" };
      const s = await reg.campaign(id);
      return s.status === "approved"
        ? { ok: true, why: "Approved", seen: s }
        : { ok: false, why: `Carriers say ${s.raw}`, seen: s };
    },
    "telnyx.number": async ({ account }) => {
      const id = await campaignOf(account.client);
      const a = await reg.number(account.ref);
      if (a.status === "assigned" && (!id || a.campaignId === id))
        return { ok: true, why: "On the campaign", seen: a };
      return {
        ok: false,
        why: a.status === "assigned" ? "On another campaign" : "Not attached yet",
        seen: a,
      };
    },
  };
}
