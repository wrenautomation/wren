/**
 * A page story: the whole portal at one address, on the fake server (`./api.ts`). The router runs
 * on a memory history, so links move inside the story and the frame's own address stays.
 */
import type { StoryObj } from "@storybook/react-vite";
import { createMemoryHistory } from "@tanstack/react-router";
import { useState } from "react";
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
}

function Page({ at }: { at: string }) {
  const [history] = useState(() => createMemoryHistory({ initialEntries: [at] }));
  return <PortalRouter history={history} />;
}

/** The story for the portal at `at` (`/reactivation/people?status=open`). */
export function pageAt(at: string, { me = OWNER, answers = {}, mode }: PageAt = {}): StoryObj {
  return {
    render: () => <Page at={at} />,
    beforeEach: freshStory,
    // The test (and axe) reads the page once its data is in; a pending story has none to wait for.
    ...(mode === "pending" ? {} : { play: () => settled() }),
    parameters: {
      layout: "fullscreen",
      msw: fakeApi({ ...ANSWERS, "delivery/me": me, ...answers }, mode),
    },
  };
}
