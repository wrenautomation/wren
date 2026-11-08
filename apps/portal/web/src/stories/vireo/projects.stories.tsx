/** Vireo (Variants) › Projects: the generation tree. Fake server: `web/src/mocks/`. */
import type { Meta } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { ADMIN } from "../../mocks/data/me.js";
import { pageAt, storyHref } from "../../mocks/page.js";

const meta: Meta = { title: "Vireo/Projects" };
export default meta;

export const Default = pageAt("/variants/projects", { me: ADMIN });

/** A subject's generation tree: four rounds, one open (blind). A batch's name opens the batch. */
export const Tree = pageAt("/variants/projects?subject=3", {
  me: ADMIN,
  check: async (page) => {
    const [first] = await within(page).findAllByRole(
      "link",
      { name: /^Batch \d/ },
      { timeout: 8000 },
    );
    if (!first) throw new Error("no batch link");
    const to = first.getAttribute("href") ?? "";
    await expect(to).toMatch(/^\/variants\/batches\?batch=\d+$/);
    await userEvent.click(first);
    await waitFor(() => expect(storyHref()).toBe(to));
  },
});

/** Notes only, no calls: grew and unmarked carry the tree (prod's shape). */
export const TreeNotes = pageAt("/variants/projects?subject=4", { me: ADMIN });

/** One sample's line only (`branch=`): its parents up to the brief and all it grew. */
export const TreeBranch = pageAt("/variants/projects?subject=3&branch=14", { me: ADMIN });

/** A folded sample (`fold=`): what grew only from it goes to "+N". */
export const TreeFold = pageAt("/variants/projects?subject=4&fold=109", { me: ADMIN });
