/** Explorer › Folders: his folders, each filed item an alias of its home in Vireo or Weaver. Fake server: `web/src/mocks/`. */
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { freshStory } from "../../../mocks/api.js";
import { resetFolders } from "../../../mocks/data/folders.js";
import { ADMIN } from "../../../mocks/data/me.js";
import { pageAt, tidy } from "../../../mocks/page.js";
import { SERVED } from "../../../mocks/weaver-serve.js";
import { explorerHref, wholeHref } from "../../../modules/explorer/href.js";
import { linkTo, WAIT } from "./explorer-kit.js";

const meta: Meta = { title: "Wren/Explorer/Folders" };
export default meta;

const at = (route: string) => explorerHref(route);

/** Folders read the tree, Vireo's subjects and the runs on `weaver serve`; each story from the same tree. */
const story = (route: string, check: (page: HTMLElement) => Promise<void>): StoryObj => {
  const base = pageAt(route, { me: ADMIN, check, empty: false });
  return {
    ...base,
    parameters: { ...base.parameters, msw: [...SERVED, ...(base.parameters?.msw ?? [])] },
    beforeEach: () => {
      resetFolders();
      freshStory();
    },
  };
};

/** The root: every top folder. */
export const Default = tidy(
  story("/explorer/folders", async (page) => {
    const view = within(page);
    await expect(await view.findByRole("link", { name: /^Bakeries/ }, WAIT)).toHaveAttribute(
      "href",
      at("folders/1"),
    );
    await expect(view.getByRole("link", { name: /^Launch week/ })).toBeVisible();
  }),
);

/** A folder: its subfolder, a subject and a run filed in it, each under the folder's path. */
export const Folder = tidy(
  story(at("folders/1"), async (page) => {
    const view = within(page);
    await expect(await view.findByRole("link", { name: /^Buyers/ }, WAIT)).toHaveAttribute(
      "href",
      at("folders/1/2"),
    );
    await expect(
      view.getByRole("link", { name: /Which cafes buy pastries from outside bakers/ }),
    ).toHaveAttribute("href", at("folders/1/r2"));
    await expect(view.getByRole("link", { name: /^Opener email, small bakeries/ })).toHaveAttribute(
      "href",
      at("folders/1/opener"),
    );
    // each filed row says where it lives
    await expect(view.getByText("from Vireo")).toBeVisible();
    await expect(view.getByText("from Weaver")).toBeVisible();
  }),
);

/** A filed subject: the walk crosses to the server's Vireo and reads as the folder's path. */
export const FiledSubject = tidy(
  story(at("folders/1/opener"), async (page) => {
    const view = within(page);
    await expect(await view.findByRole("link", { name: "Open its tree" }, WAIT)).toHaveAttribute(
      "href",
      wholeHref("vireo/subjects/opener"),
    );
    await linkTo(view, /^Batches/, at("folders/1/opener/batches"));
  }),
);
