/**
 * A page story: the whole portal at one address, on the fake server (`./api.ts`). The router runs
 * on a memory history, so links move inside the story and the frame's own address stays.
 */
import type { StoryObj } from "@storybook/react-vite";
import { createMemoryHistory } from "@tanstack/react-router";
import { useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import type { Me } from "../api.js";
import { PortalRouter } from "../router.js";
import { type Answers, fakeApi, freshStory, type Mode, settled } from "./api.js";
import { ANSWERS } from "./data/index.js";
import { OWNER } from "./data/me.js";

export interface PageAt {
  /** Who is signed in; a client's owner by default. */
  me?: Me;
  /** Answers on top of the shared table (`./data/index.ts`). */
  answers?: Answers;
  /** `pending`: no read comes back; `fails`: every read is refused. Who is signed in still answers. */
  mode?: Mode;
  /** What the test asserts once the data is in, after the unmocked check. */
  check?: (page: HTMLElement) => void | Promise<void>;
}

function Page({ at }: { at: string }) {
  const [history] = useState(() => createMemoryHistory({ initialEntries: [at] }));
  return <PortalRouter history={history} />;
}

/** The story for the portal at `at` (`/reactivation/people?status=open`). */
export function pageAt(
  at: string,
  { me = OWNER, answers = {}, mode, check }: PageAt = {},
): StoryObj {
  return {
    render: () => <Page at={at} />,
    beforeEach: freshStory,
    // The test (and axe) reads the page once its data is in; a pending story has none to wait for.
    ...(mode === "pending"
      ? {}
      : {
          play: async ({ canvasElement }) => {
            await settled();
            await check?.(canvasElement);
          },
        }),
    parameters: {
      layout: "fullscreen",
      msw: fakeApi({ ...ANSWERS, "delivery/me": me, ...answers }, mode),
    },
  };
}

/** The check that the section `title` shows its failed read and never says nothing waits. */
export const failedIn = (title: string) => async (page: HTMLElement) => {
  const head = await within(page).findByRole("heading", { name: new RegExp(`^${title}`) });
  const section = head.closest("section");
  if (!section) throw new Error(`"${title}" is not in a section`);
  const alert = await within(section).findByRole("alert");
  // Sections fade in where motion is on.
  await waitFor(() => expect(alert).toBeVisible());
  await expect(within(page).queryByText("Nothing waits on you.")).toBeNull();
};

/**
 * The element that holds Today. On a desktop it is the sheet behind the Map's "Today" button, which
 * this opens; on a phone it is the page, where Today is a tab under the Map and already open.
 */
export async function todayOf(page: HTMLElement): Promise<HTMLElement> {
  const open = await within(page).findByRole("button", { name: "Today" });
  if (open.getAttribute("aria-haspopup") !== "dialog") return page;
  await userEvent.click(open);
  return within(document.body).findByRole("dialog", { name: "Today" });
}
