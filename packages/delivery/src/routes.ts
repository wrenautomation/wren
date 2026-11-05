import type { Need, RouteApps } from "@wren/core/access";

/**
 * The delivery API's handlers and what each needs (`@wren/core/access`): the service serves
 * these behind the guard, the edge Worker opens only these. Type imports only, so the Worker
 * bundles it alone.
 */
export const DELIVERY_ROUTES = {
  me: "read",
  board: "read",
  home: "read",
  recordsTypes: "read",
  recordsList: "read",
  recordsGet: "read",
  recordsExport: "read",
  recordsStats: "read",
  updates: "read",
  answer: "act",
  decide: "act",
  comment: "act",
  start: "money",
  post: "act",
  deliver: "act",
  ask: "act",
  done: "act",
  slip: "act",
  result: "act",
  hide: "act",
  people: "read",
  recap: "read",
  account: "read",
  contract: "money",
  sign: "money",
  access: "act",
  invite: "manage",
  remove: "manage",
  upload: "act",
  file: "read",
  // An invoice's PDF: who may see billing.
  invoicePdf: "money",
  pulse: "act",
  review: "act",
  interest: "act",
  // A login's own mail settings: anyone who may read.
  mail: "read",
  // The portal on the client's own host (designs/2026-10-06-custom-domains.md).
  domains: "read",
  addDomain: "manage",
  removeDomain: "manage",
  // Outbound webhooks (designs/2026-10-07-webhooks-out.md).
  webhooks: "read",
  webhookDelivery: "read",
  webhookAdd: "manage",
  webhookEdit: "manage",
  webhookRemove: "manage",
  webhookRotate: "manage",
  webhookTest: "manage",
  webhookRedeliver: "manage",
  // The rules for marketing messages, in the client's own database.
  messagingChange: "manage",
  messagingSender: "manage",
  messagingPostal: "manage",
  messagingLinksOn: "manage",
  messagingLinksOff: "manage",
} as const satisfies Record<string, Need>;
/** Where each route works (`RouteAt`): Work, or the Account pages; records check each type. */
export const DELIVERY_APPS = {
  "*": "map",
  // Who you are and your own mail settings: anyone signed in.
  me: null,
  mail: null,
  recordsTypes: null,
  recordsList: null,
  recordsGet: null,
  recordsExport: null,
  recordsStats: null,
  people: "office",
  account: "office",
  invite: "office",
  remove: "office",
  start: "office",
  contract: "office",
  sign: "office",
  invoicePdf: "office",
  domains: "office",
  addDomain: "office",
  removeDomain: "office",
  webhooks: "office",
  webhookDelivery: "office",
  webhookAdd: "office",
  webhookEdit: "office",
  webhookRemove: "office",
  webhookRotate: "office",
  webhookTest: "office",
  webhookRedeliver: "office",
  messagingChange: "office",
  messagingSender: "office",
  messagingPostal: "office",
  messagingLinksOn: "office",
  messagingLinksOff: "office",
} as const satisfies RouteApps<typeof DELIVERY_ROUTES>;
type DeliveryRoute = keyof typeof DELIVERY_ROUTES;
/** The ones that change something: never cached, never on the demo. */
export const DELIVERY_WRITES: readonly DeliveryRoute[] = [
  "answer",
  "decide",
  "comment",
  "start",
  "post",
  "deliver",
  "ask",
  "done",
  "slip",
  "result",
  "hide",
  "sign",
  "access",
  "invite",
  "remove",
  "upload",
  "pulse",
  "review",
  "interest",
  "mail",
  "addDomain",
  "removeDomain",
  "webhookAdd",
  "webhookEdit",
  "webhookRemove",
  "webhookRotate",
  "webhookTest",
  "webhookRedeliver",
  "messagingChange",
  "messagingSender",
  "messagingPostal",
  "messagingLinksOn",
  "messagingLinksOff",
];

/** Client files (D11): at most this big, and only these types. The web checks first; the service decides. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

export const FILE_TYPES: Readonly<Record<string, string>> = {
  "application/pdf": ".pdf",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "text/plain": ".txt",
  "text/csv": ".csv",
  "application/zip": ".zip",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "application/vnd.ms-excel": ".xls",
  "application/msword": ".doc",
};

/** A type for a file's extension, when the browser or the CLI has none. */
export const typeOfName = (name: string): string | undefined => {
  const ext = /\.[^.]+$/.exec(name.toLowerCase())?.[0];
  if (ext === ".jpeg") return "image/jpeg";
  return Object.keys(FILE_TYPES).find((t) => FILE_TYPES[t] === ext);
};

/** Wren's "write a review" link on Google, or null until the business profile exists (D13). */
export const GOOGLE_REVIEW_URL: string | null = null;

/** A review's five stars (D13), best first: what each means in the mail and on Home. */
export const REVIEW_WORDS: Readonly<Record<number, string>> = {
  5: "Excellent",
  4: "Good",
  3: "Fine",
  2: "Poor",
  1: "Bad",
};

/** The weekly pulse's five taps (D10), best first. */
export const PULSE_WORDS: Readonly<Record<number, string>> = {
  5: "Great",
  4: "Good",
  3: "Okay",
  2: "Not great",
  1: "Bad",
};

/** A project's home: every offer's plan is in Project (designs/2026-11-04-portal-places.md). */
export const PLAN_HOME = "project";

/** Plan pages outside Project: what waits on the client is Today's, the board Results', paperwork Back office's. */
const PLAN_AT: Readonly<Record<string, string>> = {
  "needs-you": "/today/needs-you",
  results: "/results/board",
  paperwork: "/office/paperwork",
  contract: "/office/contract",
};

/** A plan page's address, the same for every offer; a sub-path (`plan/3`) rides along. */
export const planPath = (page: string): string => {
  const [head = "", ...rest] = page.split("/");
  const base = PLAN_AT[head] ?? `/${PLAN_HOME}/${head}`;
  return rest.length ? `${base}/${rest.join("/")}` : base;
};
