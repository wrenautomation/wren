/** Explorer › Vireo: subjects, batches, samples and guides as one tree (`paths/*`); an open batch stays blind. Fake server: `web/src/mocks/`. */
import type { Meta } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";
import { ADMIN } from "../../../mocks/data/me.js";
import { pageAt, tidy } from "../../../mocks/page.js";
import { explorerHref } from "../../../modules/explorer/href.js";
import { linkTo, relation, WAIT } from "./explorer-kit.js";

const meta: Meta = { title: "Wren/Explorer/Vireo" };
export default meta;

const at = (route: string, view?: "list" | "gallery") => explorerHref(route, view);
const HERO = "vireo/subjects/hero-background";

/** One record open: an empty Vireo holds none, so Empty mode has no state to check here. */
const ONE = { me: ADMIN, empty: false } as const;

/** The root: subjects and guides. */
export const Default = tidy(
  pageAt("/explorer/vireo", {
    me: ADMIN,
    // both areas show even when empty; Subjects and Guides check what fills them
    empty: false,
    check: async (page) => {
      const view = within(page);
      await linkTo(view, /^Subjects/, at("vireo/subjects"));
      await linkTo(view, /^Guides/, at("vireo/guides"));
    },
  }),
);

/** Every subject; empty, how an agent starts one. */
export const Subjects = tidy(
  pageAt(at("vireo/subjects"), {
    me: ADMIN,
    check: async (page) => {
      await linkTo(within(page), /^Hero background/, at(HERO));
    },
  }),
);

/** Every guide with its state; empty, where guides come from. */
export const Guides = tidy(
  pageAt(at("vireo/guides"), {
    me: ADMIN,
    check: async (page) => {
      await linkTo(within(page), /^Type is the hero/, at("vireo/guides/11"));
    },
  }),
);

/** A subject: its batches in the column; its brief and counts in the preview. */
export const Subject = tidy(
  pageAt(at(HERO), {
    ...ONE,
    check: async (page) => {
      const view = within(page);
      await expect(await view.findByText("4 batches", {}, WAIT)).toBeVisible();
      await expect(view.getByText("2 guides under test")).toBeVisible();
      await expect(view.getByRole("link", { name: "Open in Subjects" })).toHaveAttribute(
        "href",
        "/variants/subjects?subject=3",
      );
    },
  }),
);

/** A closed batch: its why, his note, the good rate; its samples as posters. */
export const Batch = tidy(
  pageAt(at(`${HERO}/batches/23`, "gallery"), {
    ...ONE,
    check: async (page) => {
      const view = within(page);
      const note = await view.findByText(/Type, slow ease is the one/, {}, WAIT);
      await waitFor(() => expect(note).toBeVisible(), WAIT);
      await expect(view.getByText("67% good")).toBeVisible();
      const open = view.getByRole("link", { name: "Open in Batches" });
      await expect(decodeURIComponent(open.getAttribute("href") ?? "")).toContain(
        "b=hero-background:3",
      );
    },
  }),
);

/** An open batch: no why, no lineage; the preview sends him to mark it. */
export const OpenBatch = tidy(
  pageAt(at(`${HERO}/batches/24`), {
    ...ONE,
    check: async (page) => {
      const view = within(page);
      await expect(
        await view.findByText(/its why, lineage and guides stay hidden/, {}, WAIT),
      ).toBeVisible();
      await expect(view.getByRole("link", { name: "Mark it in Batches" })).toBeVisible();
      await expect(view.queryByText(/test ease length/)).toBeNull();
    },
  }),
);

/** A blind sample's lineage, asked for by address: the tree says why, never an empty folder. */
export const Blind = pageAt(at(`${HERO}/batches/24/19/grew-from`), {
  ...ONE,
  check: async (page) => {
    await expect(
      await within(page).findByText(/This batch is open: mark it in Batches first/, {}, WAIT),
    ).toBeVisible();
  },
});

/** A kept sample: the page it is, what changed, and where it grew from. */
export const Sample = tidy(
  pageAt(at(`${HERO}/batches/23/13`), {
    ...ONE,
    check: async (page) => {
      const view = within(page);
      await expect(
        await view.findByText("Changed: Type, slow ease: a longer, softer ease.", {}, WAIT),
      ).toBeVisible();
      await expect(view.getAllByText("Kept").length).toBeGreaterThan(0);
      await relation(view, "Grew from", `${HERO}/batches/23/13/grew-from`);
    },
  }),
);

/** A video sample of an open batch: the cut plays; his own mark shows, nothing else. */
export const VideoSample = tidy(
  pageAt(at("vireo/subjects/promo-cut/batches/7/31"), {
    ...ONE,
    check: async (page) => {
      await waitFor(() => expect(page.querySelector("video")).not.toBeNull(), WAIT);
      await expect(within(page).queryByText(/^Changed:/)).toBeNull();
    },
  }),
);

/** A guide: its state, and the samples that applied it. */
export const Guide = tidy(
  pageAt(at("vireo/guides/11"), {
    ...ONE,
    check: async (page) => {
      const view = within(page);
      await expect(await view.findAllByText("Locked", {}, WAIT)).not.toHaveLength(0);
      await relation(view, "Applied in", "vireo/guides/11/applied-in");
    },
  }),
);

export const Loading = pageAt("/explorer/vireo", { me: ADMIN, mode: "pending" });

export const Failed = pageAt("/explorer/vireo", {
  me: ADMIN,
  mode: "fails",
  check: async (page) => {
    await expect(await within(page).findByRole("alert", {}, WAIT)).toBeVisible();
  },
});
