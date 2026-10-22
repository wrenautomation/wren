/**
 * Learn's lists as `Rows` on the fake server: Today's new items, the SOP changes on Home, search
 * hits, Sources by kind (an alert pick, Stop following) and Find someone to follow (Follow).
 * `pnpm --filter @wren/portal storybook`.
 */
import type { Meta } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { ADMIN } from "./mocks/data/me.js";
import { pageAt } from "./mocks/page.js";

const meta: Meta = { title: "Pages/Learn" };
export default meta;

const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

/** The writes the page sent, newest last. */
const SENT: { path: string; body: Record<string, unknown> }[] = [];
const echo =
  (path: string, out: unknown = {}) =>
  (body: Record<string, unknown>) => {
    SENT.push({ path, body });
    return out;
  };
const sent = (path: string) => SENT.filter((c) => c.path === path);

const line = (id: number, title: string, over: Record<string, unknown> = {}) => ({
  id,
  title,
  type: "youtube",
  url: `https://example.com/learn/${id}`,
  source: "Trades Growth",
  score: 8,
  line: "A clear script for a first text.",
  told: "bell",
  read: false,
  pick: "worth",
  at: ago(0.2),
  ...over,
});

const TODAY = {
  since: ago(1),
  total: 3,
  held: 1,
  items: [
    line(1, "Five ways to win back old customers"),
    line(2, "A quote that closes", { told: "digest", score: 6, read: true, pick: null }),
    line(3, "Unscored note", { score: null, told: null, line: null, pick: null }),
  ],
};

const ALERTS = { saved: "top", perHour: 3, mail: { on: false, may: true, to: "me@example.com" } };

/** Today's new items: a row each, its bell state beside it, a held count above. */
export const Today = pageAt("/learn/today", {
  me: ADMIN,
  answers: { "learn/today": TODAY, "learn/alerts": ALERTS },
  check: async (page) => {
    const ui = within(page);
    const link = await ui.findByRole("link", { name: "Five ways to win back old customers" });
    await expect(link).toHaveAttribute("href", "/learn/items/1");
    await expect(ui.getByRole("link", { name: "A quote that closes" })).toBeVisible();
    await expect(ui.getByRole("link", { name: "Unscored note" })).toBeVisible();
    // The bell state reads in words, not only in colour (a phone row shows one column).
    await expect((await ui.findAllByText(/^(Rang|Held)$/)).length).toBeGreaterThan(0);
    await expect(ui.getByText(/1 held back from your bell/)).toBeVisible();
    // Not the busy ring: a settled first load leaves no status behind.
    await expect(ui.queryByRole("status", { name: "Loading" })).toBeNull();
  },
});

/** Home's SOP changes: a row each with its state. */
export const HomeSops = pageAt("/learn", {
  me: ADMIN,
  answers: {
    "learn/home": {
      shelves: [],
      continue: [],
      top: [],
      sops: [
        {
          id: 1,
          sop: "Cold email follow-up",
          state: "added",
          error: null,
          itemId: 7,
          title: "A follow-up that gets a reply",
          type: "youtube",
          at: ago(0.5),
        },
        {
          id: 2,
          sop: "Quote call",
          state: "failed",
          error: "Not enough to add",
          itemId: 8,
          title: "Quoting on the phone",
          type: "blog",
          at: ago(1),
        },
      ],
    },
  },
  check: async (page) => {
    const ui = within(page);
    const link = await ui.findByRole("link", { name: "A follow-up that gets a reply" });
    await expect(link).toHaveAttribute("href", "/learn/items/7");
    await expect(ui.getByRole("link", { name: "Quoting on the phone" })).toBeVisible();
    await expect((await ui.findAllByText(/Cold email follow-up/)).length).toBeGreaterThan(0);
  },
});

const HITS = {
  hits: [
    {
      id: 11,
      title: "Booking more calls from old leads",
      url: "https://example.com/learn/11",
      kind: "youtube",
      source: "Trades Growth",
      score: 9,
      at: ago(2),
      snippet: "text every «old customer» once a quarter",
    },
    {
      id: 12,
      title: "Spring promo ideas",
      url: "https://example.com/learn/12",
      kind: "blog",
      source: "Site Notes",
      score: null,
      at: ago(6),
      snippet: "ask for the «old customer» review",
    },
  ],
};

/** Search hits: the title links to the item, the match shows marked under it. */
export const Search = pageAt("/learn/search?q=old%20customer", {
  me: ADMIN,
  answers: { "learn/search": HITS },
  check: async (page) => {
    const ui = within(page);
    const link = await ui.findByRole("link", { name: "Booking more calls from old leads" });
    await expect(link).toHaveAttribute("href", "/learn/items/11");
    await expect(ui.getByRole("link", { name: "Spring promo ideas" })).toBeVisible();
    await expect((await ui.findAllByText("old customer", { exact: false })).length).toBeGreaterThan(
      0,
    );
  },
});

const src = (id: number, name: string, kind: string, over: Record<string, unknown> = {}) => ({
  id,
  name,
  kind,
  avatar: null,
  url: `https://video.example.com/@${id}`,
  page: null,
  tell: "top",
  alert: null,
  failure: null,
  stopped: false,
  fetchedAt: ago(0.1),
  items: 3,
  fresh: 1,
  top: 8,
  last: ago(0.2),
  ...over,
});

const SOURCES = {
  may: true,
  kinds: [
    { kind: "youtube", sources: [src(1, "Trades Growth", "youtube")] },
    { kind: "blog", sources: [src(2, "Site Notes", "blog", { failure: "Feed moved" })] },
  ],
};

const SOURCE_WRITES = {
  "learn/alertPick": echo("alertPick"),
  "learn/tell": echo("tell"),
  "learn/unfollow": echo("unfollow"),
};

/** Sources by kind: a fold each, a row per source with its alert pick. */
export const Sources = pageAt("/learn/sources", {
  me: ADMIN,
  answers: { "learn/sources": SOURCES, ...SOURCE_WRITES },
  check: async (page) => {
    const ui = within(page);
    const link = await ui.findByRole("link", { name: "Trades Growth" });
    await expect(link).toHaveAttribute("href", "/learn/items?in=s1");
    await expect(ui.getByRole("link", { name: "Site Notes" })).toBeVisible();
    await expect(ui.getByText(/Last read failed: Feed moved/)).toBeVisible();
    // A fold hides its kind's sources and shows them again.
    const fold = await ui.findByRole("button", { name: /^Blog/ });
    await expect(fold).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(fold);
    await waitFor(() => expect(ui.queryByRole("link", { name: "Site Notes" })).toBeNull());
    await expect(ui.getByRole("link", { name: "Trades Growth" })).toBeVisible();
    await userEvent.click(fold);
    await expect(await ui.findByRole("link", { name: "Site Notes" })).toBeVisible();
  },
});

/** Two picks on two rows, one after the other fast: each saves its own source with its own value. */
export const SourcesPickTwoFast = pageAt("/learn/sources", {
  me: ADMIN,
  answers: { "learn/sources": SOURCES, ...SOURCE_WRITES },
  check: async (page) => {
    const ui = within(page);
    SENT.length = 0;
    const one = await ui.findByRole("combobox", { name: "Your alerts for Trades Growth" });
    const two = await ui.findByRole("combobox", { name: "Your alerts for Site Notes" });
    await userEvent.selectOptions(one, "every");
    await userEvent.selectOptions(two, "off");
    await waitFor(() => expect(sent("alertPick")).toHaveLength(2));
    const bodies = sent("alertPick").map((c) => c.body);
    expect(bodies).toContainEqual(expect.objectContaining({ source: "1", pick: "every" }));
    expect(bodies).toContainEqual(expect.objectContaining({ source: "2", pick: "off" }));
    // Each row keeps its own pick.
    await expect(one).toHaveValue("every");
    await expect(two).toHaveValue("off");
  },
});

/** Stop following asks first, sends one stop, and a second press while it is out sends nothing. */
export const SourcesStop = pageAt("/learn/sources", {
  me: ADMIN,
  answers: { "learn/sources": SOURCES, ...SOURCE_WRITES },
  check: async (page) => {
    const ui = within(page);
    SENT.length = 0;
    const stops = await ui.findAllByRole("button", { name: "Stop following" });
    await userEvent.click(stops[0] as HTMLElement);
    const dialog = await within(document.body).findByRole("dialog");
    await expect(within(dialog).getByText("Stop following Trades Growth?")).toBeVisible();
    // Nothing is sent before the answer.
    expect(sent("unfollow")).toHaveLength(0);
    const confirm = within(dialog).getByRole("button", { name: "Stop following" });
    await userEvent.dblClick(confirm);
    await waitFor(() => expect(sent("unfollow")).toHaveLength(1));
    expect(sent("unfollow")[0]?.body).toMatchObject({ ids: ["1"] });
    // The other row's stop is its own: one more, for its source.
    await waitFor(() => expect(within(document.body).queryByRole("dialog")).toBeNull());
    const next = await ui.findAllByRole("button", { name: "Stop following" });
    await userEvent.click(next[next.length - 1] as HTMLElement);
    const second = await within(document.body).findByRole("dialog");
    await userEvent.click(within(second).getByRole("button", { name: "Keep it" }));
    await waitFor(() => expect(within(document.body).queryByRole("dialog")).toBeNull());
    expect(sent("unfollow")).toHaveLength(1);
  },
});

const PEOPLE = {
  hits: [
    {
      site: "youtube",
      handle: "@tradesgrowth",
      name: "Trades Growth",
      url: "https://video.example.com/@tradesgrowth",
      follow: "https://video.example.com/@tradesgrowth",
      about: "Growth for trade shops",
      followers: 12400,
      avatar: null,
      followed: false,
    },
    {
      site: "youtube",
      handle: "@shopowner",
      name: "Shop Owner Daily",
      url: "https://video.example.com/@shopowner",
      follow: "https://video.example.com/@shopowner",
      about: null,
      followers: null,
      avatar: null,
      followed: false,
    },
    {
      site: "reddit",
      handle: "r/smallbusiness",
      name: "r/smallbusiness",
      url: "https://forum.example.com/r/smallbusiness",
      follow: "https://forum.example.com/r/smallbusiness",
      about: "Owners talking shop",
      followers: 900000,
      avatar: null,
      followed: false,
    },
  ],
  failed: [],
};

const FIND_ANSWERS = {
  "learn/sources": { may: true, kinds: [] },
  "console/call:ReachDesk.findCreators": PEOPLE,
  "console/call:ReachDesk.paste": echo("paste", { said: "Added to your follows." }),
  "learn/follow": (body: Record<string, unknown>) => {
    SENT.push({ path: "follow", body });
    return { id: "9", name: "Followed", kind: "youtube", items: 0 };
  },
};

async function search(page: HTMLElement) {
  const ui = within(page);
  const box = await ui.findByRole("textbox", { name: "Find people to follow" });
  await userEvent.type(box, "trades");
  await userEvent.click(ui.getByRole("button", { name: /^Search$/ }));
  await ui.findByRole("button", { name: "Follow Trades Growth" });
  return ui;
}

/** Find: the people by site, each a row with a Follow button; a fold hides a site's people. */
export const FindPeople = pageAt("/learn/sources", {
  me: ADMIN,
  answers: FIND_ANSWERS,
  check: async (page) => {
    const ui = await search(page);
    await expect(ui.getByRole("button", { name: "Follow r/smallbusiness" })).toBeVisible();
    // The site chips above share the names: the fold is the one that opens and shuts.
    const fold = ui
      .getAllByRole("button", { name: /^Reddit/ })
      .find((b) => b.hasAttribute("aria-expanded")) as HTMLElement;
    await userEvent.click(fold);
    await waitFor(() =>
      expect(ui.queryByRole("button", { name: "Follow r/smallbusiness" })).toBeNull(),
    );
    await expect(ui.getByRole("button", { name: "Follow Trades Growth" })).toBeVisible();
  },
});

/** A double press on one row sends one follow; a quick press on the next row sends its own. */
export const FindFollowFast = pageAt("/learn/sources", {
  me: ADMIN,
  answers: FIND_ANSWERS,
  check: async (page) => {
    const ui = await search(page);
    SENT.length = 0;
    await userEvent.dblClick(ui.getByRole("button", { name: "Follow Trades Growth" }));
    await userEvent.click(ui.getByRole("button", { name: "Follow Shop Owner Daily" }));
    await waitFor(() => expect(sent("follow")).toHaveLength(2));
    const urls = sent("follow").map((c) => c.body.url);
    expect(urls).toEqual([
      "https://video.example.com/@tradesgrowth",
      "https://video.example.com/@shopowner",
    ]);
    await expect(await ui.findByRole("button", { name: "Following Trades Growth" })).toBeDisabled();
    // Done reads as done: that row's button stays off, and no third follow went out.
    expect(sent("follow")).toHaveLength(2);
  },
});
