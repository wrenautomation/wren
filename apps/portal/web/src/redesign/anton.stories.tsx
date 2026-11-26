/**
 * Redesign › Anton: the agent docked beside the page under pills (designs/2026-11-26-redesign.md
 * D3): a circle at the lower right opens a card on the wallpaper, its head names what is open.
 */
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import HISTORY from "../mocks/data/agent/history.json";
import SETUPS from "../mocks/data/agent/setups.json";
import { ADMIN } from "../mocks/data/me.js";
import { pageAt } from "../mocks/page.js";
import { fakeRelay } from "../mocks/relay.js";
import { PANEL_KEYS } from "../modules/agent/panel.js";

const meta: Meta = { title: "Anton", globals: { look: "raycast" } };
export default meta;

const PREFS = { "console/prefs": () => ({ display: { sidebar: "top" }, look: "raycast" }) };
const STORED = "00000000-0000-4000-8000-000000000001";
const LONG = { timeout: 30_000 };
const onPhone = () => matchMedia("(max-width: 900px)").matches;

const docked = (
  at: string,
  check: (page: HTMLElement) => Promise<void>,
  /** Open on this chat; `null` a new one; left out, shut. */
  chat?: string | null,
): StoryObj => {
  const base = pageAt(at, { me: ADMIN, answers: PREFS, check, empty: false });
  return {
    ...base,
    beforeEach: () => {
      (base.beforeEach as (() => void) | undefined)?.();
      const clear = () => {
        localStorage.removeItem(PANEL_KEYS.open);
        sessionStorage.removeItem(PANEL_KEYS.chat);
      };
      clear();
      if (chat !== undefined) {
        localStorage.setItem(PANEL_KEYS.open, JSON.stringify({ open: true }));
        sessionStorage.setItem(
          PANEL_KEYS.chat,
          // Variants is Vireo's page: its setup comes first
          JSON.stringify({ setup: "vireo", for: "Vireo", chats: { vireo: chat } }),
        );
      }
      return clear;
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

/** Shut: the circle; a click opens Anton on this page, close hands focus back to the circle. */
export const Shut = docked("/variants", async (page) => {
  if (onPhone()) return;
  const c = within(page);
  const circle = await c.findByRole("button", { name: "Agent" }, LONG);
  await userEvent.click(circle);
  await c.findByText("Anton", {}, LONG);
  await c.findByPlaceholderText(/^Ask about /, {}, LONG);
  await userEvent.click(await c.findByRole("button", { name: /Close/ }, LONG));
  await waitFor(() => expect(document.activeElement).toBe(circle), LONG);
});

/** Open on a stored chat: its name under the head, the person's words in a grey bubble. */
export const OpenChat = docked(
  "/variants",
  async (page) => {
    const c = within(page);
    await c.findByText("Anton", {}, LONG);
    await c.findByText(/A test of the chat page/, {}, LONG);
  },
  STORED,
);

/** Open, empty: head and composer only. */
export const OpenEmpty = docked(
  "/aerie/tasks",
  async (page) => {
    const c = within(page);
    await c.findByText("Anton", {}, LONG);
  },
  null,
);
