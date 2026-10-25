/**
 * One rule for every site call: read, staging or send. It decides how a call runs.
 *
 * - `read`: shows nothing to people and changes nothing. Never keyed, retried on a 5xx, and it
 *   never notes a send's trace.
 * - `staging`: a write that no person can see yet (a container, an upload), and a repeat does no
 *   harm. Same as `read` for keys and retries. A refused publish after only staging writes is the
 *   platform's no, never "may have gone out".
 * - `send`: anything else. A person can see it, or a repeat could post twice. Keyed inside a send
 *   scope, never retried blind. The default for every write not listed here.
 *
 * Concrete paths arrive (`/17841400000/media`), so each row is a pattern. A new route is `send`
 * until a row here says otherwise: add a row only when its harm is nil and the reason fits one line.
 */
import type { SiteMethod } from "./autobrowse.js";

type RouteKind = "read" | "staging" | "send";

interface Row {
  site: string;
  /** The path, without a query. */
  path: RegExp;
  kind: "read" | "staging";
  /** Why this route is not a send. */
  why: string;
}

/** Every non-GET route that is not a send. A GET is always a read. */
const ROUTES: readonly Row[] = [
  // POST routes that only read.
  {
    site: "tiktok",
    path: /^\/v2\/post\/publish\/creator_info\/query\/$/,
    kind: "read",
    why: "the creator's posting limits",
  },
  {
    site: "tiktok",
    path: /^\/v2\/post\/publish\/status\/fetch\/$/,
    kind: "read",
    why: "the state of a publish",
  },
  {
    site: "tiktok",
    path: /^\/v2\/video\/(list|query)\/$/,
    kind: "read",
    why: "the account's own videos",
  },
  {
    site: "perplexity",
    path: /^\/chat\/completions$/,
    kind: "read",
    why: "an answer; nothing posts",
  },
  // Writes that no person sees, and a repeat is harmless.
  {
    site: "threads",
    path: /^\/[^/]+\/threads$/,
    kind: "staging",
    why: "a container; only threads_publish shows it",
  },
  {
    site: "meta",
    path: /^\/[^/]+\/media$/,
    kind: "staging",
    why: "an Instagram container; only media_publish shows it",
  },
  {
    site: "x",
    path: /^\/2\/media\/upload(\/.*)?$/,
    kind: "staging",
    why: "a file upload; no post names it yet",
  },
  {
    // `UPLOAD_PATH` in packages/channel-linkedin/src/content.ts: initializeUpload and the parts.
    site: "linkedin",
    path: /^\/upload$/,
    kind: "staging",
    why: "an asset upload; no post names it yet",
  },
  {
    site: "youtube",
    path: /^\/upload\/youtube\/v3\/thumbnails\/set$/,
    kind: "staging",
    why: "a repeat sets the same image",
  },
];

/** How a call to this route runs. See the file comment. */
export function routeKind(site: string, method: SiteMethod, path: string): RouteKind {
  if (method === "GET") return "read";
  const bare = path.split("?")[0] ?? path;
  return ROUTES.find((r) => r.site === site && r.path.test(bare))?.kind ?? "send";
}

/** The table, for tests and for a person who asks why a route is not a send. */
export const routeTable = (): readonly Readonly<Row>[] => ROUTES;
