import type { Meta, StoryObj } from "@storybook/react-vite";
import { type ReactNode, useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { DISPLAY, type Display, type Sidebar } from "./display.js";
import { Empty as EmptyLine, Loading as Ghosts } from "./feedback.js";
import {
  SHELL,
  SHELL_CLIENT,
  SHELL_DEMO,
  SHELL_HOME,
  SHELL_LOADING,
  SHELL_WORST,
} from "./fixtures/shell.js";
import { WORST } from "./fixtures/worst.js";
import { PageHeader } from "./layout.js";
import { AppShell } from "./shell.js";

export default {
  title: "Templates/Shell",
  id: "shell",
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta;

type Story = StoryObj;

/** A short page for the shell to frame: its head, as every page opens. */
const Page = ({ title }: { title: string }) => (
  <PageHeader title={title} lede="The page runs here, inside the window." />
);

/** The shell with its own frame state, so [ and \ change it as on the portal. */
function Framed({ sidebar, children }: { sidebar: Sidebar; children: ReactNode }) {
  const [display, setDisplay] = useState<Display>({ ...DISPLAY, sidebar });
  const set = (patch: Partial<Display> | null) =>
    setDisplay((d) => (patch ? { ...d, ...patch } : DISPLAY));
  return (
    <AppShell {...SHELL} display={{ display, set }}>
      {children}
    </AppShell>
  );
}

/** Wren's sidebar: the Map, Inbox, People, Money, Admin, then pins; the open app's pages down the window's edge. On a phone, the app bar and tabs. */
export const Default: Story = {
  render: () => (
    <AppShell {...SHELL}>
      <Page title="Waiting" />
    </AppShell>
  ),
};

/** No state of its own: a frame with no areas (the demo's) and a page with nothing in it. */
export const Empty: Story = {
  render: () => (
    <AppShell {...SHELL_DEMO}>
      <EmptyLine>No leads are waiting.</EmptyLine>
    </AppShell>
  ),
};

/** The workspace name is still loading (a ghost in its place), and so is the page. */
export const Loading: Story = {
  render: () => (
    <AppShell {...SHELL_LOADING}>
      <Ghosts lines={8} heading />
    </AppShell>
  ),
};

/** Long, non-Latin and emoji names, huge counts, a dozen pins and a long workspace name. */
export const WorstCase: Story = {
  render: () => (
    <AppShell {...SHELL_WORST}>
      <Page title={WORST.longName} />
    </AppShell>
  ),
};

/** Home, no app open: the sidebar lists the apps; a phone shows the page, and its Apps tab lists them. */
export const Home: Story = {
  render: () => (
    <AppShell {...SHELL_HOME}>
      <Page title="Today" />
    </AppShell>
  ),
};

/** A client: the items its workspace has (no Inbox or Money app), Today at home, and its pin. */
export const Client: Story = {
  render: () => (
    <AppShell {...SHELL_CLIENT}>
      <Page title="Today" />
    </AppShell>
  ),
};

/** The agent is changing data in two apps: a mark breathes on each row, before its count. */
export const AgentAtWork: Story = {
  render: () => (
    <AppShell
      {...SHELL}
      areas={SHELL.areas?.map((a) => ({
        ...a,
        apps: a.apps.map((x) => (x.id === "money" || x.id === "leads" ? { ...x, agent: true } : x)),
      }))}
    >
      <Page title="Waiting" />
    </AppShell>
  ),
};

/** Folded to icons ([): the marks alone; the app's pages stay at the sidebar's edge. */
export const Folded: Story = {
  render: () => (
    <Framed sidebar="icons">
      <Page title="Waiting" />
    </Framed>
  ),
};

/** Top bar (\): no sidebar; the bar on top holds Apps, the app's pages as tabs (a group a menu) and his buttons. A phone keeps its tabs. \ again brings the sidebar back. */
export const TopBar: Story = {
  render: () => (
    <Framed sidebar="top">
      <Page title="Waiting" />
    </Framed>
  ),
  play: async ({ canvasElement }) => {
    const frame = canvasElement.querySelector("[data-side]");
    await expect(frame).toHaveAttribute("data-side", "top");
    if (innerWidth <= 900) return;
    const view = within(canvasElement);
    await expect(view.queryByRole("navigation", { name: "Apps" })).toBeNull();
    await expect(view.getByRole("button", { name: "Apps" })).toBeVisible();
    await expect(view.getByRole("navigation", { name: /pages$/ })).toBeVisible();
    // The change runs inside a view transition: it lands a frame later.
    await userEvent.keyboard("\\");
    await waitFor(() => expect(frame).toHaveAttribute("data-side", "full"));
    await userEvent.keyboard("\\");
    await waitFor(() => expect(frame).toHaveAttribute("data-side", "top"));
  },
};
