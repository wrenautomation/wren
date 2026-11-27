/**
 * Redesign › Anton: the agent docked beside the page under pills (designs/2026-11-26-redesign.md
 * D3): a circle at the lower right opens a card on the wallpaper, its head names what is open.
 */
import type { Meta } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { docked, LONG, onPhone, STORED } from "./docked.js";

const meta: Meta = { title: "Anton", globals: { look: "raycast" } };
export default meta;

/** Shut: the circle; a click opens Anton on this page, close hands focus back to the circle. */
export const Shut = docked("/variants", async (page) => {
  if (onPhone()) return;
  const c = within(page);
  const circle = await c.findByRole("button", { name: "Agent" }, LONG);
  await userEvent.click(circle);
  await c.findByText("Anton", {}, LONG);
  await c.findByPlaceholderText(/^Ask about /, {}, LONG);
  await userEvent.click(await c.findByRole("button", { name: /^Close (agent|anton)$/i }, LONG));
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
