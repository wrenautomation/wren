/**
 * Studio (designs/2026-11-13-studio-suite.md): its own frame and each page's state rows (D5, D6).
 * Fake server: `web/src/mocks/`.
 */
import type { Meta } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { refuse } from "../../../mocks/api.js";
import { canonAddAnswers } from "../../../mocks/data/canon.js";
import { ADMIN } from "../../../mocks/data/me.js";
import { pageAt, tidy } from "../../../mocks/page.js";

const meta: Meta = { title: "Wren/Studio" };
export default meta;

const WAIT = { timeout: 5000 };

/** Standalone: Studio's name, its pages alone, the viewer's name, no Wren place. */
async function alone(page: HTMLElement) {
  const view = within(page);
  await expect(await view.findByText("Avery", {}, WAIT)).toBeVisible();
  await expect(view.queryByRole("link", { name: /^Map/ })).toBeNull();
  await expect(view.queryByRole("link", { name: /^Canon/ })).toBeNull();
  await expect(view.queryByRole("button", { name: "View as" })).toBeNull();
  await waitFor(() => expect(document.title).toMatch(/· Studio$/));
}

/** Typical: an idea with a batch to score, a rendered edit waiting on him, a posted one. */
export const Projects = tidy(
  pageAt("/studio/projects", {
    me: ADMIN,
    check: async (page) => {
      await alone(page);
      const view = within(page);
      await expect(await view.findByText(/edits my videos while I sleep/, {}, WAIT)).toBeVisible();
      await expect(view.getByText("Idea")).toBeVisible();
      await expect(view.getByText("Waiting on you")).toBeVisible();
      await expect(view.getByText("Posted")).toBeVisible();
      await expect(view.getByText(/to score$/)).toBeVisible();
    },
  }),
);

export const ProjectsEmpty = pageAt("/studio/projects", {
  me: ADMIN,
  answers: { "console/call:VideoProjectDesk.list": { projects: [] } },
  check: async (page) => {
    await expect(await within(page).findByText("No project yet", {}, WAIT)).toBeVisible();
  },
});

/** The list never answers: skeleton rows. */
export const ProjectsLoading = pageAt("/studio/projects", {
  me: ADMIN,
  mode: "pending",
  check: async (page) => {
    await expect(await within(page).findByLabelText("Loading projects", {}, WAIT)).toBeVisible();
  },
});

export const ProjectsFailed = pageAt("/studio/projects", {
  me: ADMIN,
  answers: { "console/call:VideoProjectDesk.list": () => refuse(500, "the desk is down") },
  check: async (page) => {
    await expect(await within(page).findByRole("alert", {}, WAIT)).toBeVisible();
  },
});

/** New project: typed, added, it heads the list. */
export const NewProject = tidy(
  pageAt("/studio/projects", {
    me: ADMIN,
    check: async (page) => {
      const view = within(page);
      await userEvent.click(await view.findByRole("button", { name: "New project" }, WAIT));
      await userEvent.type(view.getByRole("textbox", { name: "Title" }), "A test project");
      await userEvent.click(view.getByRole("button", { name: "Short" }));
      await expect(view.getByRole("button", { name: "Short" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await userEvent.click(view.getByRole("button", { name: "Add project" }));
      // the new row fades in (150 ms)
      await waitFor(() => expect(view.getByText("A test project")).toBeVisible(), WAIT);
      await expect(view.queryByRole("form", { name: "New project" })).toBeNull();
    },
  }),
);

/** Add failed: the reason shows and what he typed stays. */
export const NewProjectFailed = pageAt("/studio/projects", {
  me: ADMIN,
  answers: {
    "console/call:VideoProjectDesk.add": () => refuse(500, "The desk is down. Try again."),
  },
  check: async (page) => {
    const view = within(page);
    await userEvent.click(await view.findByRole("button", { name: "New project" }, WAIT));
    await userEvent.type(view.getByRole("textbox", { name: "Title" }), "Kept words");
    await userEvent.click(view.getByRole("button", { name: "Add project" }));
    await expect(await view.findByRole("alert", {}, WAIT)).toHaveTextContent(/desk is down/);
    await expect(view.getByRole("textbox", { name: "Title" })).toHaveValue("Kept words");
  },
});

export const Inspiration = tidy(
  pageAt("/studio/inspiration", {
    me: ADMIN,
    answers: canonAddAnswers([]),
    check: async (page) => {
      await alone(page);
      await expect(await within(page).findByText("312x", {}, WAIT)).toBeVisible();
    },
  }),
);

/** Edit with no project: the newest recordings, each opening here. */
export const Edit = tidy(pageAt("/studio/edit", { me: ADMIN, check: alone }));

/** A project not filmed yet: how to tie its recording. */
export const EditNotFilmed = pageAt("/studio/edit?project=3", {
  me: ADMIN,
  check: async (page) => {
    await expect(await within(page).findByText(/Not filmed yet/, {}, WAIT)).toBeVisible();
  },
});

/** A filmed project: its edit's record, back to Projects. */
export const EditFilmed = pageAt("/studio/edit?project=2", {
  me: ADMIN,
  check: async (page) => {
    await expect(await within(page).findByRole("link", { name: /Projects/ }, WAIT)).toBeVisible();
  },
});

export const EditUnknownProject = pageAt("/studio/edit?project=999", {
  me: ADMIN,
  check: async (page) => {
    await expect(await within(page).findByText("This project isn't here", {}, WAIT)).toBeVisible();
  },
});

export const Publish = tidy(pageAt("/studio/publish", { me: ADMIN, check: alone }));
