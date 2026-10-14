/**
 * How a phone walks the portal, as the big apps do: Home and Apps hold the bar's ends, the three
 * tabs between are the section's own pages, each tab keeps the stack of pages walked from it, and the bar at the top goes back
 * one step, named for where it goes. Pure, so it's tested without a page.
 */
import type { IconName } from "./icons.js";

/** A page as a tab: the little the phone's bar needs from the shell's NavItem. */
export interface TabPage {
  id: string;
  label: string;
  href: string;
  count?: number | undefined;
  group?: string | undefined;
}

/** One of the bottom tabs. */
export interface BarTab {
  id: string;
  label: string;
  icon: IconName;
  href: string;
  count?: number | undefined;
  /** The pages it holds: one page, a group's pages, or More's leftovers. */
  holds: string[];
}

/** Tabs in runs of one group; a tab with none is a run of its own. */
export function runs<T extends TabPage>(
  tabs: readonly T[],
): { group: string | undefined; tabs: T[] }[] {
  const out: { group: string | undefined; tabs: T[] }[] = [];
  for (const t of tabs) {
    const last = out.at(-1);
    if (t.group && last?.group === t.group) last.tabs.push(t);
    else out.push({ group: t.group, tabs: [t] });
  }
  return out;
}

/** A run that shows its group as a heading: a group of more than one page. */
export const headed = (r: { group: string | undefined; tabs: TabPage[] } | undefined) =>
  !!r?.group && r.tabs.length > 1;

export const total = (tabs: readonly TabPage[]) =>
  tabs.some((t) => t.count !== undefined)
    ? tabs.reduce((n, t) => n + (t.count ?? 0), 0)
    : undefined;

/** iOS fits five: Home first and Apps last never move; these three in between are the section's. */
export const BAR_SIZE = 3;
export const HOME = "home";

/**
 * A section's bottom tabs: its picks (else one per run of its pages), three at most. The pages
 * they leave over open from Apps, under the section's name.
 */
export function barOf(
  pages: readonly TabPage[],
  picks: readonly BarTab[] | undefined,
  iconOf: (p: TabPage) => IconName = () => "page",
): { tabs: BarTab[]; more: TabPage[] } {
  const ids = new Set(pages.map((p) => p.id));
  const tabs: BarTab[] = (
    picks?.length
      ? picks
      : runs(pages).map((r) => {
          const first = r.tabs[0] as TabPage;
          return {
            id: first.id,
            label: (headed(r) ? r.group : first.label) ?? first.label,
            icon: iconOf(first),
            href: first.href,
            count: total(r.tabs),
            holds: r.tabs.map((t) => t.id),
          };
        })
  )
    .map((t) => ({ ...t, holds: (t.holds.length ? t.holds : [t.id]).filter((id) => ids.has(id)) }))
    .filter((t) => t.holds.length)
    .slice(0, BAR_SIZE);
  const held = new Set(tabs.flatMap((t) => t.holds));
  return { tabs, more: pages.filter((p) => !held.has(p.id)) };
}

/** The tab a page sits under: the one that holds it, else the one he came from. */
export function tabOfPage(
  tabs: readonly BarTab[],
  page: string,
  last: string | undefined,
): string | undefined {
  return (
    tabs.find((t) => t.holds.includes(page))?.id ??
    (last && tabs.some((t) => t.id === last) ? last : undefined)
  );
}

/** A step in a tab's stack: where, and the title it had, for the back button's name. */
export interface Step {
  url: string;
  title: string;
}

/** The path of a url, so a filter or a search on the same page doesn't stack. */
export const pathOfUrl = (url: string) => url.split(/[?#]/)[0] ?? url;

/**
 * A tab's stack after a move to `url` within it: a page already in it pops back to it, the same
 * page with a new search takes the top's place, anything else goes on top.
 */
export function stepTo(stack: readonly Step[], url: string, title = ""): Step[] {
  const path = pathOfUrl(url);
  const at = stack.findIndex((s) => pathOfUrl(s.url) === path);
  if (at >= 0) return [...stack.slice(0, at), { url, title: stack[at]?.title || title }];
  return [...stack, { url, title }];
}

/** Where back goes from the top of a stack: the step under it, else where the tab came in from. */
export function backOf(stack: readonly Step[], cameFrom: Step | undefined): Step | undefined {
  return stack.length > 1 ? stack[stack.length - 2] : cameFrom;
}

/** What a tap on a tab does: open it where he left it, pop it to its first page, or scroll up. */
export function tapOf(
  on: boolean,
  stack: readonly Step[] | undefined,
  root: string,
  here: string,
): { go: string } | "top" {
  if (!on) return { go: stack?.at(-1)?.url ?? root };
  const first = stack?.[0]?.url ?? root;
  return pathOfUrl(here) === pathOfUrl(first) ? "top" : { go: first };
}

/** How far ahead a throw carries, in ms of its speed: a flick lands one stop on. */
const THROW = 200;

/** Where a released sheet or row settles: the stop nearest where its throw would carry it. */
export function settle(y: number, velocity: number, stops: readonly number[]): number {
  const to = y + velocity * THROW;
  let best = stops[0] ?? 0;
  for (const s of stops) if (Math.abs(s - to) < Math.abs(best - to)) best = s;
  return best;
}

/** Dragged past where it can go, it gives less the further it goes, as a rubber band does. */
export const rubber = (over: number, room = 80) => (over * room) / (over + room);

/** Where a let-go row goes: shut, open on its buttons, or past the line that runs the far one. */
export function swipeEnd(
  x: number,
  velocity: number,
  width: number,
  shown: number,
): "shut" | "open" | "full" {
  const far = Math.abs(x);
  const thrown = Math.abs(velocity) > 0.9 && Math.sign(velocity) === Math.sign(x);
  if (far > width * 0.55 || (thrown && far > shown)) return "full";
  if (far > shown * 0.45 || (thrown && far > 24)) return "open";
  return "shut";
}
