/**
 * One-to-one outreach on a platform where we talk as an account: find
 * people, read one, connect, message, read replies. The contract every
 * platform adapter (`@wren/channel-reddit`, `@wren/channel-linkedin`) meets
 * and the one thing `@wren/outreach` (the loop, the tables, the CLI) knows.
 *
 * An adapter is one account: it is built over a `SiteClient` already pinned
 * with `asAccount(sites, "reddit@alt")`, so the loop never passes an account
 * down. Nothing here paces or caps: the adapter answers one call; the loop
 * decides whether to make it (policy.ts in `@wren/outreach`) and the worker's
 * own caps ledger refuses past them with a 429 either way.
 */
import type { FetchedWith } from "../content/index.js";

export type ReachPlatform = "reddit" | "linkedin";
export const REACH_PLATFORMS: readonly ReachPlatform[] = ["reddit", "linkedin"];

/** One person as a search shows them: enough to decide whether to read more. */
export interface Prospect {
  /** The platform's handle: a Reddit username, a LinkedIn vanity. The identity. */
  handle: string;
  url: string;
  name: string | null;
  /** Their one-line self description (headline, flair); null when the search shows none. */
  headline: string | null;
  /** Where the search saw them: `r/startups`, `search:"recruiting agency"`, `company/acme`. */
  foundIn: string;
}

/** One person's page, read for a reply or a first line. */
export interface Profile extends Prospect {
  about: string | null;
  /** What they do now, as the platform words it (a LinkedIn current role, a Reddit flair). */
  current: string | null;
  company: string | null;
  location: string | null;
  /** Recent things they wrote, newest first (posts, comments); the hook for a first line. */
  recent: Array<{ at: string; where: string; text: string; url: string | null }>;
  /** The adapter's full read, kept as evidence. */
  raw: Record<string, unknown>;
  fetchedAt: string;
  fetchedWith: FetchedWith;
}

/** Where this account stands with a person; only platforms with a connect step answer it. */
export type Relationship = "none" | "pending" | "connected" | "unknown";

export interface Sent {
  /** The platform's id for what went out, when it gives one. */
  ref: string | null;
  at: string;
  fetchedWith: FetchedWith;
}

export interface Reply {
  /** The platform's id: the dedupe key. */
  ref: string;
  handle: string;
  name: string | null;
  text: string;
  at: string;
  /** The conversation it sits in, when the platform threads. */
  threadUrl: string | null;
}

/** The account itself: what the warmup protocol reads before it lets a step through. */
export interface AccountHealth {
  handle: string;
  createdAt: string | null;
  /** The platform's standing score: Reddit karma; null where there is none (LinkedIn). */
  karma: number | null;
  suspended: boolean;
  /** Whether strangers may message it (Reddit `accept_pms`); null = not told. */
  acceptsMessages: boolean | null;
  raw: Record<string, unknown>;
  asOf: string;
}

export interface FindQuery {
  /** Free text; each adapter says what it takes (`r/startups hiring`, `founder recruiting agency`). */
  query: string;
  limit: number;
  /** The adapter's own cursor from the last page. */
  cursor?: string | null;
}

export interface Found {
  prospects: Prospect[];
  cursor: string | null;
  fetchedWith: FetchedWith;
}

export interface OutreachChannel {
  readonly platform: ReachPlatform;
  /** The autobrowse credential this adapter speaks as (`reddit@alt`). */
  readonly account: string;
  find(q: FindQuery): Promise<Found>;
  enrich(handle: string): Promise<Profile>;
  /** Absent when the platform has no connect step (Reddit). */
  relationship?(handle: string): Promise<Relationship>;
  /** Irreversible. Absent when the platform has no connect step. */
  connect?(handle: string, note: string | null): Promise<Sent>;
  /** Irreversible. `subject` is used where the platform has one (Reddit). */
  message(handle: string, text: string, subject?: string | null): Promise<Sent>;
  /** Replies to this account newer than `since`; the caller dedupes by `ref`. */
  replies(since: Date | null): Promise<Reply[]>;
  health(): Promise<AccountHealth>;
}

/** Trims `u/`, `/in/`, a full URL: the bare handle an adapter keys on. */
export function handleOf(platform: ReachPlatform, text: string): string {
  const t = text.trim();
  if (platform === "reddit")
    return t
      .replace(/^https?:\/\/(www\.|old\.)?reddit\.com\/(u|user)\//i, "")
      .replace(/^\/?u(ser)?\//i, "")
      .replace(/\/.*$/, "");
  return t
    .replace(/^https?:\/\/(www\.)?linkedin\.com\/in\//i, "")
    .replace(/^\/?in\//i, "")
    .replace(/[/?#].*$/, "");
}

export const HANDLE_RE: Record<ReachPlatform, RegExp> = {
  reddit: /^[A-Za-z0-9_-]{3,20}$/,
  linkedin: /^[A-Za-z0-9%._-]{3,100}$/,
};

/**
 * In-memory channel for tests and dry runs: finds what it was given, sends
 * are kept, replies are what `receive` put in.
 */
export function fakeOutreachChannel(
  platform: ReachPlatform,
  o: {
    account?: string;
    now?: () => Date;
    prospects?: Prospect[];
    /** Has a connect step (LinkedIn's shape). */
    connects?: boolean;
  } = {},
): OutreachChannel & {
  sent: Array<{ kind: "connect" | "message"; handle: string; text: string | null }>;
  relationships: Map<string, Relationship>;
  receive(r: Reply): void;
  setHealth(h: Partial<AccountHealth>): void;
} {
  const now = o.now ?? (() => new Date());
  const prospects = o.prospects ?? [];
  const sent: Array<{ kind: "connect" | "message"; handle: string; text: string | null }> = [];
  const replies: Reply[] = [];
  const relationships = new Map<string, Relationship>();
  let health: AccountHealth = {
    handle: "fake",
    createdAt: null,
    karma: null,
    suspended: false,
    acceptsMessages: true,
    raw: {},
    asOf: now().toISOString(),
  };
  const sentNow = (): Sent => ({
    ref: `fake_${sent.length}`,
    at: now().toISOString(),
    fetchedWith: "api",
  });
  const base: OutreachChannel = {
    platform,
    account: o.account ?? `${platform}@fake`,
    async find(q) {
      const from = q.cursor ? Number(q.cursor) : 0;
      const page = prospects.slice(from, from + q.limit);
      const next = from + q.limit < prospects.length ? String(from + q.limit) : null;
      return { prospects: page, cursor: next, fetchedWith: "api" };
    },
    async enrich(handle) {
      const p = prospects.find((x) => x.handle === handle) ?? {
        handle,
        url: `https://${platform}.test/${handle}`,
        name: null,
        headline: null,
        foundIn: "enrich",
      };
      return {
        ...p,
        about: null,
        current: null,
        company: null,
        location: null,
        recent: [],
        raw: {},
        fetchedAt: now().toISOString(),
        fetchedWith: "api",
      };
    },
    async message(handle, text) {
      sent.push({ kind: "message", handle, text });
      return sentNow();
    },
    async replies(since) {
      return replies.filter((r) => !since || r.at > since.toISOString());
    },
    async health() {
      return { ...health, asOf: now().toISOString() };
    },
  };
  const withConnect: Partial<OutreachChannel> = o.connects
    ? {
        async relationship(handle) {
          return relationships.get(handle) ?? "none";
        },
        async connect(handle, note) {
          sent.push({ kind: "connect", handle, text: note });
          relationships.set(handle, "pending");
          return sentNow();
        },
      }
    : {};
  return {
    ...base,
    ...withConnect,
    sent,
    relationships,
    receive: (r) => {
      replies.push(r);
    },
    setHealth: (h) => {
      health = { ...health, ...h };
    },
  };
}
