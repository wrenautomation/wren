/** Redesign stories: his prefs (the bar on top, Raycast light) and a page with Anton docked. */
import type { StoryObj } from "@storybook/react-vite";
import HISTORY from "../mocks/data/agent/history.json";
import SETUPS from "../mocks/data/agent/setups.json";
import { ADMIN } from "../mocks/data/me.js";
import { pageAt } from "../mocks/page.js";
import { fakeRelay } from "../mocks/relay.js";
import { PANEL_KEYS } from "../modules/agent/panel.js";

export const PREFS = { "console/prefs": () => ({ display: { sidebar: "top" }, look: "raycast" }) };
export const STORED = "00000000-0000-4000-8000-000000000001";
export const LONG = { timeout: 30_000 };
export const onPhone = () => matchMedia("(max-width: 900px)").matches;

export const docked = (
  at: string,
  check: (page: HTMLElement) => Promise<void>,
  /** Open on this chat; `null` a new one; left out, shut. */
  chat?: string | null,
): StoryObj => {
  const base = pageAt(at, { me: ADMIN, answers: PREFS, check, empty: false });
  return {
    ...base,
    beforeEach: () => {
      // freshStory shuts the dock (mocks/page.tsx)
      (base.beforeEach as (() => void) | undefined)?.();
      if (chat !== undefined) {
        localStorage.setItem(PANEL_KEYS.open, JSON.stringify({ open: true }));
        sessionStorage.setItem(
          PANEL_KEYS.chat,
          // Variants is Vireo's page: its setup comes first
          JSON.stringify({ setup: "vireo", for: "Vireo", chats: { vireo: chat } }),
        );
      }
    },
    parameters: {
      ...base.parameters,
      msw: [
        ...fakeRelay({
          tape: [],
          setups: SETUPS,
          stored: [
            {
              session: STORED,
              at: "2026-11-04T23:01:40Z",
              title: "Bakery buyers",
              frames: HISTORY,
            },
          ],
        }),
        ...(base.parameters?.msw ?? []),
      ],
    },
  };
};
