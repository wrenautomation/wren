import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { Explorer, type ExplorerProps, type ExplorerRead, type ExplorerView } from "./explorer.js";
import {
  EXPLORER_MARKS,
  EXPLORER_ROOT_PAGE,
  explorerFails,
  explorerPending,
  explorerRead,
} from "./fixtures/index.js";

export default {
  title: "Templates/Explorer",
  id: "explorer",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

type Story = StoryObj;

const SET = "canon/topics/bread-baking/sets/bread-baking-proofing";

/** Explorer with its own route and view, as the portal's `?at=` and `?view=` hold them. */
function Demo({
  make,
  at,
  view: first = "columns",
  folderPage,
}: {
  make: () => ExplorerRead;
  at: string;
  view?: ExplorerView;
  folderPage?: ExplorerProps["folderPage"];
}) {
  const [read] = useState(make);
  const [route, setRoute] = useState(at);
  const [view, setView] = useState<ExplorerView>(first);
  return (
    <div className="p-4 sm:p-6">
      <Explorer
        name="Canon"
        route={route}
        view={view}
        read={read}
        marks={EXPLORER_MARKS}
        folderPage={folderPage}
        hrefFor={(r, v) => `?at=${encodeURIComponent(r)}&view=${v ?? view}`}
        onRoute={(r, v) => {
          setRoute(r);
          if (v) setView(v);
        }}
      />
    </div>
  );
}

const wideIn = (el: HTMLElement) => el.getBoundingClientRect().width >= 760;
// rise-in starts at opacity 0: wait it out
const shown = (el: HTMLElement) => waitFor(() => expect(el).toBeVisible());
const settle = (el: HTMLElement) =>
  waitFor(() => expect(el.querySelector('[role="status"]')).toBeNull(), { timeout: 4000 });

/** A rule line, five steps down: each step a column, the line whole at the right. */
export const Default: Story = {
  render: () => <Demo make={() => explorerRead()} at={`${SET}/BP-2`} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByRole("heading", { name: "BP-2", level: 2 });
    await settle(canvasElement);
    await shown(
      canvas.getByText("A cold proof overnight gives a deeper taste.", { selector: "div" }),
    );
    // its sources, as rows to their homes
    await shown(canvas.getByRole("region", { name: "Backed by" }));
    // narrow: Back to the set; the crumb names only the line
    if (!wideIn(canvasElement)) {
      await expect(canvas.getAllByRole("link", { name: "bread-baking-proofing" })).toHaveLength(1);
      await expect(canvas.getByRole("navigation", { name: "Path" })).toHaveTextContent(/^BP-2$/);
      return;
    }
    await expect(canvasElement.querySelectorAll("[data-col]")).toHaveLength(6);
  },
};

/** A folder: its rows, no preview. */
export const Folder: Story = {
  render: () => <Demo make={() => explorerRead()} at="canon/topics" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByRole("link", { name: /bread-baking/ });
    await expect(canvas.queryByRole("heading", { level: 2 })).toBeNull();
  },
};

/** The root with the adapter's page beside its rows: Canon's overview. */
export const FolderPage: Story = {
  render: () => (
    <Demo
      make={() => explorerRead()}
      at="canon"
      folderPage={(c) =>
        c.route === "canon" ? (
          <section aria-label={EXPLORER_ROOT_PAGE.title} className="flex flex-col gap-2">
            <h2 className="m-0 text-[15px] font-semibold">{EXPLORER_ROOT_PAGE.title}</h2>
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[13.5px]">
              {EXPLORER_ROOT_PAGE.lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </section>
        ) : null
      }
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await shown(await canvas.findByRole("region", { name: EXPLORER_ROOT_PAGE.title }));
    await waitFor(() => expect(canvas.getByRole("link", { name: /^Topics/ })).toBeVisible());
  },
};

/** From the root by click and keys: ↓ moves in a column, → opens the row, ← lands back on it. */
export const Keys: Story = {
  render: () => <Demo make={() => explorerRead()} at="canon" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = (path: string) =>
      canvasElement.querySelector<HTMLElement>(`a[data-row][data-path="${path}"]`);
    await waitFor(() => expect(row("canon/topics")).not.toBeNull());
    await userEvent.click(row("canon/topics") as HTMLElement);
    await waitFor(() => expect(row("canon/topics/bread-baking")).not.toBeNull());
    // narrow: one pane, Back to the root; the crumb names only where it stands
    if (!wideIn(canvasElement)) {
      await expect(canvas.getAllByRole("link", { name: "Canon" })).toHaveLength(1);
      return;
    }
    row("canon/topics")?.focus();
    await userEvent.keyboard("{ArrowDown}");
    await expect(row("canon/references")).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}");
    await waitFor(() =>
      expect(document.activeElement?.closest("[data-col]")?.getAttribute("data-col")).toBe(
        "canon/references",
      ),
    );
    await expect(canvasElement.querySelectorAll("[data-col]")).toHaveLength(2);
    await userEvent.keyboard("{ArrowLeft}");
    await expect(row("canon/references")).toHaveFocus();
  },
};

/** List: the tree under the set, the route's line open, the preview beside it. */
export const List: Story = {
  render: () => <Demo make={() => explorerRead()} at={`${SET}/BP-1`} view="list" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByRole("heading", { name: "BP-1", level: 2 });
    await settle(canvasElement);
    if (!wideIn(canvasElement)) return;
    const fold = canvas.getByRole("button", { name: "Open BP-3" });
    await userEvent.click(fold);
    await canvas.findByRole("button", { name: "Close BP-3" });
    await waitFor(() =>
      expect(canvasElement.querySelector(`a[data-path="${SET}/BP-3/backed-by"]`)).not.toBeNull(),
    );
  },
};

/** Gallery: the references as tiles, 24 to a page, then Show more. */
export const Gallery: Story = {
  render: () => <Demo make={() => explorerRead()} at="canon/references" view="gallery" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByRole("button", { name: "Show more" });
    await expect(canvasElement.querySelectorAll("a[data-row]")).toHaveLength(24);
    await userEvent.click(canvas.getByRole("button", { name: "Show more" }));
    await waitFor(() => expect(canvasElement.querySelectorAll("a[data-row]")).toHaveLength(30));
    await expect(canvas.queryByRole("button", { name: "Show more" })).toBeNull();
  },
};

/** A set another topic owns, shown here: ↗ on its row, "Show original" on the preview. */
export const Alias: Story = {
  render: () => (
    <Demo make={() => explorerRead()} at="canon/topics/bread-baking/sets/plating-color" />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByRole("heading", { name: "plating-color", level: 2 });
    await expect(canvas.getByRole("link", { name: "Show original" })).toHaveAttribute(
      "href",
      expect.stringContaining(encodeURIComponent("canon/topics/plating/sets/plating-color")),
    );
    // ↗ marks the edge only: the set's row, never the lines inside it
    await expect(canvas.queryAllByRole("img", { name: "shown here from its home" })).toHaveLength(
      wideIn(canvasElement) ? 1 : 0,
    );
  },
};

/** A path that moved: the item that took its place, and a line that says so. */
export const Moved: Story = {
  render: () => <Demo make={() => explorerRead()} at="canon/topics/sourdough" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText(/“sourdough” moved: this is bread-baking\./);
    await expect(canvas.queryByRole("link", { name: "Show original" })).toBeNull();
    // its rows are at home, under the new name: no alias mark, links to the new path
    await expect(canvas.queryAllByRole("img", { name: "shown here from its home" })).toHaveLength(
      0,
    );
    await expect(canvas.getByRole("link", { name: /^Rule sets/ })).toHaveAttribute(
      "href",
      expect.stringContaining(encodeURIComponent("canon/topics/bread-baking/sets")),
    );
  },
};

/** Nothing at the path: the steps that stand, and the way up. */
export const UnknownPath: Story = {
  render: () => (
    <Demo make={() => explorerRead()} at="canon/topics/bread-baking/sets/bread-baking-rye" />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText("Nothing is at “bread-baking-rye”.");
    await expect(canvas.getByRole("link", { name: "Go up one level" })).toHaveAttribute(
      "href",
      expect.stringContaining(`${encodeURIComponent("canon/topics/bread-baking/sets")}&`),
    );
  },
};

/** A source that doesn't answer: the folders above it stand, with Try again. */
export const Offline: Story = {
  render: () => <Demo make={() => explorerRead({ offline: "canon/files" })} at="canon/files" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText("Canon doesn't answer.");
    await shown(canvas.getByRole("button", { name: "Try again" }));
  },
};

/** A folder that holds nothing yet. */
export const Empty: Story = {
  render: () => <Demo make={() => explorerRead()} at="canon/topics/kitchen-safety/sets" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText("Rule sets holds nothing yet.");
  },
};

/** The first read is out: grey columns, no spinner. */
export const Loading: Story = {
  render: () => <Demo make={explorerPending} at={SET} />,
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(canvasElement.querySelectorAll('[role="status"]').length).toBeGreaterThan(0),
    );
  },
};

/** The server fails: what failed and Try again. */
export const Failed: Story = {
  render: () => <Demo make={explorerFails} at={SET} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // the data layer tries a 500 once more first
    await canvas.findByRole("button", { name: /Try again/ }, { timeout: 4000 });
  },
};

/** Find under the route; a pick goes there and ends the find; no match steps out to all of Canon. */
export const Find: Story = {
  render: () => <Demo make={() => explorerRead()} at="canon/topics/bread-baking" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByRole("heading", { name: "bread-baking", level: 2 });
    const box = canvas.getByRole("searchbox");
    await userEvent.type(box, "proof");
    const found = await canvas.findByRole("list", { name: "Found in bread-baking" });
    await expect(within(found).getAllByRole("link").length).toBeGreaterThan(2);
    await userEvent.click(within(found).getByRole("link", { name: /^BP-1/ }));
    await canvas.findByRole("heading", { name: "BP-1", level: 2 });
    await expect(box).toHaveValue("");
    await userEvent.type(box, "steam");
    await userEvent.click(await canvas.findByRole("button", { name: "Search all of Canon" }));
    const all = await canvas.findByRole("list", { name: "Found in Canon" });
    await expect(within(all).getAllByRole("link").length).toBeGreaterThan(1);
  },
};

/** No match under the route: one step out to all of Canon. */
export const FindNone: Story = {
  render: () => <Demo make={() => explorerRead()} at="canon/topics/knife-skills" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByRole("heading", { name: "knife-skills", level: 2 });
    await userEvent.type(canvas.getByRole("searchbox"), "steam");
    await canvas.findByText("No match for “steam” in knife-skills.");
    await shown(canvas.getByRole("button", { name: "Search all of Canon" }));
  },
};

/** Long names, non-Latin text, a URL with no spaces, a long body: nothing widens the page. */
export const WorstCase: Story = {
  render: () => (
    <Demo
      make={() => explorerRead({ worst: true })}
      at="canon/topics/a-label-that-keeps-going-well-past-the-width-any-column-would-ever-give-it/sets/worst-set/W-4"
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByRole("heading", { name: "W-4", level: 2 });
    await settle(canvasElement);
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};
