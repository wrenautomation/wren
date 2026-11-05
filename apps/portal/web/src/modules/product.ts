/**
 * One product the client buys, as one place (designs/2026-11-04-portal-places.md, Product shell).
 * At most 4 tabs, in slot order; any other page is a hidden detail page, reached by link. The slots
 * hold the cap: a product never grows micro sections.
 */
import type { Access, IconName } from "@wren/ui";
import type { Module, ModulePage } from "../module.js";

export interface ProductSpec {
  id: string;
  name: string;
  icon: IconName;
  blurb: string;
  /** Entitlement: a client sees it once installed. */
  component?: string;
  requires?: Access;
  /** Where it stands. */
  overview?: ModulePage;
  /** What waits on the viewer, or where the work is made (Content's Studio). */
  work?: ModulePage;
  /** What it got. */
  results?: ModulePage;
  /** Voice, accounts, limits. */
  settings?: ModulePage;
  /** Detail pages only, never tabs. */
  hidden?: readonly ModulePage[];
  Glance?: NonNullable<Module["Glance"]>;
  find?: NonNullable<Module["find"]>;
}

/** Tabs drop their sidebar group: a product's 4 tabs need none. */
const tab = ({ group: _g, hidden: _h, ...p }: ModulePage): ModulePage => p as ModulePage;

export function product(spec: ProductSpec): Module {
  const { overview, work, results, settings, hidden = [], ...rest } = spec;
  const tabs = [overview, work, results, settings].flatMap((p) => (p ? [tab(p)] : []));
  if (!tabs.length) throw new Error(`product ${spec.id}: no tab`);
  return {
    ...rest,
    pages: [
      ...tabs,
      ...hidden.map(({ group: _g, ...p }) => ({ ...p, hidden: true as const }) as ModulePage),
    ],
  };
}
