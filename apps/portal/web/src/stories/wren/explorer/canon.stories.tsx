/** Explorer › Canon: Explorer over the Canon tree (`paths/*`), each kind of home in the preview. Fake server: `web/src/mocks/`. */
import type { Meta } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { CANON_ROWS } from "../../../mocks/data/canon.js";
import { CANON_HOME } from "../../../mocks/data/canon-library.js";
import { ADMIN } from "../../../mocks/data/me.js";
import { pageAt, tidy } from "../../../mocks/page.js";
import { explorerHref } from "../../../modules/explorer/href.js";

const meta: Meta = { title: "Wren/Explorer/Canon" };
export default meta;

const WAIT = { timeout: 5000 };
const at = (route: string, view?: "list" | "gallery") => explorerHref(route, view);
const REF = CANON_ROWS[0]?.id ?? "instagram-Fake1";
const LONG = "writing-tells-and-a-much-longer-topic-name-that-wraps";

/** One record open: an empty Canon holds none, so Empty mode has no state to check here. */
const ONE = { me: ADMIN, empty: false } as const;

/** The root: its four areas, and what needs a look beside them, every link a path in the tree. */
export const Default = tidy(
  pageAt("/explorer/canon", {
    me: ADMIN,
    check: async (page) => {
      const view = within(page);
      // two stale cites on one guide count once, with the open conflict
      await expect(await view.findByText("Needs a look (3)", {}, WAIT)).toBeVisible();
      await expect(view.getByRole("link", { name: /^Topics/ })).toBeVisible();
      await expect(
        view.getByRole("link", { name: "Two sources disagree on the first cut" }),
      ).toHaveAttribute("href", at("canon/records/conflict/conflict-cut-length-fake"));
      await expect(view.getByRole("link", { name: "Writing tells: Copy" })).toHaveAttribute(
        "href",
        at(`canon/topics/${LONG}/sets/writing-tells-copy`),
      );
      await expect(view.getByRole("link", { name: /^Findings/ })).toHaveAttribute(
        "href",
        at("canon/records/finding"),
      );
      await expect(view.getByText("Personal brand, then licensing")).toBeVisible();
    },
  }),
);

/** A topic: its layers in the column; its size, posters and the whole page in the preview. */
export const Topic = tidy(
  pageAt(at("canon/topics/video-editing"), {
    ...ONE,
    check: async (page) => {
      const view = within(page);
      await expect(
        await view.findByRole("link", { name: "Open the whole topic" }, WAIT),
      ).toHaveAttribute("href", "/canon/topic?t=video-editing");
      await expect(view.getByText("2 rule sets, 4 lines")).toBeVisible();
      await expect(view.getByText("1 open conflict")).toBeVisible();
      await expect(
        view.getByRole("link", { name: "Cuts on the kick, captions one word at a time" }),
      ).toHaveAttribute("href", at(`canon/references/${REF}`));
    },
  }),
);

/** A rule set: its lines as markdown; a cite goes to its record's home in the tree. */
export const RuleSet = tidy(
  pageAt(at("canon/topics/video-editing/sets/video-editing-cuts"), {
    ...ONE,
    check: async (page) => {
      const view = within(page);
      // the body's line, then its row's sub
      const [line] = await view.findAllByText(/Cut on the beat, never between beats\./, {}, WAIT);
      // through the preview's rise-in
      await waitFor(() => expect(line).toBeVisible(), WAIT);
      // checks the href, no click: the shot stays on the set
      const cite = view.getAllByRole("link", { name: "[1]" })[0];
      await expect(decodeURIComponent(cite?.getAttribute("href") ?? "")).toContain(
        "at=canon/records/finding/cuts-land-on-the-kick-fake01",
      );
    },
  }),
);

/** One rule line: its text once, and the agent source behind it. */
export const RuleLine = tidy(
  pageAt(at("canon/topics/video-editing/sets/video-editing-cuts/VC-3"), {
    ...ONE,
    check: async (page) => {
      const view = within(page);
      // once in the preview; at 1280 its column row too
      const shown = await view.findAllByText(
        "Never cut away from the speaker mid-word. [3]",
        {},
        WAIT,
      );
      await expect(shown.length).toBeLessThanOrEqual(2);
      await expect(shown.at(-1)).toBeVisible();
      await expect(view.getAllByText("Agent source").length).toBeGreaterThan(0);
    },
  }),
);

/** A reference: the player and his note; the lines it backs are the preview's links. */
export const Reference = tidy(
  pageAt(at(`canon/references/${REF}`), {
    ...ONE,
    check: async (page) => {
      const view = within(page);
      await expect(await view.findByText("His note", {}, WAIT)).toBeVisible();
      await expect(view.queryByRole("heading", { name: "Backs", level: 3 })).toBeNull();
    },
  }),
);

/** A finding: fields whole, a cite not in Canon marked in its links. */
export const Record = tidy(
  pageAt(at("canon/records/finding/cuts-land-on-the-kick-fake01"), {
    ...ONE,
    check: async (page) => {
      const view = within(page);
      await expect(await view.findByText("confidence", {}, WAIT)).toBeVisible();
      await expect(view.getByText("findings/cuts-land-on-the-kick-fake01.md")).toBeVisible();
      await expect(view.getAllByText("Not in Canon").length).toBeGreaterThan(0);
    },
  }),
);

/** A direction doc: frontmatter as code, the rest as markdown. */
export const File = tidy(
  pageAt(at("canon/files/direction/2026-11-12-personal-brand.md"), {
    ...ONE,
    check: async (page) => {
      const view = within(page);
      await expect(await view.findByText("date: 2026-11-12", {}, WAIT)).toBeVisible();
      await expect(view.getByText("each skill climbs to licensing")).toBeVisible();
    },
  }),
);

/** Every reference as a poster wall. */
export const Gallery = tidy(
  pageAt(at("canon/references", "gallery"), {
    me: ADMIN,
    check: async (page) => {
      const view = within(page);
      await expect(
        await view.findByRole("link", { name: /Pricing in one whiteboard/ }, WAIT),
      ).toBeVisible();
    },
  }),
);

/** Find under the root: the words matched, each result a link to its home. */
export const Find = tidy(
  pageAt("/explorer/canon", {
    me: ADMIN,
    check: async (page) => {
      const view = within(page);
      await userEvent.type(await view.findByRole("searchbox", {}, WAIT), "kick");
      const found = await view.findByText(/Found in Canon/, {}, WAIT);
      // through the results' rise-in
      await waitFor(() => expect(found).toBeVisible(), WAIT);
      // checks the href, no click: the shot stays on the results
      const hit = await view.findByRole("link", { name: /Cuts land on the kick drum/ }, WAIT);
      await expect(decodeURIComponent(hit.getAttribute("href") ?? "")).toContain(
        "cuts-land-on-the-kick",
      );
    },
  }),
);

/** Before the first sync: the tree says how Canon gets here. */
export const NotIndexed = pageAt("/explorer/canon", {
  me: ADMIN,
  // the first-run state already: Canon with no index
  empty: false,
  answers: {
    "paths/columns": {
      columns: [],
      error: { code: "not-indexed", message: "Canon has no index here yet", route: "canon" },
    },
    "canon/home": { ...CANON_HOME, indexed: false, head: null, topics: [] },
  },
  check: async (page) => {
    await expect(await within(page).findByText(/wren canon sync/, {}, WAIT)).toBeVisible();
  },
});

export const Loading = pageAt("/explorer/canon", { me: ADMIN, mode: "pending" });

export const Failed = pageAt("/explorer/canon", {
  me: ADMIN,
  mode: "fails",
  check: async (page) => {
    await expect(await within(page).findByRole("alert", {}, WAIT)).toBeVisible();
  },
});
