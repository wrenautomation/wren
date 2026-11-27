/**
 * Redesign › Aerie Tasks (designs/2026-11-26-redesign.md D4): the Board in v116's shape (no Done lane,
 * who acts on each card) and the List with the open task docked on its right (Backlog.md's board).
 * Under 800 px of main the task opens as a sheet. Fake server: `mocks/`.
 */
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";
import { AERIE_BOARD } from "../mocks/data/aerie.js";
import { ADMIN } from "../mocks/data/me.js";
import { pageAt, storyHref } from "../mocks/page.js";
import { docked, LONG, onPhone, PREFS } from "./docked.js";

const meta: Meta = { title: "Aerie Tasks", globals: { look: "raycast" } };
export default meta;

const WAIT = { timeout: 5000 };
const LIST = "/aerie/tasks";
/** title starts: the worst-case look lengthens titles */
const SIGN_UP = /^Move the sign-up form to the new page layout/;
const WEEKLY = /^Write the weekly numbers note/;

const page = (at: string, check: (p: HTMLElement) => Promise<void>, answers = {}): StoryObj =>
  pageAt(at, { me: ADMIN, answers: { ...PREFS, ...answers }, check });

const pane = (p: HTMLElement) => within(p).queryByRole("region", { name: "Task" });
const sheet = () => screen.queryByRole("dialog");
const picked = () => new URL(storyHref(), "http://x").searchParams.get("task");

/** wide: the pane and no sheet; a phone: neither until a pick, then the sheet */
async function docks(p: HTMLElement) {
  await within(p).findAllByText(SIGN_UP, {}, WAIT);
  if (onPhone()) {
    await expect(pane(p)).toBeNull();
    return null;
  }
  const at = await within(p).findByRole("region", { name: "Task" }, WAIT);
  await expect(sheet()).toBeNull();
  return within(at);
}

/** Lanes in v116's order, no Done; each card says who acts. */
export const Board = page(`${LIST}?layout=board`, async (p) => {
  if (onPhone()) {
    // one lane at a time: the strip names the rest, never Done
    const tabs = await within(p).findAllByRole("tab", {}, WAIT);
    await expect(tabs.some((t) => /^Done,/.test(t.getAttribute("aria-label") ?? ""))).toBe(false);
    return;
  }
  await within(p).findAllByText(SIGN_UP, {}, WAIT);
  await expect(p.querySelector('[data-lane="status:Done"]')).toBeNull();
  const card = (id: string) => p.querySelector<HTMLElement>(`a[data-id="${id}"]`);
  await expect(within(card("EX-104") as HTMLElement).getByText("You")).toBeVisible();
  // a dependency still open outranks the rest
  await expect(within(card("EX-106") as HTMLElement).getByText("Waiting")).toBeVisible();
  await expect(within(card("EX-107") as HTMLElement).getByText("Agent")).toBeVisible();
  await expect(within(p).queryByText("acts:agent")).toBeNull();
});

/** No pick: the pane asks for one; ↓ takes the List's first row, in place of the address. */
export const ListNoPick = page(LIST, async (p) => {
  const at = await docks(p);
  if (!at) return;
  await expect(at.getByText("Pick a task to read it here.")).toBeVisible();
  const before = history.length;
  await userEvent.keyboard("{ArrowDown}");
  await waitFor(() => expect(picked()).not.toBeNull(), WAIT);
  await expect(history.length).toBe(before);
  await expect((await at.findAllByRole("heading", {}, WAIT))[0]).toBeVisible();
});

/** A pick reads in the pane; j and k walk the List; a phone opens the sheet. */
export const ListPicked = page(`${LIST}?task=EX-101`, async (p) => {
  const at = await docks(p);
  if (!at) {
    await expect(await screen.findByRole("dialog", {}, WAIT)).toBeVisible();
    return;
  }
  await expect(await at.findByRole("heading", { name: SIGN_UP }, WAIT)).toBeVisible();
  // writes off: no picks in the head
  await expect(at.queryByRole("button", { name: /^Status:/ })).toBeNull();
  await userEvent.keyboard("j");
  await waitFor(() => expect(picked()).not.toBe("EX-101"), WAIT);
  await userEvent.keyboard("k");
  await waitFor(() => expect(picked()).toBe("EX-101"), WAIT);
  await expect(await at.findByRole("heading", { name: SIGN_UP }, WAIT)).toBeVisible();
});

/** The filter leaves the pick out: the pane keeps it; ↓ starts at the List's top. */
export const PickFilteredOut = page(`${LIST}?task=EX-104&status=In+Progress`, async (p) => {
  const at = await docks(p);
  if (!at) return;
  await expect(await at.findByRole("heading", { name: WEEKLY }, WAIT)).toBeVisible();
  await expect(within(p).queryByRole("link", { name: WEEKLY })).toBeNull();
  await userEvent.keyboard("j");
  await waitFor(() => expect(picked()).not.toBe("EX-104"), WAIT);
  await expect(at.queryByRole("heading", { name: WEEKLY })).toBeNull();
});

/** Writes on: the pane's head holds the picks, as the sheet's does. */
export const PickedWrites = page(
  `${LIST}?task=EX-104`,
  async (p) => {
    const at = await docks(p);
    if (!at) return;
    await expect(await at.findByRole("button", { name: /^Status:/ }, WAIT)).toBeVisible();
  },
  { "aerie/board": { ...AERIE_BOARD, writes: true } },
);

/** Anton open takes room from main: the pane or the sheet, never both. */
export const AntonOpen = docked(
  `${LIST}?task=EX-101`,
  async (p) => {
    await within(p).findByText("Anton", {}, LONG);
    await within(p).findAllByText(SIGN_UP, {}, WAIT);
    await waitFor(() => expect(Number(!!pane(p)) + Number(!!sheet())).toBe(1), WAIT);
  },
  null,
);
