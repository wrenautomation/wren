import type { Need } from "@wren/core/access";

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
  pulse: "act",
  review: "act",
  interest: "act",
  // A login's own mail settings: anyone who may read.
  mail: "read",
} as const satisfies Record<string, Need>;
export type DeliveryRoute = keyof typeof DELIVERY_ROUTES;
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
