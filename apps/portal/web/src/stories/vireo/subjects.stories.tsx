/** Vireo › a subject's generation tree, opened whole in Explorer (`?whole=1`, WA-1373). Folders: `wren/explorer/folders.stories.tsx`. Fake server: `web/src/mocks/`. */
import type { Meta } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { ADMIN } from "../../mocks/data/me.js";
import { pageAt, storyHref } from "../../mocks/page.js";
import { wholeHref } from "../../modules/explorer/href.js";

const meta: Meta = { title: "Vireo/Subjects" };
export default meta;

// mocks/data/variants.ts: subject 3, subject 4
const HERO = "vireo/subjects/hero-background";
const PORTFOLIO = "vireo/subjects/portfolio-hero";
const ONE = { me: ADMIN, empty: false } as const;

/** Four rounds, one open (blind). A batch's name opens the batch. */
export const Tree = pageAt(wholeHref(HERO), {
  ...ONE,
  check: async (page) => {
    const [first] = await within(page).findAllByRole(
      "link",
      { name: /^Batch \d/ },
      { timeout: 8000 },
    );
    if (!first) throw new Error("no batch link");
    const to = first.getAttribute("href") ?? "";
    await expect(to).toMatch(/^\/variants\/batches\?b=[a-z0-9-]+:\d+$/);
    await userEvent.click(first);
    await waitFor(() => expect(storyHref()).toBe(to));
  },
});

/** The subject has not come back: a ghost in the tree's shape. */
export const TreeLoading = pageAt(wholeHref(HERO), {
  ...ONE,
  answers: { "variants/subject": null },
});

/** Notes only, no calls: grew and unmarked carry the tree (prod's shape). */
export const TreeNotes = pageAt(wholeHref(PORTFOLIO), ONE);

/** One sample's line only (`branch=`): its parents up to the brief and all it grew. */
export const TreeBranch = pageAt(wholeHref(HERO, { branch: "14" }), ONE);

/** A folded sample (`fold=`): what grew only from it goes to "+N". */
export const TreeFold = pageAt(wholeHref(PORTFOLIO, { fold: "109" }), ONE);

/** A click on a sample opens it in place, beside its card (a sheet on a phone); Esc closes it. */
export const TreeOpen = pageAt(wholeHref(HERO), {
  ...ONE,
  check: async (page) => {
    const nodes = await within(page).findAllByRole(
      "button",
      { name: /, batch \d+, / },
      { timeout: 8000 },
    );
    const node = nodes.find((n) => !/to mark/.test(n.getAttribute("aria-label") ?? ""));
    if (!node) throw new Error("no marked sample");
    await userEvent.click(node);
    const open = await within(page).findByRole("region", { name: "Open sample" });
    await expect(within(open).getByText("Path")).toBeInTheDocument();
  },
});
