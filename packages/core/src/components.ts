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
export const ACCOUNT_SITES = ["gmail", "linkedin", "calcom", "telnyx", "meta"] as const;
export type AccountSite = (typeof ACCOUNT_SITES)[number];

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
  /** Top-level settings that hold prices: kept, never shown on a page. */
  priced: string[];
  requires: { components: string[]; accounts: AccountSite[] };
  provides: { services: string[]; loops: string[]; records: string[]; apps: string[] };
  effects: Effect[];
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
  priced: c.priced ?? [],
  requires: { components: [], accounts: [], ...c.requires },
  provides: { services: [], loops: [], records: [], apps: [], ...c.provides },
  effects: c.effects ?? [],
  in: c.in ?? [],
  out: c.out ?? [],
  inside: c.inside ?? null,
  clientLoops: c.clientLoops ?? (() => []),
});
