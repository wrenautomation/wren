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
  /** False: runs for Wren, not yet per client; `missing` says what stands between. */
  ready: boolean;
  missing: string[];
  /** Parses its block in `clients.products`; `{}` is valid. */
  settings: z.ZodType;
  /** Top-level settings that hold prices: kept, never shown on a page. */
  priced: string[];
  requires: { components: string[]; accounts: AccountSite[] };
  provides: { services: string[]; loops: string[]; records: string[]; apps: string[] };
  effects: Effect[];
  /**
   * The loop keys this client runs with this block (parsed, defaults filled). Install and
   * configure start them; configure and uninstall stop the ones no longer listed.
   */
  clientLoops: (client: string, settings: Record<string, unknown>) => LoopKey[];
}

type Input = Pick<Component, "id" | "name" | "blurb" | "icon" | "for" | "ready"> &
  Partial<Omit<Component, "requires" | "provides">> & {
    requires?: Partial<Component["requires"]>;
    provides?: Partial<Component["provides"]>;
  };

/** No settings yet: an empty block, and nothing else. */
const NONE = z.object({}).strict();

export const defineComponent = (c: Input): Component => ({
  ...c,
  missing: c.missing ?? [],
  settings: c.settings ?? NONE,
  priced: c.priced ?? [],
  requires: { components: [], accounts: [], ...c.requires },
  provides: { services: [], loops: [], records: [], apps: [], ...c.provides },
  effects: c.effects ?? [],
  clientLoops: c.clientLoops ?? (() => []),
});
