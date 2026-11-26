/** The card face (designs/2026-11-26-approve-cards.md, D3) on synthetic drafts. */

import type { Meta, StoryObj } from "@storybook/react-vite";
import type { FieldMeta, State, Thumb } from "@wren/core/records";
import type { Row } from "@wren/core/records/serve";
import { expect, within } from "storybook/test";
import type { Action } from "./action.js";
import { CardGrid, CardHead, type CardParts, RecordCard } from "./card-grid.js";
import { TierLabel } from "./records-list.js";
import { RowActions } from "./row-acts.js";

export default {
  title: "Components/Lists/Record card",
  id: "record-card",
} satisfies Meta;

type Story = StoryObj;

const field = (
  key: string,
  label: string,
  kind: FieldMeta["kind"],
  states?: Record<string, State>,
) =>
  ({
    key,
    label,
    kind,
    ...(states ? { states } : {}),
    ops: [],
    sortable: true,
    searchable: false,
    column: undefined,
  }) as unknown as FieldMeta;

const PARTS: CardParts = {
  mark: field("platform", "Site", "status", {
    linkedin: { label: "LinkedIn", tone: "neutral", mark: "linkedin" },
    x: { label: "X", tone: "neutral", mark: "x" },
    youtube: { label: "YouTube", tone: "neutral", mark: "youtube" },
    instagram: { label: "Instagram", tone: "neutral", mark: "instagram" },
  }),
  kind: field("kind", "Kind", "status", {
    post: { label: "Post draft", tone: "neutral" },
    video: { label: "Video to approve", tone: "neutral" },
    reply: { label: "Reply to send", tone: "neutral" },
    broadcast: { label: "Broadcast to send", tone: "neutral" },
    workflow: { label: "Workflow to make live", tone: "neutral" },
  }),
  note: field("held", "Held because", "text"),
  foot: field("sendAt", "Sends", "date"),
  body: field("body", "Words", "prose"),
  media: "wide",
};

/** A synthetic poster: soft shapes, no words. */
const poster = (a: string, b: string): Thumb => ({
  kind: "image",
  url: `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="160" height="90" fill="url(#g)"/><circle cx="118" cy="30" r="18" fill="#fff" fill-opacity=".35"/><rect x="18" y="56" width="70" height="8" rx="4" fill="#fff" fill-opacity=".5"/></svg>`,
  )}`,
});

const APPROVE = {
  id: "approve",
  label: "Approve",
  icon: "check",
  handler: "x",
} as unknown as Action;
const EDIT = { id: "edit", label: "Edit", icon: "edit", handler: "x" } as unknown as Action;
const SKIP = { id: "skip", label: "Skip", icon: "archive", handler: "x" } as unknown as Action;

const acts = (title: string) => (
  <RowActions
    title={title}
    main={[APPROVE, EDIT, SKIP]}
    more={[]}
    reply={null}
    busy={false}
    run={() => {}}
    still
    labelled
  />
);

interface Item {
  row: Row;
  thumb?: Thumb;
  wait?: { hours: number; late: boolean };
}

const ITEMS: Item[] = [
  {
    row: {
      id: 1,
      who: "Three things a quote form should never ask",
      platform: "linkedin",
      kind: "post",
      body: "Most quote forms ask for a budget first. That one field cuts replies by a third. Ask what the job is, where it is, and when they need it. The rest can wait for the call.",
    },
    thumb: poster("#c9d6f2", "#efe3f6"),
    wait: { hours: 26, late: false },
  },
  {
    row: {
      id: 2,
      who: "The winter run, in 40 seconds",
      platform: "youtube",
      kind: "video",
      body: "Short cut of the route review. Captions on, music off.",
    },
    thumb: poster("#d8eadf", "#f4efd9"),
    wait: { hours: 3, late: false },
  },
  {
    row: {
      id: 3,
      who: "Ada North",
      platform: "x",
      kind: "reply",
      body: "Thanks Ada. Thursday at 10 works. I'll send the link.",
      held: "The daily reply cap is reached; it goes first tomorrow.",
      sendAt: "2026-11-27T10:30:00Z",
    },
    wait: { hours: 50, late: true },
  },
  {
    row: {
      id: 4,
      who: "Spring check-in for past customers",
      platform: null,
      kind: "workflow",
      body: "Three steps: a text on day one, an email on day three, a call task on day five.",
    },
    wait: { hours: 8, late: false },
  },
];

const LONG: Item = {
  row: {
    id: 5,
    who: "A very long title that wraps over several lines so the card grows taller instead of cutting the words off at the edge",
    platform: "instagram",
    kind: "post",
    body: "Line one of a long caption.\n\nA second paragraph that runs on and on, with a link like https://example.com/a-very-long-path/that-has-no-spaces-in-it-at-all and more words after it, so the whole text shows and nothing is cut.\n\nA third paragraph closes it.",
  },
  thumb: poster("#f2d9cf", "#e6e0f5"),
  wait: { hours: 312, late: true },
};

const card = (
  it: Item,
  i: number,
  o: Partial<{ cursor: boolean; open: boolean; picked: boolean; any: boolean; going: string }> = {},
) => (
  <RecordCard
    key={String(it.row.id)}
    row={it.row}
    index={i}
    parts={PARTS}
    title={String(it.row.who)}
    href={`#${it.row.id}`}
    thumb={it.thumb}
    pending={false}
    wait={it.wait ?? null}
    quiet={false}
    cursor={!!o.cursor}
    open={!!o.open}
    picked={!!o.picked}
    anyPicked={!!o.any || !!o.picked}
    going={o.going}
    changed={false}
    onPick={() => {}}
    onOpen={() => {}}
    onSettled={() => {}}
    actions={acts(String(it.row.who))}
  />
);

/** Each kind of item: a draft with its poster, a video, a held reply, a workflow with no site. */
export const Kinds: Story = {
  render: () => (
    <div className="max-w-5xl">
      <CardGrid label="items to approve" loading={false}>
        <CardHead>
          <TierLabel needs n={4} />
        </CardHead>
        {ITEMS.map((it, i) => card(it, i))}
      </CardGrid>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const view = within(canvasElement);
    // Approve is a word button; the rest stay icons.
    await expect(view.getAllByRole("button", { name: "Approve" })).toHaveLength(4);
    // No site, no mark: the workflow's top line has its kind only.
    await expect(view.getByText("Workflow to make live")).toBeVisible();
    await expect(view.getByText("Sends")).toBeVisible();
  },
};

/** The marks a card takes: the key cursor, open, picked, and an optimistic Approve at work. */
export const States: Story = {
  render: () => (
    <div className="max-w-5xl">
      <CardGrid label="items to approve" loading={false}>
        {card(ITEMS[0] as Item, 0, { cursor: true })}
        {card(ITEMS[1] as Item, 1, { open: true })}
        {card(ITEMS[2] as Item, 2, { picked: true })}
        {card(ITEMS[3] as Item, 3, { any: true, going: "Approving" })}
      </CardGrid>
    </div>
  ),
};

/** Long words: the card grows, the text is whole, a late wait reads amber. */
export const WorstCase: Story = {
  render: () => (
    <div className="max-w-5xl">
      <CardGrid label="items to approve" loading={false}>
        {card(LONG, 0)}
        {card(ITEMS[1] as Item, 1)}
        {card(ITEMS[3] as Item, 2)}
      </CardGrid>
    </div>
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/A third paragraph closes it/)).toBeVisible();
  },
};

/** While the rows read: eight quiet cards. */
export const Loading: Story = {
  render: () => (
    <div className="max-w-5xl">
      <CardGrid label="items to approve" loading>
        {null}
      </CardGrid>
    </div>
  ),
};
