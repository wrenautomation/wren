/**
 * An app list for the shell's stories: a workspace, areas with apps, the open app with its pages,
 * a phone's dock and the pins. Links stay in the page (`#...`), so nothing leaves the story.
 * Synthetic data only.
 */
import type { ComponentProps } from "react";
import type { PinLine } from "../customize.js";
import type { AppShell, DockItem, NavApp, NavArea, NavItem, OpenApp } from "../shell.js";
import { WORST } from "./worst.js";

/** The stamp: a plain square, so no file is read. */
const STAMP =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 26 26'%3E%3Crect width='26' height='26' rx='6' fill='%23554b8a'/%3E%3C/svg%3E";

/** What `AppShell` takes, less the page it frames. */
export type ShellProps = Omit<ComponentProps<typeof AppShell>, "children">;

const page = (id: string, label: string, group?: string, count?: number): NavItem => ({
  id,
  label,
  href: `#/leads/${id}`,
  group,
  count,
});

/** The open app's pages: two groups, a count on the one that waits. */
const PAGES: NavItem[] = [
  page("overview", "Overview"),
  page("waiting", "Waiting", "Pipeline", 6),
  page("approved", "Approved", "Pipeline"),
  page("all", "All leads", "Pipeline"),
  page("fields", "Fields", "Setup"),
  page("rules", "Rules", "Setup"),
];

const app = (id: string, name: string, icon: NavApp["icon"], count?: number): NavApp => ({
  id,
  name,
  icon,
  href: `#/${id}`,
  count,
});

/** Three areas; Setup is shut, and holds an app not installed for this client (dimmed). */
const AREAS: NavArea[] = [
  { id: "work", label: "Work", apps: [app("inbox", "Inbox", "inbox", 3)] },
  {
    id: "sell",
    label: "Sell",
    apps: [
      { ...app("leads", "Leads", "people", 6), pages: PAGES },
      app("marketing", "Marketing", "megaphone"),
      { ...app("reviews", "Reviews", "star"), off: true },
    ],
  },
  { id: "setup", label: "Setup", shut: true, apps: [app("settings", "Settings", "sliders")] },
];

const OPEN: OpenApp = {
  id: "leads",
  name: "Leads",
  icon: "people",
  href: "#/leads",
  tabs: PAGES,
  current: "waiting",
};

/** A phone's bottom tabs in the open app. */
const DOCK: DockItem[] = [
  { id: "today", label: "Today", icon: "home", href: "#/" },
  { id: "waiting", label: "Waiting", icon: "people", href: "#/leads/waiting", count: 6, on: true },
  { id: "approved", label: "Approved", icon: "check", href: "#/leads/approved" },
];

const PINS: PinLine[] = [
  { href: "#/leads/waiting", label: "Waiting leads", icon: "people" },
  { href: "#/inbox", label: "Inbox", icon: "inbox" },
];

const noop = () => {};

/** The shell as a person sees it, a page of the Leads app open. */
export const SHELL: ShellProps = {
  brand: { name: "Example Co", href: "#/", stamp: STAMP },
  workspace: { current: { id: "w1", name: "Northwind Dental" }, label: "Account" },
  launcher: "#/",
  home: { label: "Today", href: "#/", count: 9 },
  areas: AREAS,
  dock: DOCK,
  app: OPEN,
  pins: {
    pins: PINS,
    here: false,
    current: "#/leads/waiting",
    onToggle: noop,
    onMove: noop,
    onRemove: noop,
    onClear: noop,
  },
  page: "/leads/waiting",
  onGo: noop,
};

/** A frame with no sidebar and no pins, as the public demo's: one app, no areas, no home link. */
export const SHELL_DEMO: ShellProps = {
  brand: SHELL.brand,
  workspace: { ...SHELL.workspace, chip: { label: "Sample company", href: "#/real" } },
  app: OPEN,
  page: "/leads/waiting",
};

/** The workspace's name is not in yet: the shell shows a ghost where it goes. */
export const SHELL_LOADING: ShellProps = {
  ...SHELL,
  workspace: { current: null, label: "Account" },
};

/** Home: no app open, so the sidebar lists the apps and a phone gets the apps list. */
export const SHELL_HOME: ShellProps = { ...SHELL, app: null, page: "/" };

const longApp = (id: string, name: string, icon: NavApp["icon"]): NavApp => ({
  ...app(id, name, icon, WORST.hugeCount),
});

/** Long names, huge counts, non-Latin and emoji labels, a dozen pins, a long workspace and chip. */
export const SHELL_WORST: ShellProps = {
  ...SHELL,
  workspace: {
    current: { id: "w2", name: WORST.longCompany },
    chip: { label: WORST.longLabel, href: "#/real" },
    href: "#/account",
    label: "Account",
  },
  home: { label: "Today", href: "#/", count: WORST.hugeCount },
  areas: [
    {
      id: "a",
      label: WORST.longLabel,
      apps: [
        longApp("a1", WORST.longName, "inbox"),
        longApp("a2", WORST.nonLatin, "people"),
        longApp("a3", WORST.emoji, "megaphone"),
        longApp("a4", WORST.rtl, "star"),
        longApp("a5", WORST.shortName, "doc"),
      ],
    },
    ...AREAS.slice(1),
  ],
  app: {
    ...OPEN,
    name: WORST.longName,
    tabs: PAGES.map((p, i) => ({
      ...p,
      label: [
        WORST.longLabel,
        WORST.nonLatin,
        WORST.emoji,
        WORST.rtl,
        WORST.shortName,
        WORST.email,
      ][i] as string,
      count: i % 2 ? WORST.hugeCount : undefined,
    })),
    current: "waiting",
    action: undefined,
  },
  pins: {
    ...(SHELL.pins as NonNullable<ShellProps["pins"]>),
    pins: Array.from({ length: 12 }, (_, i) => ({
      href: `#/pin/${i}`,
      label: i % 2 ? WORST.longLabel : WORST.nonLatin,
      icon: "pin",
    })),
  },
};
