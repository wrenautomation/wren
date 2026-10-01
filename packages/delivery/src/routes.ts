/** The delivery API's handlers: the service serves these, the edge Worker opens only these. No imports, so the Worker bundles it alone. */
export const DELIVERY_ROUTES = [
  "me",
  "board",
  "home",
  "updates",
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
  "people",
  "invite",
  "remove",
  "upload",
  "file",
  "pulse",
  "mail",
] as const;
export type DeliveryRoute = (typeof DELIVERY_ROUTES)[number];
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
  "invite",
  "remove",
  "upload",
  "pulse",
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

/** The weekly pulse's five taps (D10), best first. */
export const PULSE_WORDS: Readonly<Record<number, string>> = {
  5: "Great",
  4: "Good",
  3: "Okay",
  2: "Not great",
  1: "Bad",
};
