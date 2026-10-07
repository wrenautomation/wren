/**
 * Learn (designs/2026-10-07-learn.md): what William saves from his phone or the portal and what
 * the sources he follows publish, read, scored against Wren's SOPs, searchable, and turned into
 * SOP sources. Wren's own; its alerts go out on the main notifier, never into the Inbox.
 */
import type { Action } from "@wren/ui";
import { createElement } from "react";
import type { Module } from "../../module.js";
import { AddPage, itemExtras, SaveBox, SearchPage } from "./learn.js";

const TEAM = { audience: "team" } as const;
const said = (line: string) => () => line;

const TELL_LABELS = { every: "Every item", top: "Score 8+", digest: "Digest only" };

const ITEM_ACTIONS: Action[] = [
  {
    id: "learn.itemDone",
    label: "Done",
    handler: "learn/itemDone",
    undo: "learn/itemUndone",
    bulk: true,
    key: "e",
    when: { state: ["show", "hold", "drop", "mac", "failed", "reading", "scoring"] },
    done: said("Done"),
  },
  {
    id: "learn.toSop",
    label: "Add to SOP",
    handler: "learn/toSop",
    bulk: true,
    each: true,
    form: [
      {
        field: "sop",
        label: "SOP",
        hint: "Its folder name, such as email-infra. The Mac writes it in on its next read.",
        pattern: "[a-z0-9][a-z0-9-]*",
      },
    ],
    done: said("Asked. The Mac adds it on its next read."),
  },
  {
    id: "learn.readAgain",
    label: "Read again",
    handler: "learn/readAgain",
    bulk: true,
    when: { state: ["failed"] },
    done: said("Reading again"),
  },
];

const SOURCE_ACTIONS: Action[] = [
  {
    id: "learn.follow",
    label: "Follow",
    handler: "learn/follow",
    form: [
      {
        field: "url",
        label: "Address",
        type: "url",
        hint: "A YouTube channel, a Substack, a blog or a podcast. Its page works; so does its feed.",
      },
      { field: "name", label: "Name", optional: true, hint: "Blank takes the feed's own title." },
      {
        field: "tell",
        label: "Tell me",
        type: "select",
        options: ["top", "every", "digest"],
        labels: TELL_LABELS,
      },
    ],
    done: said("Following. Its next posts are read and scored."),
  },
  {
    id: "learn.tell",
    label: "Tell me",
    handler: "learn/tell",
    bulk: true,
    each: true,
    form: [
      {
        field: "tell",
        label: "Tell me",
        type: "select",
        options: ["top", "every", "digest"],
        labels: TELL_LABELS,
      },
    ],
    done: said("Saved"),
  },
  {
    id: "learn.unfollow",
    label: "Stop following",
    handler: "learn/unfollow",
    bulk: true,
    when: { state: ["following", "failing"] },
    confirm: "Stop reading this source? Its items stay.",
    done: said("Stopped"),
  },
];

const ITEM_COLUMNS = ["title", "kind", "source", "score", "state", "at"];

export const learn: Module = {
  id: "learn",
  name: "Learn",
  component: "learn.save",
  icon: "note",
  blurb: "Saved links and followed sources, read, scored against Wren's SOPs, and searchable.",
  requires: TEAM,
  action: { page: "saved", label: "Save a link", icon: "pin" },
  pages: [
    {
      id: "overview",
      label: "Overview",
      template: "overview",
      tiles: [
        {
          label: "Worth reading",
          record: "learn.item",
          href: "/learn/items?view=show",
          needs: true,
        },
        { label: "Saved", record: "learn.saved", href: "/learn/saved?view=all", period: 30 },
        { label: "Waiting", record: "learn.item", href: "/learn/items?view=waiting" },
        { label: "Sources", record: "learn.source", href: "/learn/sources?view=all" },
      ],
      top: [
        {
          label: "Worth reading",
          record: "learn.item",
          href: "/learn/items?view=show",
          fields: ["score", "source"],
          empty: "Nothing new worth reading.",
        },
        {
          label: "Saved lately",
          record: "learn.saved",
          href: "/learn/saved?view=all",
          fields: ["kind", "savedAt"],
          empty: "Links you save show here.",
        },
      ],
    },
    {
      id: "items",
      label: "Items",
      template: "list",
      record: "learn.item",
      empty: {
        show: "Items that should change how Wren works show here, scored against the SOPs.",
        hold: "Items worth knowing, with no SOP to change, show here.",
        waiting: "Every item is read and scored.",
        done: "Items you mark done show here.",
        all: "Everything saved or followed shows here.",
      },
      columns: ITEM_COLUMNS,
      actions: ITEM_ACTIONS,
      extras: itemExtras,
      count: { state: ["show"] },
    },
    {
      id: "saved",
      label: "Saved",
      template: "list",
      record: "learn.saved",
      empty: {
        all: "Links you save show here, newest first. Share one from your phone or paste it above.",
        waiting: "Every saved link is read.",
      },
      columns: ["title", "kind", "score", "state", "savedVia", "savedAt"],
      actions: ITEM_ACTIONS,
      extras: itemExtras,
      head: (_meta, reload) => createElement(SaveBox, { reload }),
    },
    {
      id: "sources",
      label: "Sources",
      template: "list",
      record: "learn.source",
      empty: {
        all: "Follow a YouTube channel, a Substack, a blog or a podcast. Instagram, TikTok and X creators are in development.",
        failing: "Every source reads.",
        stopped: "You follow every source you added.",
      },
      columns: ["name", "kind", "tell", "state", "items", "shown", "fetchedAt"],
      actions: SOURCE_ACTIONS,
    },
    { id: "search", label: "Search", Page: SearchPage },
    {
      id: "sops",
      label: "SOPs",
      template: "list",
      record: "learn.sop",
      empty: "SOPs show here once one is pushed or an item is added to one.",
    },
    { id: "add", label: "Save a link", hidden: true, Page: AddPage },
  ],
};
