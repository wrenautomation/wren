/**
 * Learn (designs/2026-10-07-learn.md): what a workspace saves from a phone or the portal and what
 * the sources it follows publish, read, scored against its SOPs, and kept like a drive: a home of
 * shelves, items as cards, a list or a compact list, collections that nest, tags, a Watch later
 * queue, and each item played or read in place. One address, two apps, as Notes: Wren's team's
 * (its alerts go out on the main notifier, never into the Inbox) and a client's people's.
 */
import { createElement, useEffect } from "react";
import type { Module, PageProps } from "../../module.js";
import { navigate, useRoute } from "../../route.js";
import { unseenCount } from "./api.js";
import { ItemsPage } from "./drive.js";
import { HomePage } from "./home.js";
import { AddPage, SearchPage } from "./learn.js";
import { SourcesPage } from "./sources.js";
import { TodayPage } from "./today.js";

const TEAM = { audience: "team" } as const;

/** The old Saved list and its item pages: now a place in Items. */
function SavedPage(_: PageProps) {
  const id = useRoute().path[2];
  useEffect(
    () => navigate(id ? `/learn/items/${id}?in=saved` : "/learn/items?in=saved", true),
    [id],
  );
  return createElement("div");
}

const pages: Module["pages"] = [
  { id: "overview", label: "Home", Page: HomePage, wide: true },
  // Your daily digest: the last 24 hours, best first, and your alert picks.
  { id: "today", label: "Today", Page: TodayPage, wide: true },
  // What the sources brought since you last looked at Items.
  { id: "items", label: "Items", Page: ItemsPage, wide: true, badge: unseenCount },
  { id: "sources", label: "Sources", Page: SourcesPage, wide: true },
  { id: "search", label: "Search", Page: SearchPage, wide: true },
];
const hidden: Module["pages"] = [
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
  pages: [
    ...pages,
    {
      id: "sops",
      label: "SOPs",
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
  pages: [...pages, ...hidden],
};
