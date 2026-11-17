/**
 * Studio › Inspiration › Add creator (WA-1416 D7): one story per sheet state. Finds: `mocks/data/creator-find.ts`.
 */
import type { Meta } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { refuse } from "../../../mocks/api.js";
import { ADMIN } from "../../../mocks/data/me.js";
import { OUTLIERS_NONE_TRACKED } from "../../../mocks/data/outliers.js";
import { pageAt, tidy } from "../../../mocks/page.js";

const meta: Meta = { title: "Wren/Studio/Add creator" };
export default meta;

const WAIT = { timeout: 5000 };
const sheet = async () => within(await within(document.body).findByRole("dialog", {}, WAIT));
const at = (find: string) => `/studio/inspiration?add=${find}`;

/** The form: name or link, the niche from the address. */
export const Empty = tidy(
  pageAt(`${at("new")}&niche=business`, {
    me: ADMIN,
    check: async () => {
      const s = await sheet();
      await expect(s.getByLabelText("Name or profile link")).toBeVisible();
      await expect(s.getByLabelText("Niche")).toHaveValue("business");
    },
  }),
);

/** From the strip: the "+" face links to the sheet (stories have no router: a click reloads). */
export const FromStrip = tidy(
  pageAt("/studio/inspiration", {
    me: ADMIN,
    check: async (page) => {
      const add = await within(page).findByRole("link", { name: /^Add$/ }, WAIT);
      await expect(add.getAttribute("href")).toMatch(/[?&]add=new/);
    },
  }),
);

/** Nobody tracked: the empty state's action is Add creator. */
export const FromEmpty = tidy(
  pageAt("/studio/inspiration", {
    me: ADMIN,
    answers: { "canon/feed": OUTLIERS_NONE_TRACKED },
    check: async (page) => {
      await expect(
        await within(page).findByRole("button", { name: "Add creator" }, WAIT),
      ).toBeVisible();
    },
  }),
);

/** A link to a post, not a profile: the server's refusal under the field. */
export const NotALink = tidy(
  pageAt(`${at("new")}&niche=business`, {
    me: ADMIN,
    answers: { "canon/creatorFind": () => refuse(400, "Not a profile link") },
    check: async () => {
      const s = await sheet();
      await userEvent.type(s.getByLabelText("Name or profile link"), "https://x.com/a/status/1");
      await userEvent.click(s.getByRole("button", { name: "Find" }));
      await expect(await s.findByRole("alert", {}, WAIT)).toHaveTextContent("Not a profile link");
    },
  }),
);

/** Sent, the Mac has not claimed it. */
export const Waiting = tidy(
  pageAt(at("1"), {
    me: ADMIN,
    check: async () => {
      await expect(await (await sheet()).findByText(/Waits for the Mac/, {}, WAIT)).toBeVisible();
    },
  }),
);

/** Claimed: the step it is on. */
export const Finding = tidy(
  pageAt(at("2"), {
    me: ADMIN,
    check: async () => {
      await expect(
        await (await sheet()).findByText("Picking the accounts: Dana Reyes", {}, WAIT),
      ).toBeVisible();
    },
  }),
);

/**
 * Found: per platform, tracked rows first (Tracked, Reading, a failed read with Remove), the
 * alternate ticked, fan and other person not, "not a profile" counted.
 */
export const Found = tidy(
  pageAt(at("3"), {
    me: ADMIN,
    check: async () => {
      const s = await sheet();
      await expect(await s.findByText(/accounts of Dana Reyes tracked/, {}, WAIT)).toBeVisible();
      await expect(s.getByRole("checkbox", { name: "Dana Reyes Clips" })).toBeChecked();
      await expect(s.getByRole("checkbox", { name: "Daily Dana Reyes" })).not.toBeChecked();
      await expect(s.getByText(/Can't read it: This user's account is private/)).toBeVisible();
      await expect(s.getByText("1 result was not a profile.")).toBeVisible();
      await expect(s.getByRole("button", { name: "Track 1" })).toBeEnabled();
    },
  }),
);

/** Track: the ticked rows go to the server, the ticks clear. */
export const Tracking = tidy(
  pageAt(at("3"), {
    me: ADMIN,
    check: async () => {
      const s = await sheet();
      await userEvent.click(await s.findByRole("checkbox", { name: "Daily Dana Reyes" }, WAIT));
      await userEvent.click(s.getByRole("button", { name: "Track 2" }));
      await waitFor(() => expect(s.getByRole("button", { name: "Track" })).toBeDisabled(), WAIT);
    },
  }),
);

/** Track refused: the reason under the list, the ticks stay. */
export const TrackFailed = tidy(
  pageAt(at("3"), {
    me: ADMIN,
    answers: { "canon/creatorTrack": () => refuse(409, "only a found find takes ticks") },
    check: async () => {
      const s = await sheet();
      await userEvent.click(await s.findByRole("button", { name: "Track 1" }, WAIT));
      await expect(await s.findByRole("alert", {}, WAIT)).toHaveTextContent("only a found find");
      await expect(s.getByRole("button", { name: "Track 1" })).toBeEnabled();
    },
  }),
);

/** Nothing but non-profiles: say so, start over. */
export const NothingFound = tidy(
  pageAt(at("4"), {
    me: ADMIN,
    check: async () => {
      const s = await sheet();
      await expect(await s.findByText(/No accounts found for Zyx Qor/, {}, WAIT)).toBeVisible();
      await expect(s.getByRole("button", { name: "Start over" })).toBeVisible();
    },
  }),
);

/** Failed (an error, or 10 minutes quiet): the reason, Try again. */
export const Failed = tidy(
  pageAt(at("5"), {
    me: ADMIN,
    check: async () => {
      const s = await sheet();
      await expect(await s.findByText(/stopped answering/, {}, WAIT)).toBeVisible();
      await expect(s.getByRole("button", { name: "Try again" })).toBeVisible();
    },
  }),
);

/** Worst case: a very long name, handles and whys wrap inside the sheet. */
export const LongNames = tidy(
  pageAt(at("6"), {
    me: ADMIN,
    check: async () => {
      await expect(await (await sheet()).findAllByText(/Maximiliana/, {}, WAIT)).not.toHaveLength(
        0,
      );
    },
  }),
);
