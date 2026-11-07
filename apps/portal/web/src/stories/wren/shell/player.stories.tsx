/** The video player: expanded, docked mini, and kept across pages. Fake server: `web/src/mocks/`. */
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { RecordingDetail } from "@wren/calendar/records";
import { HttpResponse, http } from "msw";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { freshStory } from "../../../mocks/api.js";
import { ANSWERS } from "../../../mocks/data/index.js";
import { ADMIN } from "../../../mocks/data/me.js";
import { pageAt } from "../../../mocks/page.js";
import { player } from "../../../player/index.js";

const meta: Meta = { title: "Wren/Shell/Player" };
export default meta;

const FILE = "/story-media/call.wav";

const DETAIL: RecordingDetail = {
  url: FILE,
  model: "claude-haiku-4-5",
  booking: 3,
  notes: {
    summary:
      "A bakery with two shops wants its old wholesale buyers back before the winter run. They have a list of 400 and no time to write to it.",
    needs: ["A first message to the old list", "A reply sorted by who wants a quote"],
    objections: ["Burned by an agency that sent the same text to everyone"],
    next: ["Send the sample of ten messages by Friday", "Book the second call"],
  },
  segments: [
    { start: 0, end: 6, text: "Thanks for making the time. How did the last season go?" },
    { start: 6, end: 19, text: "Busy, then quiet. We lost a few cafes and never asked why." },
    { start: 19, end: 31, text: "That list is where I would start. How many buyers are on it?" },
    { start: 31, end: 40, text: "About four hundred, most of them from before we moved." },
  ],
};

type Reply = (body: Record<string, unknown>) => unknown;

/** The shared records answer, with this recording's detail on it. */
const withDetail: Reply = (body) => {
  const got = (ANSWERS["console/recordsGet"] as Reply)(body) as Record<string, unknown>;
  return body.record === "calendar.recording" ? { ...got, detail: DETAIL } : got;
};

/** One second of silence, so the element loads with no network. */
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

/** The recording's page once its reads are in (`pageAt` waits for them), then `check`. */
const story = (check: (page: HTMLElement) => Promise<void>): StoryObj => {
  const base = pageAt("/today/recordings/1", {
    me: ADMIN,
    // Wren's own records come from the console.
    answers: { "console/recordsGet": withDetail },
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
      msw: [http.get(FILE, () => new HttpResponse(silence())), ...(base.parameters?.msw ?? [])],
    },
  };
};

const DOCK = "Keep playing in the corner";

const media = (root: HTMLElement) => root.ownerDocument.querySelector("video");

const mini = (root: HTMLElement) =>
  within(root.ownerDocument.body).queryByRole("region", { name: "Mini player" });

/** On the recording's page the player plays over the slot: no corner dock. Notes and transcript under it. */
export const Expanded = story(async (canvasElement) => {
  const page = within(canvasElement);
  await page.findByRole("button", { name: DOCK });
  await waitFor(() => expect(media(canvasElement)).not.toBeNull());
  await expect(mini(canvasElement)).toBeNull();
  await expect(page.getByText("What they need")).toBeVisible();
  await expect(page.getByText("Transcript")).toBeVisible();
});

/** Keep playing in the corner: the same player, docked bottom-right, with Expand and Close. */
export const MiniDocked = story(async (canvasElement) => {
  const page = within(canvasElement);
  await userEvent.click(await page.findByRole("button", { name: DOCK }));
  const dock = await within(canvasElement.ownerDocument.body).findByRole("region", {
    name: "Mini player",
  });
  await expect(within(dock).getByRole("button", { name: "Expand" })).toBeVisible();
  await expect(within(dock).getByRole("button", { name: "Close" })).toBeVisible();
  await expect(dock.querySelector("video")).not.toBeNull();
});

/** Leave the page: the same element goes on in the dock, and Expand brings the recording's page back. */
export const NavigationSurvives = story(async (canvasElement) => {
  const page = within(canvasElement);
  await page.findByRole("button", { name: DOCK });
  await waitFor(() => expect(media(canvasElement)).not.toBeNull());
  const el = media(canvasElement);
  // Out by the page's own way back: a phone's bar shows only that once it knows the record.
  const out = page
    .getAllByRole("link")
    .find((a) => /^\/today(?!\/recordings\/)/.test(a.getAttribute("href") ?? ""));
  if (!out) throw new Error("no link out of the recording's page");
  await userEvent.click(out);
  const dock = await within(canvasElement.ownerDocument.body).findByRole("region", {
    name: "Mini player",
  });
  await expect(dock.querySelector("video")).toBe(el);
  await expect(el?.isConnected).toBe(true);
  await userEvent.click(within(dock).getByRole("button", { name: "Expand" }));
  await page.findByRole("button", { name: DOCK });
  await expect(media(canvasElement)).toBe(el);
  await expect(mini(canvasElement)).toBeNull();
});
