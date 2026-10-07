/**
 * The client's own texting setup on Telnyx (designs/2026-10-07-setup-and-vendors.md), the path Wren
 * went through: a brand with The Campaign Registry, a campaign the carriers approve, and each
 * number on that campaign. Carrier review takes days to weeks, so the approval step checks daily.
 */

import { findClient } from "@wren/core/clients";
import { defineSetup, type SetupCheck } from "@wren/core/setup";
import type { Db } from "@wren/db";
import { TEXTS, textsSettingsSchema } from "./clients.js";
import type { Registration } from "./provider.js";

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

export const SMS_SETUPS = [TEXTING_SETUP, NUMBER_SETUP];

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
