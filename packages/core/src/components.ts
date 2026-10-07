/**
 * A component: one feature's manifest. What it is, what it needs, what it gives,
 * and whether a client can have it yet. Each package exports its own from
 * `src/components.ts`; the worker collects them into `COMPONENTS`. This module
 * knows the shape, never a component.
 */
import { z } from "zod";

/** What a component does to the world, asked for by a typed confirm on install. */
export type Effect = "spends" | "sends" | "posts";

/** Sites a component can need an account on: the keys of `clients.accounts`. */
export const ACCOUNT_SITES = [
  "gmail",
  "linkedin",
  "calcom",
  "telnyx",
  "meta",
  "search_console",
  "google_calendar",
  "youtube",
  "linkedin_page",
  "x",
  "tiktok",
  "instagram",
  "reddit",
  "postmaster",
  "google_business",
] as const;
export type AccountSite = (typeof ACCOUNT_SITES)[number];

/**
 * How a client connects one account, as the Shop says it (designs/2026-10-07-per-client-runs.md).
 * Wren's team saves what `holds` names into `clients.accounts`; nothing here signs in anywhere.
 */
export interface AccountHow {
  label: string;
  /** What `clients.accounts[site]` holds. */
  holds: string;
  /** What the client does, said to the client. */
  how: string;
  /** What still waits on Wren before any client can connect it; null when nothing does. */
  waits: string | null;
  /** Its value is a login in Wren's browser: the team's to see. Else the client sees its own. */
  teamOnly?: true;
}

export const ACCOUNTS: Record<AccountSite, AccountHow> = {
  google_business: {
    label: "Google Business Profile",
    holds: "the Place ID",
    how: "Send Wren your Google Place ID, or let Wren find it.",
    waits: null,
  },
  gmail: {
    label: "Sending mailbox",
    holds: "the mailbox's sign-in",
    teamOnly: true,
    how: "Wren sets up the mailbox your email goes out from.",
    waits: null,
  },
  linkedin: {
    label: "LinkedIn login",
    holds: "the login's name in Wren's browser",
    teamOnly: true,
    how: "Give Wren a LinkedIn login. Wren's team adds it to its browser.",
    waits: null,
  },
  calcom: {
    label: "Cal.com",
    holds: "the booking page",
    how: "Share your Cal.com booking page with Wren.",
    waits: null,
  },
  telnyx: {
    label: "Phone number",
    holds: "the number",
    how: "Wren registers a texting number for you.",
    waits: "Registering the number, which costs money",
  },
  meta: {
    label: "Meta ad account",
    holds: "the ad account id, like act_123",
    how: "In Meta Business Settings, add Wren's business as a partner on your ad account.",
    waits: "Ad spend, and the ads access of Wren's Meta app",
  },
  search_console: {
    label: "Search Console",
    holds: "the property, like sc-domain:example.com",
    how: "In Search Console, add Wren's service account as a user on your property.",
    waits: null,
  },
  google_calendar: {
    label: "Google Calendar",
    holds: "the calendar's address",
    how: "Your Google Workspace admin lets Wren's service account use your calendar.",
    waits: "Google's review of Wren's app, only for a calendar outside Workspace",
  },
  youtube: {
    label: "YouTube channel",
    holds: "the channel id",
    how: "Sign in with Google and let Wren post to your channel.",
    waits: "Google's review of Wren's app",
  },
  linkedin_page: {
    label: "LinkedIn company page",
    holds: "the page id",
    how: "Sign in with LinkedIn and let Wren post to your company page.",
    waits: "LinkedIn's review of Wren's app",
  },
  x: {
    label: "X account",
    holds: "the handle",
    how: "Sign in with X and let Wren post. For DMs, give Wren a login.",
    waits: "X's paid API plan, for posts",
  },
  tiktok: {
    label: "TikTok account",
    holds: "the handle",
    how: "Sign in with TikTok and let Wren post.",
    waits: "TikTok's review of Wren's app",
  },
  instagram: {
    label: "Instagram account",
    holds: "the account id",
    how: "Add Wren's business as a partner on your Instagram account.",
    waits: "Meta's review of Wren's app",
  },
  reddit: {
    label: "Reddit logins",
    holds: "the logins' names in Wren's browser, comma separated",
    teamOnly: true,
    how: "Give Wren a Reddit login. Wren's team adds it to its browser.",
    waits: null,
  },
  postmaster: {
    label: "Google Postmaster",
    holds: "the sending domains, comma separated",
    how: "Add the TXT record Postmaster gives you to each sending domain.",
    waits: null,
  },
};

/**
 * What moves on a wire: the thing an event is about. An output feeds only an input of its kind
 * (designs/2026-10-05-workflows.md).
 */
export const EVENT_KINDS = {
  firm: "a firm",
  person: "a person at a firm",
  lead: "a person whose address takes mail",
  reply: "a lead's answer, on any channel",
  call: "a booked call",
  form: "a filled form",
  post: "a post",
  video: "a demo video",
  client: "a signed client",
  invoice: "an invoice",
  mail: "an email in an inbox Wren reads",
  comment: "a comment on our post, or under our comment",
  item: "a new item in a feed Wren follows",
  account: "an account an owner has: a number, a domain, an inbox, a login",
} as const;
export type EventKind = keyof typeof EVENT_KINDS;

/** Where a part sits in the business: the shop's first filter. */
export const STAGES = {
  find: "Find leads",
  reach: "Reach out",
  follow: "Follow up",
  book: "Book",
  deliver: "Deliver",
  content: "Content",
  run: "Run Wren",
} as const;
export type Stage = keyof typeof STAGES;

/** How a part reaches people. */
export const CHANNELS = {
  email: "Email",
  text: "Texts",
  voice: "Calls",
  dm: "DMs",
  ads: "Ads",
  social: "Social",
  web: "Web",
} as const;
export type Channel = keyof typeof CHANNELS;

/** One input or output of a part. */
export interface Port {
  /** Unique among the part's inputs, or among its outputs: "booked". */
  id: string;
  /** What moves on it, as its count reads: "booked calls". */
  label: string;
  kind: EventKind;
  /** Where its number comes from while no event log carries it: a record type's saved view. */
  count?: { record: string; view: string };
}

/**
 * One line of a hypothesis. `change`: we expect the next use to differ here. `needs`: config or
 * a requirement the next use brings. `fixed`: stays the same for every use.
 */
export type Guess =
  | {
      is: "change" | "needs";
      says: string;
      /**
       * Where the code has it, or null: not built yet. `settings.<key>`, `niche.<field>`,
       * `in.<port>`, `out.<port>`, `inside`, or another part's id are checked; prose isn't.
       */
      built: string | null;
      checked?: readonly Check[];
    }
  | { is: "fixed"; says: string; checked?: readonly Check[] };

/** A later use's verdict on one guess. */
export interface Check {
  use: string;
  held: boolean;
  why: string;
}

/** Written after a part's first use: how we expect it to generalize. Later uses check it. */
export interface Hypothesis {
  /** The first use it reasons from. */
  from: string;
  guesses: readonly Guess[];
}

/** One loop object a client's component runs: `service`, keyed by `key`. */
export interface LoopKey {
  service: string;
  key: string;
}

export interface Component {
  /** The key in `clients.products`; `product.feature` for new ones. */
  id: string;
  name: string;
  /** One sentence: what it does for whoever has it. */
  blurb: string;
  /** An `@wren/ui` icon name; core can't name the type. */
  icon: string;
  /** "client": installable per client; "wren": runs Wren's own business. */
  for: "client" | "wren";
  stage: Stage;
  channels: Channel[];
  /** False: runs for Wren, not yet per client; `missing` says what stands between. */
  ready: boolean;
  missing: string[];
  /**
   * Not built yet: its ports and the knobs its hypothesis names are the design, so workflows wire
   * it now and keep working once it's built. Never ready.
   */
  planned: boolean;
  /** Parses its block in `clients.products`; `{}` is valid. */
  settings: z.ZodType;
  /**
   * Wren's own run reads its block from `wren_settings`, so a save with no client lands there.
   * Always true for a part for Wren; a client part sets it while it runs only for Wren.
   */
  wrenSettings: boolean;
  /**
   * Its own editor in the portal ("/marketing/facts"), or null: the Shop links there, and Loops →
   * Settings leaves it out, so its changes keep one history.
   */
  editor: string | null;
  /** Top-level settings that hold prices: kept, never shown on a page. */
  priced: string[];
  /** Top-level settings only Wren's own block reads: never on a client's form. */
  wrenOnly: string[];
  /** Top-level settings only a client's block reads: never on Wren's own form. */
  clientOnly: string[];
  /**
   * Components and accounts it needs, each; accounts it needs one of (a channel to post on); and
   * facts a setup leaves on an account (`search_console.service_account_added`).
   */
  requires: {
    components: string[];
    accounts: AccountSite[];
    anyAccount: AccountSite[];
    facts: string[];
  };
  provides: {
    services: string[];
    loops: string[];
    records: string[];
    apps: string[];
    /**
     * The default templates it reads (`<kind>:<system>/<name>`, or a prefix ending in `/`):
     * installing it puts them in the client's database, following the default.
     */
    templates: string[];
  };
  effects: Effect[];
  /**
   * Its sends for a client (posts, comments, DMs, invites) wait on that client's live flag
   * (`clients.sends`, `sendsOn`) as well as the global gate. Off by default; an admin turns it on.
   */
  liveSwitch: boolean;
  /** Accounts it will take once their run is built: the part page says "In development". */
  soon: AccountSite[];
  /** Planned parts it will run as steps once they're built (calls): also "In development". */
  later: string[];
  /** What it takes in and hands on; a workflow wires these. */
  in: Port[];
  out: Port[];
  /** The workflow of steps inside it, opened on the canvas; null when it is one step. */
  inside: string | null;
  hypothesis: Hypothesis;
  /**
   * The loop keys this client runs with this block (parsed, defaults filled). Install and
   * configure start them; configure and uninstall stop the ones no longer listed.
   */
  clientLoops: (client: string, settings: Record<string, unknown>) => LoopKey[];
  /**
   * The template that installs it, or null: a part that only runs as a template's step
   * installs with that template, never on its own (designs/2026-10-07-template-install.md).
   */
  comesWith: string | null;
}

type Input = Pick<
  Component,
  "id" | "name" | "blurb" | "icon" | "for" | "stage" | "ready" | "hypothesis"
> &
  Partial<Omit<Component, "requires" | "provides">> & {
    requires?: Partial<Component["requires"]>;
    provides?: Partial<Component["provides"]>;
  };

/** No settings yet: an empty block, and nothing else. */
const NONE = z.object({}).strict();

export const defineComponent = (c: Input): Component => ({
  ...c,
  missing: c.missing ?? [],
  planned: c.planned ?? false,
  channels: c.channels ?? [],
  settings: c.settings ?? NONE,
  // A part for Wren has no client to save to, whatever a spread copied.
  wrenSettings: c.for === "wren" || (c.wrenSettings ?? false),
  editor: c.editor ?? null,
  priced: c.priced ?? [],
  wrenOnly: c.wrenOnly ?? [],
  clientOnly: c.clientOnly ?? [],
  requires: { components: [], accounts: [], anyAccount: [], facts: [], ...c.requires },
  provides: { services: [], loops: [], records: [], apps: [], templates: [], ...c.provides },
  effects: c.effects ?? [],
  liveSwitch: c.liveSwitch ?? false,
  soon: c.soon ?? [],
  later: c.later ?? [],
  in: c.in ?? [],
  out: c.out ?? [],
  inside: c.inside ?? null,
  clientLoops: c.clientLoops ?? (() => []),
  comesWith: c.comesWith ?? null,
});
