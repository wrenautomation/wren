import type { Meta, StoryObj } from "@storybook/react-vite";
import { Empty as EmptyLine, Loading as Ghosts, LoadFailed } from "./feedback.js";
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
  title: "Shell",
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta;

type Story = StoryObj;

/** A short page for the shell to frame: its head, as every page opens. */
const Page = ({ title }: { title: string }) => (
  <PageHeader title={title} lede="The page runs here, inside the window." />
);

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

/** No error state of its own: the page inside it failed to read. */
export const Failed: Story = {
  render: () => (
    <AppShell {...SHELL}>
      <LoadFailed
        error={Object.assign(new Error("The server could not answer."), { status: 500 })}
      />
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
