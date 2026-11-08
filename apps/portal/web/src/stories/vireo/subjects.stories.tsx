/** Vireo (Variants) › Subjects: the list in folders, and each one's generation tree. Fake server: `web/src/mocks/`. */
import type { Meta } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { freshStory } from "../../mocks/api.js";
import { resetFolders } from "../../mocks/data/folders.js";
import { ADMIN } from "../../mocks/data/me.js";
import { pageAt, storyHref } from "../../mocks/page.js";

const meta: Meta = { title: "Vireo/Subjects" };
export default meta;

/** The list: folders first (Bakeries holds Buyers), then the subjects in no folder. */
export const Default = {
  ...pageAt("/variants/subjects", {
    me: ADMIN,
    check: async (page) => {
      const c = within(page);
      await c.findByRole("button", { name: /^Bakeries/ }, { timeout: 8000 });
      await expect(c.getByRole("heading", { name: "No folder" })).toBeTruthy();
      await expect(c.getByText(/^Promo cut, 30s/)).toBeTruthy();
    },
  }),
  beforeEach: () => {
    resetFolders();
    freshStory();
  },
};

/** A folder opened: its subjects show in it, with the left rule. */
export const FolderOpen = {
  ...pageAt("/variants/subjects", {
    me: ADMIN,
    check: async (page) => {
      const c = within(page);
      await userEvent.click(await c.findByRole("button", { name: /^Bakeries/ }, { timeout: 8000 }));
      await c.findByText(/^Opener email, small bakeries/);
    },
  }),
  beforeEach: () => {
    resetFolders();
    freshStory();
  },
};

/** A subject's generation tree: four rounds, one open (blind). A batch's name opens the batch. */
export const Tree = pageAt("/variants/subjects?subject=3", {
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
export const TreeNotes = pageAt("/variants/subjects?subject=4", { me: ADMIN });

/** One sample's line only (`branch=`): its parents up to the brief and all it grew. */
export const TreeBranch = pageAt("/variants/subjects?subject=3&branch=14", { me: ADMIN });

/** A folded sample (`fold=`): what grew only from it goes to "+N". */
export const TreeFold = pageAt("/variants/subjects?subject=4&fold=109", { me: ADMIN });
