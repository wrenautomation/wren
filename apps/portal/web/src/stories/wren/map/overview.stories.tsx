/** The Map as Home: the shape, Today under it, big and phone sizes. Fake server: `web/src/mocks/`. */
import type { Meta, StoryObj } from "@storybook/react-vite";
import { crossingsOf, layoutView } from "@wren/ui/metro";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { TodayTasks } from "../../../map/TodayTasks.js";
import type { Task } from "../../../map/tasks.js";
import { viewOf } from "../../../map/view.js";
import { SHAPE_GRAPH, SHAPE_METRO } from "../../../mocks/data/journeys.js";
import {
  bigAnswers,
  liveShape,
  planAnswers,
  SHAPE_BIG,
  SHAPE_PLAN,
} from "../../../mocks/data/map.js";
import { ADMIN } from "../../../mocks/data/me.js";
import { pageAt } from "../../../mocks/page.js";
import { LATE, mapAt, mapOf, SHARED, station, tools } from "./map-kit.js";

const meta: Meta = { title: "Wren/Map/Overview", globals: { data: "tidy" } };
export default meta;

/**
 * What the map draws on top of something else, by the boxes on screen: a name on a name, a mark,
 * a task chip or a label; a chip on a mark. Empty means calm. A name and the line under it touch
 * on purpose. The layout test checks the same in the scene; this reads what the browser drew.
 */
const onTop = (svg: Element): string[] => {
  const box = (el: Element) => {
    const r = el.getBoundingClientRect();
    return { x0: r.left, x1: r.right, y0: r.top + 2, y1: r.bottom - 2 };
  };
  const meet = (a: ReturnType<typeof box>, b: ReturnType<typeof box>) =>
    a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  const word = (el: Element) => el.textContent?.trim() || el.getAttribute("class") || "?";
  const names = [...svg.querySelectorAll("text.lab, text.sub")];
  const solid = [...svg.querySelectorAll(".mk .b, .pill, .chip, .xp")];
  const out: string[] = [];
  names.forEach((a, i) => {
    for (const b of names.slice(i + 1)) {
      if (a.nextElementSibling === b) continue;
      if (meet(box(a), box(b))) out.push(`"${word(a)}" meets "${word(b)}"`);
    }
    for (const m of solid)
      if (meet(box(a), box(m))) out.push(`"${word(a)}" meets a ${word(m)} mark`);
  });
  const chips = [...svg.querySelectorAll(".pill, .chip")];
  for (const c of chips)
    for (const m of svg.querySelectorAll(".mk .b"))
      if (meet(box(c), box(m))) out.push(`chip "${word(c)}" meets a mark`);
  return out;
};

const calm = async (page: HTMLElement) => {
  await document.fonts.ready;
  const svg = (await waitFor(() => {
    const el = page.querySelector<SVGSVGElement>("svg[role='group']");
    if (!el) throw new Error("The map is not drawn yet.");
    return el;
  }, LATE)) as SVGSVGElement;
  const host = svg.closest<HTMLElement>(".metro-host") as HTMLElement;
  const at = svg.getBoundingClientRect();
  // the frame inside the page's gutter (WA-1144)
  const pad = getComputedStyle(host);
  const [l, r, t, b] = [pad.paddingLeft, pad.paddingRight, pad.paddingTop, pad.paddingBottom].map(
    Number.parseFloat,
  ) as [number, number, number, number];
  const [cw, ch] = [host.clientWidth - l - r, host.clientHeight - t - b];
  // Fill: the whole map in its frame both ways, never above its real size or under 80% of it.
  const [w, h] = [Number(svg.getAttribute("width")), Number(svg.getAttribute("height"))];
  const fill = Math.max(Math.min(cw, ch * (w / h), w), w * 0.8);
  await expect(Math.abs(at.width - fill)).toBeLessThan(2);
  await expect(onTop(svg)).toEqual([]);
  const box = host.getBoundingClientRect();
  const room = { left: box.left + l, right: box.right - r, top: box.top + t };
  const pans = host.scrollWidth > host.clientWidth + 1 || host.scrollHeight > host.clientHeight + 1;
  if (at.width < cw - 2)
    await expect(Math.abs(at.left - room.left - (room.right - at.right))).toBeLessThan(2);
  // Under the title, as in the design language's "Map in the app": never down the middle of an empty frame.
  if (at.height < ch - 2) await expect(Math.abs(at.top - room.top)).toBeLessThan(2);
  return { svg, host, pans };
};

/** Crossings each fake shape draws now. Before the rows were ordered the big shape drew 2; the rest drew the same. */
const CROSSINGS_PINNED = { default: 0, plan: 0, big: 0 };

/** The tracks of `metro` that cross in the layout the page draws. */
const crossingsOfShape = async (metro: Parameters<typeof viewOf>[0]) =>
  crossingsOf(await layoutView(viewOf(metro, { stations: new Map() }, [], new Date())));

const onPhone = () => matchMedia("(max-width: 900px)").matches;

const TASKS: Task[] = [
  {
    id: "reply_to_book",
    name: "Book calls with people who replied",
    owner: "Ada North",
    initials: "AN",
    line: "web",
    lineName: "Webinar",
    at: "Replied",
    waiting: 4,
    medianHours: 6,
    promise: "4h",
    promiseHours: 4,
    late: true,
  },
  {
    id: "post_to_hub",
    name: "Comment on new threads",
    owner: "Cai Moreno",
    initials: "CM",
    line: "yt",
    lineName: "YouTube",
    at: "Post a video",
    waiting: 2,
    medianHours: 3,
    promise: "1d",
    promiseHours: 24,
    late: false,
  },
  {
    id: "book_to_pay",
    name: "Send the contract",
    owner: "Bo Fenwick",
    initials: "BF",
    line: "web",
    lineName: "Webinar",
    at: "Booked",
    waiting: 0,
    medianHours: null,
    promise: "2d",
    promiseHours: 48,
    late: false,
  },
];

export const Place = pageAt("/map", { me: ADMIN });

/**
 * Home for the team: the shape's lines, stations and tracks, the hub with its lead count, and the
 * ghost, a part an older version had that one person still sits on, in a note above the map. Today
 * sits under the Map.
 */
export const Default = mapAt("/", {
  check: async (page) => {
    for (const name of ["Spring list", "Winter ads", "Engaged", "Booked", "Signed"])
      await station(page, name);
    await expect(await within(page).findByRole("heading", { name: "Your business" })).toBeVisible();
    await expect(within(page).getByText(/people on the map now/)).toBeVisible();
    await expect(within(page).getByRole("group", { name: "Fold depth" })).toBeVisible();
    // The hub reads its lead count.
    await expect(await station(page, "First touch")).toHaveAccessibleName("First touch, 18 leads");
    // A calm map: real size, centred or panning, nothing on top of anything, no more crossings.
    await calm(page);
    await expect(await crossingsOfShape(SHAPE_METRO)).toBeLessThanOrEqual(CROSSINGS_PINNED.default);
    // The ghost holds its one person.
    await expect(within(page).getByRole("button", { name: "Open Joined" })).toBeVisible();
    // Today sits under the Map: its tasks and its lists.
    await expect(
      await within(page).findByRole("heading", { name: /^Today · waiting on you/ }),
    ).toBeVisible();
    await expect(await within(page).findByRole("heading", { name: /^Write/ })).toBeInTheDocument();
    if (!onPhone()) {
      const map = within(page).getByRole("region", { name: "Map" });
      // Edge to edge of the window, which sits 10px in from the screen (--ui-frame).
      await expect(Math.round(map.getBoundingClientRect().right)).toBeGreaterThanOrEqual(
        innerWidth - 12,
      );
    }
  },
});

/** Today under the Map: the late task first; a task opens its track. */
export const Today = {
  ...mapAt("/", {
    check: async (page) => {
      await station(page, "Engaged");
      // The tasks sit at the top of Today: the late one first.
      const tasks = await within(page).findAllByRole("button", { name: /waiting at/ });
      await expect(tasks[0]).toHaveTextContent("Booked");
      await expect(tasks[0]).toHaveTextContent(/Late · promise 4h/);
      // A task opens its track panel.
      await userEvent.click(tasks[0] as HTMLElement);
      const panel = await within(page).findByRole("region", { name: "Engaged to Booked, details" });
      await expect(within(panel).getByText("Moved by Ada North")).toBeVisible();
    },
  }),
  globals: { viewport: { value: "desktop" } },
};

/** Dark theme: the Map wears the app's tokens, nothing forces a look of its own. */
export const Dark = {
  ...mapAt("/", {
    check: async (page) => {
      await station(page, "Engaged");
      await expect(within(page).getByRole("region", { name: "Map" })).toBeVisible();
      await calm(page);
    },
  }),
  globals: { theme: "dark" },
};

/** The window is in the address; 7 days is lit and the numbers are the window's. */
export const Window = mapAt("/?window=7", {
  check: async (page) => {
    await station(page, "Engaged");
    await expect((await tools(page)).getByRole("link", { name: "7 days" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  },
});

/** A shape stored as the runtime graph still draws: the server lowers it to the map. */
export const GraphLive = mapAt("/", {
  answers: liveShape(SHARED, SHAPE_GRAPH),
  check: async (page) => {
    for (const name of ["Engaged", "Booked", "Signed"]) await station(page, name);
  },
});

/**
 * A big shape: ten lines and thirty-odd stations. It draws bigger than the page, at real size, so
 * the Map pans inside its frame: scroll to the far corner and the last stations are there.
 */
export const Big = mapAt("/", {
  answers: bigAnswers(SHARED),
  check: async (page) => {
    await station(page, "Retainer");
    const { svg, host, pans } = await calm(page);
    await expect(await crossingsOfShape(SHAPE_BIG)).toBeLessThanOrEqual(CROSSINGS_PINNED.big);
    const inView = (name: string) =>
      waitFor(async () => {
        const [a, b] = [
          (await station(page, name)).getBoundingClientRect(),
          host.getBoundingClientRect(),
        ];
        if (a.right > b.right || a.bottom > b.bottom || a.left < b.left || a.top < b.top)
          throw new Error(`${name} is not in view.`);
      });
    // It opens at the left edge: the first station is in view and nothing is scrolled away.
    await expect(host.scrollLeft).toBe(0);
    await inView("Social");
    // the gutter: the map never meets the frame's edge
    await expect(
      svg.getBoundingClientRect().left - host.getBoundingClientRect().left,
    ).toBeGreaterThanOrEqual(12);
    // Too wide for its 80% floor, it pans: a frame that scrolls takes focus for the arrow keys.
    // Scrolled to the far corner, the last station is in view.
    if (pans) {
      await waitFor(() => expect(host).toHaveAttribute("tabindex", "0"));
      host.scrollTo({ left: host.scrollWidth, top: host.scrollHeight });
    }
    await inView("Retainer");
  },
});

export const Phone = {
  ...mapAt("/", {
    check: async (page) => {
      // A phone opens folded: the whole shape fits, nothing pans (WA-1144).
      await (await mapOf(page)).findByRole("button", { name: /^Signed/ }, LATE);
      await expect((await calm(page)).pans).toBe(false);
      // Opened, real size: the map is wider than the phone, so it pans inside its frame.
      await station(page, "Engaged");
      const { pans } = await calm(page);
      await expect(pans).toBe(true);
      // Today sits under the Map, open.
      await expect(await within(page).findByRole("heading", { name: /^Write/ })).toBeVisible();
    },
  }),
  globals: { viewport: { value: "phone" } },
};

/** A plan after the offer shows as a station, and the loop back from Booked is a track. */
export const Plan = mapAt("/", {
  answers: planAnswers(SHARED),
  check: async (page) => {
    await expect(await station(page, "Standard plan")).toHaveAccessibleName(
      /^Standard plan, 3 now/,
    );
    await calm(page);
    await expect(await crossingsOfShape(SHAPE_PLAN)).toBeLessThanOrEqual(CROSSINGS_PINNED.plan);
  },
});

/** Today's task card: the late task first, hover or focus lights its line, a click opens it. */
export const Tasks: StoryObj<typeof TodayTasks> = {
  args: { tasks: TASKS, onLight: fn(), onOpen: fn() },
  render: (a) => (
    <div className="max-w-[460px] p-4">
      <TodayTasks {...a} />
    </div>
  ),
  play: async ({ canvasElement, args }) => {
    const rows = await within(canvasElement).findAllByRole("button", { name: /waiting at/ });
    await expect(rows).toHaveLength(3);
    await expect(rows[0]).toHaveTextContent("Book calls with people who replied");
    await expect(rows[0]).toHaveTextContent("Webinar · 4 waiting at Replied");
    await expect(rows[0]).toHaveTextContent("Late · promise 4h, median 6h");
    await expect(rows[1]).toHaveTextContent("Promise 1d");
    await userEvent.hover(rows[0] as HTMLElement);
    await expect(args.onLight).toHaveBeenLastCalledWith("web");
    await userEvent.unhover(rows[0] as HTMLElement);
    await expect(args.onLight).toHaveBeenLastCalledWith(null);
    (rows[1] as HTMLElement).focus();
    await expect(args.onLight).toHaveBeenLastCalledWith("yt");
    await userEvent.click(rows[1] as HTMLElement);
    await expect(args.onOpen).toHaveBeenCalledWith("post_to_hub");
  },
};

/** No person track, or none with anyone to act on: the empty line. */
export const NoTasks: StoryObj<typeof TodayTasks> = {
  args: { tasks: [], onLight: fn(), onOpen: fn() },
  render: (a) => (
    <div className="max-w-[460px] p-4">
      <TodayTasks {...a} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText("No tasks waiting.")).toBeVisible();
  },
};

// --- Today ---------------------------------------------------------------------------------------

/** Today says how many shape proposals wait, and links to History on the Drafts tab. */
export const TodayProposals = {
  ...mapAt("/", {
    check: async (page) => {
      await station(page, "Engaged");
      const line = await within(page).findByText("1 shape proposal waits");
      await expect(line.closest("a")).toHaveAttribute("href", "/?history=drafts");
    },
  }),
  globals: { viewport: { value: "desktop" } },
};
