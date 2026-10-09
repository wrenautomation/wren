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
  { id: "overview", label: "Home", Page: HomePage, wide: true },
  // Your daily digest: the last 24 hours, best first, and your alert picks.
  { id: "today", label: "Today", Page: TodayPage, wide: true },
  { id: "search", label: "Search", Page: SearchPage, wide: true },
  { id: "sources", label: "Sources", group: "Setup", Page: SourcesPage, wide: true },
];
const hidden: Module["pages"] = [
  { id: "items", label: "Items", hidden: true, Page: ItemsPage, wide: true },
  { id: "saved", label: "Saved", hidden: true, Page: SavedPage },
  { id: "add", label: "Save a link", hidden: true, Page: AddPage },
];

export const learn: Module = {
  id: "learn",
  name: "Learn",
  icon: "note",
  blurb:
    "Saved links and followed sources, read, scored against Wren's SOPs, and kept like a drive.",
  requires: TEAM,
  action: { page: "add", label: "Save a link", icon: "pin" },
  nav: learnNav,
  find,
  pages: [
    ...pages,
    {
      id: "sops",
      label: "SOPs",
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
  icon: "note",
  blurb: "Links you save and sources you follow, read, scored and kept like a drive.",
  requires: { audience: "client", needs: "read", at: { app: "learn" } },
  action: { page: "add", label: "Save a link", icon: "pin" },
  nav: learnNav,
  find,
  pages: [...pages, ...hidden],
};
