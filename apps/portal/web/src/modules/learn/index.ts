/**
 * Learn (designs/2026-10-07-learn.md): what William saves from his phone or the portal and what
 * the sources he follows publish, read, scored against Wren's SOPs, and kept like a drive: a
 * home of shelves, items as cards, a list or a compact list, collections that nest, tags, a
 * Watch later queue, and each item played or read in place. Wren's own; its alerts go out on the
 * main notifier, never into the Inbox.
 */
import { createElement, useEffect } from "react";
import type { Module, PageProps } from "../../module.js";
import { navigate, useRoute } from "../../route.js";
import { unseenCount } from "./api.js";
import { ItemsPage } from "./drive.js";
import { HomePage } from "./home.js";
import { AddPage, SearchPage } from "./learn.js";
import { SourcesPage } from "./sources.js";

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

export const learn: Module = {
  id: "learn",
  name: "Learn",
  component: "learn.save",
  icon: "note",
  blurb:
    "Saved links and followed sources, read, scored against Wren's SOPs, and kept like a drive.",
  requires: TEAM,
  action: { page: "add", label: "Save a link", icon: "pin" },
  pages: [
    { id: "overview", label: "Home", Page: HomePage, wide: true },
    // What his sources brought since he last looked at Items.
    { id: "items", label: "Items", Page: ItemsPage, wide: true, badge: unseenCount },
    { id: "sources", label: "Sources", Page: SourcesPage, wide: true },
    { id: "search", label: "Search", Page: SearchPage, wide: true },
    {
      id: "sops",
      label: "SOPs",
      template: "list",
      record: "learn.sop",
      empty: "SOPs show here once one is pushed or an item is added to one.",
    },
    { id: "saved", label: "Saved", hidden: true, Page: SavedPage },
    { id: "add", label: "Save a link", hidden: true, Page: AddPage },
  ],
};
