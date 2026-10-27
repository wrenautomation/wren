/**
 * The mini player (bead wa-0m4): one player in the shell, over the page's slot and docked
 * bottom-right when the page goes. An episode of a podcast stands in for every kind; the
 * element is the same one whatever the item. No pixel compare: render, play, axe.
 */
import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { freshStory } from "./mocks/api.js";
import { ADMIN } from "./mocks/data/me.js";
import { pageAt } from "./mocks/page.js";
import type { ItemPage } from "./modules/learn/api.js";
import { player } from "./player/index.js";

const meta: Meta = { title: "Revamp/Player", id: "pages-player" };
export default meta;

const EPISODE: ItemPage = {
  id: 7,
  title: "How a small shop wins back old customers",
  type: "podcast",
  url: "https://example.com/learn/7",
  thumbnail: null,
  duration: 1800,
  chars: 9000,
  source: { id: 2, name: "Trades Growth", kind: "podcast", avatar: null },
  creator: "Trades Growth",
  score: 8,
  summary: "A plain script for a first text.",
  status: "unread",
  state: "ready",
  starred: false,
  pinned: false,
  later: false,
  position: null,
  collectionId: null,
  tags: [],
  saved: false,
  at: "2026-10-18T10:00:00.000Z",
  text: "Start with one service. Name it. Ask one question.",
  transcript: null,
  file: null,
  mediaUrl: "https://media.example.com/episode-7.mp3",
  moments: [],
  why: null,
  changes: [],
  verdict: null,
  failure: null,
  kind: "episode",
  collection: null,
  sops: [],
  breakdown: null,
};

/** One second of silence, so the audio element loads without a network. */
const silence = () => {
  const rate = 8000;
  const data = new Uint8Array(rate).fill(128);
  const head = new DataView(new ArrayBuffer(44));
  const tag = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) head.setUint8(at + i, s.charCodeAt(i));
  };
  tag(0, "RIFF");
  head.setUint32(4, 36 + data.length, true);
  tag(8, "WAVEfmt ");
  head.setUint32(16, 16, true);
  head.setUint16(20, 1, true);
  head.setUint16(22, 1, true);
  head.setUint32(24, rate, true);
  head.setUint32(28, rate, true);
  head.setUint16(32, 1, true);
  head.setUint16(34, 8, true);
  tag(36, "data");
  head.setUint32(40, data.length, true);
  return new Blob([head, data], { type: "audio/wav" });
};

/** The item's page once its reads are in (`pageAt` waits for them), then `check`. */
const story = (check: (page: HTMLElement) => Promise<void>): StoryObj => {
  const base = pageAt("/learn/items/7", {
    me: ADMIN,
    answers: { "learn/item": EPISODE, "learn/open": {}, "learn/seen": {} },
    check,
  });
  return {
    ...base,
    beforeEach: () => {
      // The shell's player outlives a story: put it away first.
      player.close();
      freshStory();
    },
    parameters: {
      ...base.parameters,
      msw: [http.get("/media", () => new HttpResponse(silence())), ...(base.parameters?.msw ?? [])],
    },
  };
};

const audio = (root: HTMLElement) => root.ownerDocument.querySelector("audio");
const mini = (root: HTMLElement) =>
  within(root.ownerDocument.body).queryByRole("region", { name: "Mini player" });

/** On the item's page the player plays over the slot: no corner dock. */
export const Expanded = story(async (canvasElement) => {
  const page = within(canvasElement);
  await page.findByRole("button", { name: "Keep playing in the corner" });
  await waitFor(() => expect(audio(canvasElement)).not.toBeNull());
  await expect(mini(canvasElement)).toBeNull();
});

/** Keep playing in the corner: the same player, docked bottom-right, with Expand and Close. */
export const MiniDocked = story(async (canvasElement) => {
  const page = within(canvasElement);
  await userEvent.click(await page.findByRole("button", { name: "Keep playing in the corner" }));
  const dock = await within(canvasElement.ownerDocument.body).findByRole("region", {
    name: "Mini player",
  });
  await expect(within(dock).getByRole("button", { name: "Expand" })).toBeVisible();
  await expect(within(dock).getByRole("button", { name: "Close" })).toBeVisible();
  await expect(dock.querySelector("audio")).not.toBeNull();
});

/** Leave the page: the same element goes on in the dock, and Expand brings the item's page back. */
export const NavigationSurvives = story(async (canvasElement) => {
  const page = within(canvasElement);
  await page.findByRole("button", { name: "Keep playing in the corner" });
  await waitFor(() => expect(audio(canvasElement)).not.toBeNull());
  const el = audio(canvasElement);
  // Out to Learn's list by the page's own way back: on a wide screen the sidebar's Learn row would
  // do too, but a phone's bar names the app only until it knows the record, then the way back.
  const out = page
    .getAllByRole("link")
    .find((a) => /^\/learn(?!\/items\/)/.test(a.getAttribute("href") ?? ""));
  if (!out) throw new Error("no link out of the item's page");
  await userEvent.click(out);
  const dock = await within(canvasElement.ownerDocument.body).findByRole("region", {
    name: "Mini player",
  });
  await expect(dock.querySelector("audio")).toBe(el);
  await expect(el?.isConnected).toBe(true);
  await userEvent.click(within(dock).getByRole("button", { name: "Expand" }));
  await page.findByRole("button", { name: "Keep playing in the corner" });
  await expect(audio(canvasElement)).toBe(el);
  await expect(mini(canvasElement)).toBeNull();
});
