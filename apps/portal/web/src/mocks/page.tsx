/**
 * A page story: the whole portal at one address, on the fake server (`./api.ts`). The router runs
 * on a memory history, so links move inside the story and the frame's own address stays.
 */
import type { StoryObj } from "@storybook/react-vite";
import { createMemoryHistory, type RouterHistory } from "@tanstack/react-router";
import { useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import type { Me } from "../api.js";
import { PortalRouter } from "../router.js";
import { type Answers, dataLook, fakeApi, freshStory, type Mode, settled } from "./api.js";
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
  /** Where the page must land, when not at `at` itself (an old address); false: anywhere. */
  lands?: string | false;
  /** False: the page holds no list, so Empty mode has no empty state to check (a form, a setting). */
  empty?: false;
}

/** Words an empty state never says alone (ui-design SV-8): they teach nothing. */
const BARE = /^(nothing here( yet)?|no data|no results|empty)\.?$/i;

/**
 * Empty mode's check (ui-design SV-8): the page did not crash, and shows an empty state that
 * teaches: a line on what will be here and one action that fills it. A state someone else fills
 * (`Empty waits`, Wren for a client) needs no action.
 */
async function emptyTeaches(page: HTMLElement) {
  await expect(within(page).queryByText(/something went wrong/i)).toBeNull();
  const states = await waitFor(() => {
    const all = [...page.querySelectorAll<HTMLElement>("[data-empty]")];
    if (!all.length) {
      const heads = [...page.querySelectorAll("h1, h2")].map((h) => h.textContent?.trim());
      throw new Error(`Empty mode shows no empty state ([data-empty]) under: ${heads.join(" | ")}`);
    }
    return all;
  });
  // an Empty holds its line in a <p>; a bare line tagged data-empty is its own
  const lines = states.map((s) => (s.querySelector("p") ?? s).textContent?.trim() ?? "");
  for (const line of lines)
    if (!line || BARE.test(line))
      throw new Error(`an empty state says "${line}": say what fills it`);
  const acts = states.filter((s) => s.dataset.empty !== "waits");
  if (acts.length && !acts.some((s) => s.querySelector("button, a[href]")))
    throw new Error(`no empty state gives the action that fills it: "${lines.join('" | "')}"`);
}

// the story's own history: the play reads where the router landed
let HISTORY: RouterHistory | null = null;

function Page({ at }: { at: string }) {
  const [history] = useState(() => createMemoryHistory({ initialEntries: [at] }));
  HISTORY = history;
  return <PortalRouter history={history} />;
}

/** Where the story's router stands now: path and query. */
export const storyHref = () => HISTORY?.location.href ?? "";

/** A page the workspace lacks redirects home and still renders: a story there tests the wrong page. */
async function landedAt(want: string) {
  const path = want.split(/[?#]/)[0] ?? "";
  if (path === "/") return;
  await waitFor(() => {
    const now = HISTORY?.location.pathname ?? "";
    if (now !== path && !now.startsWith(`${path}/`))
      throw new Error(`the story asks for ${path} and lands on ${now}`);
  });
}

/** The story for the portal at `at` (`/reactivation/people?status=open`). */
export function pageAt(
  at: string,
  { me = OWNER, answers = {}, mode, check, lands, empty }: PageAt = {},
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
            const bare = dataLook() === "empty";
            // Empty pass (story-tests.ts): a page with no list may route elsewhere when its records go
            if (bare && empty === false) return;
            if (lands !== false) await landedAt(lands ?? at);
            // a failed read shows its error, not an empty state
            if (bare) {
              if (mode === undefined) await emptyTeaches(canvasElement);
              return;
            }
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

/**
 * The check that a list's words stay in their boxes and each row's actions stay in view: no
 * cell's text runs past its box, and each row's last part ends inside the window. A table off a
 * phone, a list of lines on one.
 */
export const rowsFit = async (page: HTMLElement) => {
  const list = await waitFor(() => {
    const l = page.querySelector<HTMLElement>("table[aria-label], ul[aria-label]");
    expect(l?.querySelector("tbody td, li > *")).toBeTruthy();
    return l as HTMLElement;
  });
  // Each cell, and each box that holds words itself: not a screen reader's, not a swipe's.
  const words = (el: HTMLElement) =>
    !el.closest(".sr-only") &&
    [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim());
  const boxes = [
    ...list.querySelectorAll<HTMLElement>("tbody td, thead th, li [data-face] *"),
  ].filter((el) => el.matches("td, th:not(.sr-only)") || words(el));
  for (const box of boxes) {
    if (getComputedStyle(box).display === "inline") continue;
    expect(box.scrollWidth, box.textContent ?? "").toBeLessThanOrEqual(box.clientWidth + 1);
  }
  const right = document.documentElement.clientWidth;
  for (const row of list.querySelectorAll<HTMLElement>(":scope > tbody > tr, :scope > li")) {
    const end = row.lastElementChild?.getBoundingClientRect();
    if (end && end.width > 0) expect(end.right).toBeLessThanOrEqual(right + 1);
  }
};

const startsWith = (s: string) => new RegExp(`^${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);

/**
 * The check that a page shows its heading and its main actions: a page that drops one fails.
 * An action is a button whose name starts with the words (a key hint may follow).
 */
export const shows =
  (heading: string, ...actions: string[]) =>
  async (page: HTMLElement) => {
    const view = within(page);
    // a record's panel and its actions load after the list
    const wait = { timeout: 4000 };
    const [head] = await view.findAllByRole("heading", { name: startsWith(heading) }, wait);
    await waitFor(() => expect(head).toBeVisible());
    // a phone shows the list alone: tap the open row, as a person does, to reach its actions
    const shown = () =>
      actions.every((a) => view.queryAllByRole("button", { name: startsWith(a) }).length);
    if (actions.length && matchMedia("(max-width: 767px)").matches) {
      const row = await waitFor(() => {
        if (shown()) return null;
        const a = page.querySelector<HTMLElement>('li a[aria-current="true"], main li a');
        if (!a) throw new Error("no actions and no row to open");
        return a;
      }, wait);
      if (row) await userEvent.click(row);
    }
    for (const a of actions) await view.findAllByRole("button", { name: startsWith(a) }, wait);
  };

/**
 * A story on the tidy table: its check reads hand-made words (a name, a file name) that Messy mode
 * (the default, `.storybook/preview.tsx`) would stretch. A page's look runs messy.
 */
export const tidy = (s: StoryObj): StoryObj => ({ ...s, globals: { ...s.globals, data: "tidy" } });
