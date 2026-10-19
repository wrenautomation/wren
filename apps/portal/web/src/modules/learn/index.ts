/**
 * Learn (designs/2026-10-07-learn.md): what a workspace saves from a phone or the portal and what
 * the sources it follows publish, read, scored against its SOPs, and kept like a drive: a home of
 * shelves, items as cards, a list or a compact list, collections that nest, tags, a Watch later
 * queue, and each item played or read in place. One address, two apps, as Notes: Wren's team's
 * (its alerts go out on the main notifier, never into the Inbox) and a client's people's.
 */
import { createElement, useEffect } from "react";
import { call } from "../../api.js";
import { type Found, type Module, type PageProps, WREN } from "../../module.js";
import { navigate, useRoute } from "../../route.js";
import { ItemsPage } from "./drive.js";
import { learnNav } from "./frame.js";
import { HomePage } from "./home.js";
import { AddPage, KINDS, SearchPage } from "./learn.js";
import { SourcesPage } from "./sources.js";
import { TodayPage } from "./today.js";

const TEAM = { audience: "team" } as const;

/** ⌘K: items whose title or words match, in Wren's Learn or the client's on screen. */
const find = async (q: string, client: string): Promise<Found[]> => {
  const { items } = await call<{
    items: Array<{ id: number; title: string; kind: string; source: string }>;
  }>("learn/find", client === WREN.id ? { q } : { client, q });
  return items.map((i) => ({
    label: i.title,
    href: `/learn/items/${i.id}`,
    hint: `${KINDS[i.kind] ?? i.kind} · ${i.source}`,
  }));
};

/** The old Saved list and its item pages: now a place in Items. */
function SavedPage(_: PageProps) {
  const id = useRoute().path[2];
  useEffect(
    () => navigate(id ? `/learn/items/${id}?in=saved` : "/learn/items?in=saved", true),
    [id],
  );
  return createElement("div");
}

// Items' places, collections and tags are tabs from its data, after Search (./frame.tsx).
const pages: Module["pages"] = [
  {
    id: "overview",
    label: "Home",
    about: "The best of what you follow, scored against your SOPs.",
    Page: HomePage,
    wide: true,
  },
  // Your daily digest: the last 24 hours, best first, and your alert picks.
  {
    id: "today",
    label: "Today",
    about: "The last day's best from what you follow.",
    Page: TodayPage,
    wide: true,
  },
  {
    id: "search",
    label: "Search",
    about: "Search every transcript, word for word.",
    Page: SearchPage,
    wide: true,
  },
  {
    id: "sources",
    label: "Sources",
    about: "The creators and feeds you follow.",
    group: "Setup",
    Page: SourcesPage,
    wide: true,
  },
];
const hidden: Module["pages"] = [
  {
    id: "items",
    label: "Items",
    about: "One saved item, with its transcript and notes.",
    hidden: true,
    Page: ItemsPage,
    wide: true,
  },
  {
    id: "saved",
    label: "Saved",
    about: "Everything you saved to come back to.",
    hidden: true,
    Page: SavedPage,
  },
  {
    id: "add",
    label: "Save a link",
    about: "Save a link to read and learn from.",
    hidden: true,
    Page: AddPage,
  },
];

export const learn: Module = {
  id: "learn",
  name: "Learn",
  icon: "book",
  blurb:
    "Saved links and followed sources, read, scored against Wren's SOPs, and kept like a drive.",
  requires: TEAM,
  parked: true,
  action: { page: "add", label: "Save a link", icon: "pin" },
  nav: learnNav,
  find,
  pages: [
    ...pages,
    // How competitors' reels are made (designs/2026-10-11-competitor-breakdowns.md).
    {
      id: "competitors",
      label: "Competitors",
      about: "How competitors' reels are made, and how far they reach.",
      group: "Competitors",
      template: "overview",
      tiles: [
        { label: "Broken down", record: "learn.breakdown", href: "/learn/reels?view=all" },
        { label: "Followed", record: "learn.breakdown", href: "/learn/reels?view=followed" },
        { label: "New", record: "learn.breakdown", href: "/learn/reels?view=new", period: 7 },
        {
          label: "Median reach",
          record: "learn.breakdown",
          href: "/learn/reels?view=new",
          period: 30,
          median: "reach",
        },
        {
          label: "Comment a word",
          record: "learn.breakdown",
          href: "/learn/reels?view=comment-word",
        },
      ],
      top: [
        {
          label: "Hooks that reach",
          record: "learn.hook",
          href: "/learn/hooks",
          fields: ["reels", "medianReach"],
          line: "top",
          units: { reels: "reels", medianReach: "median reach" },
          empty: "No reels broken down yet.",
        },
        {
          label: "Best reach",
          record: "learn.breakdown",
          href: "/learn/reels",
          fields: ["creator", "hookStyle", "reach"],
          line: "hook",
          empty: "No reels broken down yet.",
        },
      ],
    },
    {
      id: "reels",
      label: "Reels",
      about: "Each reel broken down into its hook, beats and ask.",
      group: "Competitors",
      template: "list",
      record: "learn.breakdown",
      empty:
        "Each reel or video a followed creator posts shows here once read: its hook, beats and ask.",
    },
    {
      id: "hooks",
      label: "Hooks",
      about: "Hook styles, ranked by how far they reach.",
      group: "Competitors",
      template: "list",
      record: "learn.hook",
      empty: "Hook styles rank here once reels are broken down.",
    },
    {
      id: "sops",
      label: "SOPs",
      about: "Your SOPs, and the items added to each one.",
      group: "Setup",
      template: "list",
      record: "learn.sop",
      empty: "SOPs show here once one is pushed or an item is added to one.",
    },
    ...hidden,
  ],
};

/** A client's own Learn: its sources and items, scored against its SOPs, which live in its Notes. */
export const clientLearn: Module = {
  id: "learn",
  name: "Learn",
  icon: "book",
  blurb: "Links you save and sources you follow, read, scored and kept like a drive.",
  requires: { audience: "client", needs: "read", at: { app: "learn" } },
  action: { page: "add", label: "Save a link", icon: "pin" },
  nav: learnNav,
  find,
  pages: [...pages, ...hidden],
};
