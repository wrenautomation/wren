/** An app in the portal: a row in the sidebar under its area, its pages as tabs at /<app>/<page>. */

import type { Permission, Who } from "@wren/core/access";
import type { RecordMeta } from "@wren/core/records";
import type { Row } from "@wren/core/records/serve";
import type {
  Access,
  Action,
  DaySource,
  IconName,
  NavItem,
  OverviewTile,
  OverviewTop,
  RecordAct,
  RecordExtras,
  ShopSections,
  SwitchWait,
} from "@wren/ui";
import type { ComponentType, ReactNode } from "react";

/** Wren's own workspace: an operator's home, its apps on Wren's records (never a client's). */
export const WREN = { id: "@wren", name: "Wren" } as const;

/**
 * What every page gets: whose list, whether it's the read-only demo, whether Wren's team is
 * looking (and not viewing as the client), and the URL's query.
 */
export interface PageProps {
  client: string;
  demo: boolean;
  team: boolean;
  params: URLSearchParams;
  /** What this login may do in this workspace (`delivery/me`); left out on the demo. */
  can?: readonly Permission[];
  /** Its role and grants here, for checks at an app, a channel or a record (`./access.ts`). */
  who?: Who;
}

interface PageBase {
  /** The second path segment. */
  id: string;
  label: string;
  /** The sidebar heading it sits under. An app's pages of one group stay next to each other. */
  group?: string;
  /** Reached by link only, never a tab. */
  hidden?: true;
  /** Who sees it: `{ audience: "client" }` is a signed-in client's own, never on the demo. */
  requires?: Access;
  /**
   * A filter across its top, kept moving between pages that share it: Content's platforms. The
   * field is the list's own filter in the address; `waits` count what waits in each state.
   */
  across?: PageAcross;
  /** Its tab's number in any workspace: what waits there for whoever looks (Accounts' open alerts). */
  badge?: (client: string, team: boolean) => Promise<number>;
}

export interface PageAcross {
  /** The field and the param: "platform". */
  field: string;
  /** What it's called, read aloud: "Platform". */
  label: string;
  waits: readonly SwitchWait[];
}

/** A page drawn by hand. */
export interface HandPage extends PageBase {
  Page: ComponentType<PageProps>;
  /** Past the reading width, as a list page is: a browser's three columns. */
  wide?: true;
}

/**
 * A page declared as data: a template over a record type. The List opens its records beside
 * it or as their own page at /<app>/<page>/<id>; the Queue works through them one at a time.
 * Everything else comes from the type's meta.
 */
export interface ListPage extends PageBase {
  /** A Form reads the type as one form, a line per record (Setup); a Shop, as cards with facets. */
  template: "list" | "queue" | "form" | "shop";
  /** The record type's id, "<product>.<one>": its product serves it at /api/<product>/records*. */
  record: string;
  /** What fills the list, said while it's empty: one line, or one per view. */
  empty?: string | Record<string, string>;
  /** The demo shows it while the queue is empty: a labeled walk-through of what lands there. */
  example?: ReactNode;
  /** What can be done to its records; the type's meta says which apply, the demo runs them here. */
  actions?: Action[];
  /** The columns shown until the viewer picks others; every one when left out. A Shop's chips. */
  columns?: string[];
  /** A Shop's groups, in order, each under its own heading (Templates, Parts, Workflows). */
  sections?: ShopSections;
  /** Lines and sources a record's detail adds under its fields. */
  extras?: (detail: unknown, at: PageProps & { row: Row; act: RecordAct }) => RecordExtras;
  /** Old params rewritten on arrival, so old links still land: the changes, or null. */
  legacy?: (params: URLSearchParams) => Record<string, string | null> | null;
  /** Beside the list's title, such as a form that adds one; `reload` reads the list again. */
  head?: (meta: RecordMeta, reload: () => void, at: PageProps) => ReactNode;
  /** What waits here, counted on its tab in the nav (Wren's workspace): a `where` on the record. */
  count?: Readonly<Record<string, readonly string[]>>;
}

/** An app's numbers first, each a link to its rows, then its top records. */
export interface OverviewPage extends PageBase {
  template: "overview";
  tiles: OverviewTile[];
  top?: OverviewTop[];
  /** Drawn under the numbers by hand: the project's review, pulse and what's next. */
  below?: ComponentType<PageProps>;
}

/**
 * One day of work across record types, grouped by a field under its cue: Content's Today. Each
 * source names its date field; its rows' main action comes from `actions`.
 */
export interface DayPage extends PageBase {
  template: "day";
  /** Each a record of one product, which serves the page: "marketing.draft". */
  sources: readonly DaySource[];
  /** The field rows are grouped by: "platform". */
  by: string;
  actions?: Action[];
}

export type ModulePage = HandPage | ListPage | OverviewPage | DayPage;

export interface Module {
  /** The first path segment. */
  id: string;
  name: string;
  icon: IconName;
  /** One sentence on its service card (a client's Today): what it does for the client. */
  blurb: string;
  /** Its card's numbers, and what waits on the viewer. */
  Glance?: ComponentType<PageProps>;
  pages: ModulePage[];
  /**
   * Who sees it, and reaches it: `{ audience: "team" }` is Wren's team in team view only;
   * `{ audience: "client" }` a signed-in client's own, never on the demo (products alone).
   */
  requires?: Access;
  /** Reached from the client's name at top left, never the sidebar. */
  menu?: true;
  /**
   * The app for offers with none of their own. A bought offer's card on Today opens the app it
   * names (the offer's `app`), this one for the rest.
   */
  fallback?: true;
  /** The component it belongs to (`@wren/core/components`); none for the platform's own. */
  component?: string;
  /** The one button in its head, a page to go to. */
  action?: { page: string; label: string; icon: IconName };
  /** Tabs read from its data, beside its pages: Learn's places and collections. */
  nav?: ModuleNav;
  /** ⌘K as you type: its records that match, in the workspace on screen, each with its page. */
  find?: (q: string, client: string) => Promise<Found[]>;
}

/** One record ⌘K found: its name, what it is, and where it opens. */
export interface Found {
  label: string;
  href: string;
  /** A second line, faint: its kind and where it came from. */
  hint?: string;
}

/** An app's tabs that come from its data, read again on every move and every `changed`. */
export interface ModuleNav {
  /** They go after this page's tab. */
  after: string;
  load: (client: string, team: boolean) => Promise<NavItem[]>;
  /** Calls `fn` when they may have changed; answers the stop. */
  changed?: (fn: () => void) => () => void;
  /** The tab lit for this address, a page's or one of these; null for the page's own. */
  here: (path: readonly string[], params: URLSearchParams) => string | null;
}
