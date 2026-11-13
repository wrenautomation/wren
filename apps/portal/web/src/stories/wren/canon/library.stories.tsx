/** Canon: a topic, the Library, and any record or file opened beside them. Fake server: `web/src/mocks/`. */
import type { Meta } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { ADMIN } from "../../../mocks/data/me.js";
import { pageAt, storyHref, tidy } from "../../../mocks/page.js";

const meta: Meta = { title: "Wren/Canon/Library" };
export default meta;

const WAIT = { timeout: 5000 };
const sheet = async () => within(await within(document.body).findByRole("dialog", {}, WAIT));

/** One topic: the guide with cites as links; a cite opens its record beside the page. */
export const Topic = tidy(
  pageAt("/canon/topic?t=video-editing", {
    me: ADMIN,
    check: async (page) => {
      const view = within(page);
      await expect(
        await view.findByText(/Study the style before you edit$/, {}, WAIT),
      ).toBeVisible();
      // [9] names no cite: plain text, not a link
      await expect(view.queryByRole("link", { name: "[9]" })).toBeNull();
      await expect(view.getByText(/steal the zoom on the punchline/)).toBeVisible();
      await userEvent.click(view.getAllByRole("link", { name: "[1]" })[0] as HTMLElement);
      const s = await sheet();
      await expect(
        await s.findByText(/Cut on the beat, never between beats\./, {}, WAIT),
      ).toBeVisible();
      await expect(storyHref()).toContain("r=video-editing-cuts");
    },
  }),
);

/**
 * The layers in order: what the skill loads, each rule line with its id, backing, conflict and
 * references; a borrowed set folded with the lines this topic loads; references say which lines
 * they back; checks apart from files.
 */
export const TopicLayers = tidy(
  pageAt("/canon/topic?t=video-editing", {
    me: ADMIN,
    check: async (page) => {
      const view = within(page);
      const nav = await view.findByRole("navigation", { name: "On this page" }, WAIT);
      await expect(within(nav).getByRole("link", { name: "References (4)" })).toBeVisible();
      // the skill: guide, notes, then the sets, with the line filter
      await expect(view.getByText("only WC-1")).toBeVisible();
      const line = page.querySelector("#line-VC-2") as HTMLElement;
      await expect(within(line).getByText("His")).toBeVisible();
      await expect(within(line).getByRole("link", { name: "Conflict" })).toBeVisible();
      await expect(
        within(page.querySelector("#line-VC-1") as HTMLElement).getAllByRole("link", {
          name: /^Reference: /,
        }),
      ).toHaveLength(2);
      // a borrowed set starts folded and names its owner and the lines loaded
      const borrowed = page.querySelector("#set-writing-tells-copy") as HTMLDetailsElement;
      await expect(borrowed.open).toBe(false);
      await userEvent.click(within(borrowed).getByText("Writing tells: Copy"));
      await expect(within(borrowed).getByText("This topic loads only WC-1")).toBeVisible();
      await expect(within(borrowed).getAllByText("No source")).toHaveLength(2);
      // a reference card links the lines it backs
      await expect(view.getByText("Backs no line yet")).toBeVisible();
      await expect(view.getAllByRole("link", { name: "VCA-1" })[0]).toHaveAttribute(
        "href",
        "#line-VCA-1",
      );
      await expect(view.getByRole("link", { name: "cuts-on-beat.mjs" })).toBeVisible();
      await expect(view.queryByRole("link", { name: "checks/cuts-on-beat.mjs" })).toBeNull();
    },
  }),
);

/** No topic in the address. */
export const TopicNotPicked = pageAt("/canon/topic", {
  me: ADMIN,
  check: async (page) => {
    await expect(await within(page).findByText("No topic picked", {}, WAIT)).toBeVisible();
  },
});

/** Every record, newest change first; Show more brings the next page. */
export const Library = tidy(
  pageAt("/canon/library", {
    me: ADMIN,
    check: async (page) => {
      const view = within(page);
      await expect(await view.findByText("57 records", {}, WAIT)).toBeVisible();
      await expect(view.getByText(/keeps going$/)).toBeVisible();
      await userEvent.click(view.getByRole("button", { name: "Show more" }));
      await expect(await view.findByText("Finding 50", {}, WAIT)).toBeVisible();
      await waitFor(() => expect(view.queryByRole("button", { name: "Show more" })).toBeNull());
    },
  }),
);

/** A type picked: the list narrows and the address keeps it. */
export const LibraryByType = tidy(
  pageAt("/canon/library", {
    me: ADMIN,
    check: async (page) => {
      const view = within(page);
      await userEvent.selectOptions(await view.findByLabelText("Type", {}, WAIT), "rule");
      await expect(await view.findByText("1 record", {}, WAIT)).toBeVisible();
      await expect(storyHref()).toContain("type=rule");
    },
  }),
);

/** A search lists matching files above the records; a file opens beside the page. */
export const LibrarySearch = tidy(
  pageAt("/canon/library?q=video", {
    me: ADMIN,
    check: async (page) => {
      const view = within(page);
      await expect(await view.findByText(/^Files \(\d\)$/, {}, WAIT)).toBeVisible();
      await userEvent.click(view.getByRole("link", { name: "topics/video-editing/counts.tsv" }));
      const s = await sheet();
      await expect(await s.findByText(/VC-1\s+14/, {}, WAIT)).toBeVisible();
    },
  }),
);

/** Filters match nothing: the page offers to clear them. */
export const LibraryNoMatch = tidy(
  pageAt("/canon/library?q=nothing-matches-this", {
    me: ADMIN,
    check: async (page) => {
      const view = within(page);
      await expect(
        await view.findByText("No record matches these filters.", {}, WAIT),
      ).toBeVisible();
      await userEvent.click(view.getByRole("link", { name: "Clear filters" }));
      await expect(await view.findByText("57 records", {}, WAIT)).toBeVisible();
    },
  }),
);

/** A finding open: its text, a cite not in Canon, what cites it, every field. */
export const RecordOpened = tidy(
  pageAt("/canon/library?r=cuts-land-on-the-kick-fake01", {
    me: ADMIN,
    check: async () => {
      const s = await sheet();
      await expect(await s.findByText("not in Canon", {}, WAIT)).toBeVisible();
      await expect(s.getByRole("link", { name: "Video editing: Cuts" })).toBeVisible();
      await expect(s.getByText("confidence")).toBeVisible();
      await expect(s.getByText("findings/cuts-land-on-the-kick-fake01.md")).toBeVisible();
    },
  }),
);

/** His retired source: his note whole, the outside link. */
export const SourceOpened = tidy(
  pageAt("/canon/library?r=web-example-editing-guide", {
    me: ADMIN,
    check: async () => {
      const s = await sheet();
      await expect(
        await s.findByText(/the part about b-roll length is the useful bit$/, {}, WAIT),
      ).toBeVisible();
      await expect(s.getByText("retired")).toBeVisible();
      await expect(s.getByRole("link", { name: /Open the source/ })).toBeVisible();
    },
  }),
);

/** A direction doc open: frontmatter as code, the rest as markdown. */
export const FileOpened = tidy(
  pageAt("/canon/library?f=direction/2026-11-12-personal-brand.md", {
    me: ADMIN,
    check: async () => {
      const s = await sheet();
      await expect(await s.findByText("date: 2026-11-12", {}, WAIT)).toBeVisible();
      await expect(s.getByText("each skill climbs to licensing")).toBeVisible();
    },
  }),
);

/** A binary file: the index keeps its size only. */
export const BinaryFile = tidy(
  pageAt("/canon/topic?t=video-editing&f=topics/video-editing/refs/style-board.pdf", {
    me: ADMIN,
    check: async () => {
      const s = await sheet();
      await expect(await s.findByText("Not text", {}, WAIT)).toBeVisible();
      await expect(s.getByText("4.6 MB")).toBeVisible();
    },
  }),
);

export const Failed = pageAt("/canon/library", {
  me: ADMIN,
  mode: "fails",
  check: async (page) => {
    await expect(await within(page).findByRole("alert", {}, WAIT)).toBeVisible();
  },
});
