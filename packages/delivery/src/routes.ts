/** The delivery API's handlers: the service serves these, the edge Worker opens only these. No imports, so the Worker bundles it alone. */
export const DELIVERY_ROUTES = [
  "me",
  "home",
  "updates",
  "answer",
  "decide",
  "start",
  "post",
  "deliver",
  "ask",
  "done",
  "slip",
  "result",
  "hide",
  "people",
  "invite",
  "remove",
] as const;
export type DeliveryRoute = (typeof DELIVERY_ROUTES)[number];
/** The ones that change something: never cached, never on the demo. */
export const DELIVERY_WRITES: readonly DeliveryRoute[] = [
  "answer",
  "decide",
  "start",
  "post",
  "deliver",
  "ask",
  "done",
  "slip",
  "result",
  "hide",
  "invite",
  "remove",
];
