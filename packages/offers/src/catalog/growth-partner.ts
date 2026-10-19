/**
 * Growth Partner: we fix the offer, then run acquisition end to end; the client closes their own
 * calls. A draft (designs/2026-10-19-business-map.md, "Decisions (planner)"): it is in the
 * registry so the shape's offer node can name it and deals can be made on it. It has no price, no
 * page and no pitch copy. Its terms are `terms_versions` rows, set by William, never here.
 */
import { defineOffer } from "../offer.js";

export const growthPartner = defineOffer({
  id: "growth-partner",
  name: "Growth Partner",
  status: "draft",
  audience: "Businesses that close their own calls.",
  promise: "We fix your offer, then run your acquisition end to end; you close your own calls.",
  price: { kind: "quoted" },
  slots: null,
  days: null,
  youGet: ["Your offer, fixed.", "Your acquisition, run end to end."],
  youGive: ["You close your own calls."],
  weGet: [],
  guarantee: null,
  measures: [{ key: "meetings", label: "Meetings booked", unit: "count" }],
  next: [],
  page: null,
  booking: null,
  application: null,
});
