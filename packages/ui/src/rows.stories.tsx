import type { Meta, StoryObj } from "@storybook/react-vite";
import { lateOf } from "@wren/core/promise";
import { useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { type Action, Toasts } from "./action.js";
import { LEAD_META, LEAD_NEEDS, useRecordsDemo } from "./fixtures/records.js";
import { initials } from "./format.js";
import { useNarrow } from "./list-bar.js";
import { lineColor } from "./marks.js";
import { RecordList } from "./records.js";
import { Age, Rows, RowsFoot, type RowsLine, type RowsWait, statsOf } from "./rows.js";

export default { title: "Rows", parameters: { layout: "fullscreen" } } satisfies Meta;

type Story = StoryObj;

interface Person {
  id: string;
  name: string;
  stage: "lead" | "replied" | "booked";
  /** Hours since the person last wrote. */
  hours: number;
  city: string;
}

/** Five synthetic people in three stages. Past 24 hours is late; one is. */
const PEOPLE: Person[] = [
  { id: "p1", name: "Ada North", stage: "lead", hours: 52, city: "Leeds" },
  { id: "p2", name: "Bo Fenwick", stage: "lead", hours: 5, city: "Bristol" },
  { id: "p3", name: "Cai Moreno", stage: "replied", hours: 20, city: "Cardiff" },
  { id: "p4", name: "Dee Okafor", stage: "replied", hours: 1, city: "Leicester" },
  { id: "p5", name: "Eli Park", stage: "booked", hours: 0.5, city: "Derby" },
];

const STAGES = [
  { key: "lead", label: "Lead", line: 0 },
  { key: "replied", label: "Replied", line: 1 },
  { key: "booked", label: "Booked", line: 3 },
] as const;

const NOW = new Date("2026-10-21T12:00:00Z");
const waitOf = (p: Person): RowsWait => ({
  hours: p.hours,
  late: lateOf(new Date(NOW.getTime() - p.hours * 36e5), "24h", NOW),
});

const DONE: Action = { id: "done", label: "Mark done", handler: "demo/done" };

function Host({
  groups = false,
  wait = false,
  page = true,
  opens = true,
}: {
  groups?: boolean;
  wait?: boolean;
  /** False: a title has no page of its own, so it opens the row. */
  page?: boolean;
  /** False: a row opens nothing (a token, a webhook), and ⋯ has no page. */
  opens?: boolean;
}) {
  const narrow = useNarrow();
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [ran, setRan] = useState<string[]>([]);
  const lines: RowsLine<Person>[] = [];
  let index = 0;
  for (const stage of STAGES) {
    if (groups)
      lines.push({
        kind: "group",
        key: stage.key,
        label: stage.label,
        color: lineColor(stage.line),
      });
    for (const p of PEOPLE.filter((x) => x.stage === stage.key))
      lines.push({ kind: "row", key: p.id, index: index++, row: p });
  }
  const waits = PEOPLE.map(waitOf);
  return (
    <div className="p-4 sm:p-6">
      <p className="mb-2 text-[13px]">
        <output>{picked.size ? `${picked.size} selected` : "None selected"}</output>
        {" · "}
        <output data-testid="open">{openId ? `Open ${openId}` : "None open"}</output>
        {" · "}
        <output data-testid="ran">{ran.join(",")}</output>
      </p>
      <div className="overflow-clip rounded-(--ui-radius-panel) bg-(--ui-paper) shadow-(--ui-raise) [&_tbody>tr:last-child]:border-b-0">
        <Rows
          label="people"
          noun="person"
          columns={[
            {
              key: "city",
              label: "City",
              icon: "text",
              // A phone's row shows one property: the wait where the page watches waits.
              phone: !wait,
              cell: (p) => p.city,
            },
            {
              key: "hours",
              label: "Waiting",
              icon: "clock",
              phone: wait,
              cell: (p) => <Age {...waitOf(p)} />,
            },
          ]}
          name={{
            label: "Name",
            icon: "user",
            title: (p) => p.name,
            href: page ? (p) => `#${p.id}` : undefined,
            avatar: (p) => initials(p.name) || null,
          }}
          lines={lines}
          pick={{
            picked: (id) => picked.has(id),
            toggle: (id) =>
              setPicked((was) => {
                const next = new Set(was);
                if (!next.delete(id)) next.add(id);
                return next;
              }),
            all: picked.size === PEOPLE.length,
            some: picked.size > 0 && picked.size < PEOPLE.length,
            toggleAll: () =>
              setPicked(
                picked.size === PEOPLE.length ? new Set() : new Set(PEOPLE.map((p) => p.id)),
              ),
            count: picked.size,
          }}
          act={(p) => ({
            main: [DONE],
            more: [],
            reply: null,
            page: opens ? `#${p.id}` : undefined,
            busy: false,
            run: () => setRan((was) => [...was, p.id]),
          })}
          open={opens ? { id: openId, onOpen: (p) => setOpenId(p.id) } : undefined}
          wait={wait ? waitOf : undefined}
          foot={<RowsFoot stats={statsOf(wait ? waits : PEOPLE.map(() => null))} waits={wait} />}
          group={
            groups
              ? {
                  folded,
                  toggle: (key) =>
                    setFolded((was) => {
                      const next = new Set(was);
                      if (!next.delete(key)) next.add(key);
                      return next;
                    }),
                }
              : undefined
          }
          scroller={null}
          narrow={narrow}
        />
      </div>
    </div>
  );
}

const isWide = (canvasElement: HTMLElement) => !!within(canvasElement).queryByRole("table");

/** People in rows: a gutter box, an avatar and name, two properties, one quiet action, a count. */
export const Default: Story = {
  render: () => <Host />,
};

/** The same rows under three stage folds. */
export const Grouped: Story = {
  render: () => <Host groups />,
};

/** A wait column with a promise: the late row reads amber and the foot counts it. */
export const Late: Story = {
  render: () => <Host wait />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findAllByRole("checkbox", { name: /^Select (?!every)/ });
    // One person is past 24 hours; the foot's "Oldest" word is not a wait.
    const late = canvasElement.querySelectorAll("[data-late]");
    await expect(late).toHaveLength(1);
    await expect(late[0]).toHaveTextContent("2 days");
    await expect(getComputedStyle(late[0] as Element).fontWeight).toBe("650");
    // An on-time wait stays quiet.
    await expect(canvas.getByText("20 hours")).not.toHaveAttribute("data-late");
    // A phone has no foot.
    if (isWide(canvasElement)) {
      const foot = canvas.getByTitle("Of the rows on this page");
      await expect(foot).toHaveTextContent("Count 5");
      await expect(foot).toHaveTextContent("Late 1");
      await expect(foot).toHaveTextContent("Oldest 2 days");
    }
  },
};

/** A row's Open chip and gutter box are hidden at rest and show once the row has focus. */
export const Reveal: Story = {
  render: () => <Host />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findAllByRole("checkbox", { name: /^Select (?!every)/ });
    // A phone has no chip and keeps its box.
    if (!isWide(canvasElement)) return;
    const box = canvas.getByRole("checkbox", { name: "Select Ada North" });
    const row = canvas.getByRole("link", { name: "Ada North" }).closest("tr") as HTMLElement;
    const chip = within(row).getByText("Open");
    await expect(getComputedStyle(box).opacity).toBe("0");
    await expect(getComputedStyle(chip).opacity).toBe("0");
    // A synthetic pointer sets no :hover, so the row's focus stands for it: both share its rule.
    box.focus();
    await waitFor(() => expect(getComputedStyle(box).opacity).toBe("1"));
    await waitFor(() => expect(getComputedStyle(chip).opacity).toBe("1"));
  },
};

/** One box checked: every gutter box shows, and the count says so. */
export const OnePicked: Story = {
  render: () => <Host />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const boxes = await canvas.findAllByRole("checkbox", { name: /^Select (?!every)/ });
    await userEvent.click(boxes[1] as HTMLElement);
    await expect(await canvas.findByText("1 selected")).toBeVisible();
    for (const b of boxes) await expect(getComputedStyle(b).opacity).toBe("1");
  },
};

/** A group head folds: its rows leave, its count stays, and it opens again. */
export const Folds: Story = {
  render: () => <Host groups wait />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const head = await canvas.findByRole("button", { name: /^Lead/ });
    await expect(head).toHaveAttribute("aria-expanded", "true");
    await expect(canvas.getByRole("link", { name: "Ada North" })).toBeVisible();
    await userEvent.click(head);
    await expect(head).toHaveAttribute("aria-expanded", "false");
    await expect(canvas.queryByRole("link", { name: "Ada North" })).toBeNull();
    await expect(canvas.queryByRole("link", { name: "Bo Fenwick" })).toBeNull();
    // The other groups stay open, and the shut head still counts its rows and their oldest wait.
    await expect(canvas.getByRole("link", { name: "Cai Moreno" })).toBeVisible();
    await expect(within(head).getByText("2", { selector: "b" })).toBeVisible();
    await expect(within(head).getByText("2 days")).toHaveAttribute("data-late");
    await userEvent.click(head);
    await expect(head).toHaveAttribute("aria-expanded", "true");
    await expect(await canvas.findByRole("link", { name: "Ada North" })).toBeVisible();
  },
};

/** A press on a row opens it; two quick presses end on the second row. */
export const Opens: Story = {
  render: () => <Host />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findAllByRole("checkbox", { name: /^Select (?!every)/ });
    const open = canvas.getByTestId("open");
    // A press on a row's own ground (its city), not its link or box: those do their own thing.
    await userEvent.click(canvas.getByText("Leeds"));
    await expect(open).toHaveTextContent("Open p1");
    await userEvent.click(canvas.getByText("Bristol"));
    await userEvent.click(canvas.getByText("Cardiff"));
    await expect(open).toHaveTextContent("Open p3");
    // A press on the box opens nothing.
    await userEvent.click(canvas.getByRole("checkbox", { name: "Select Dee Okafor" }));
    await expect(open).toHaveTextContent("Open p3");
  },
};

/** A title with no page of its own is a button: it opens the row, wide and on a phone. */
export const TitleOpens: Story = {
  render: () => <Host page={false} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findAllByRole("checkbox", { name: /^Select (?!every)/ });
    await expect(canvas.queryByRole("link", { name: "Ada North" })).toBeNull();
    const title = canvas.getByRole("button", { name: "Ada North" });
    await expect(title).toHaveAttribute("aria-haspopup", "dialog");
    await userEvent.click(title);
    await expect(canvas.getByTestId("open")).toHaveTextContent("Open p1");
  },
};

/** A row with no page and nothing to open: its title is plain text, with no Open chip. */
export const TitlePlain: Story = {
  render: () => <Host page={false} opens={false} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findAllByRole("checkbox", { name: /^Select (?!every)/ });
    await expect(canvas.queryByRole("button", { name: "Ada North" })).toBeNull();
    await expect(canvas.queryByRole("link", { name: "Ada North" })).toBeNull();
    await expect(canvas.getByText("Ada North").tagName).toBe("SPAN");
    await expect(canvas.queryByRole("button", { name: "Open" })).toBeNull();
  },
};

/** The phone's row: the name, one property and the action. The wide row has the rest. */
export const Phone: Story = {
  render: () => <Host />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findAllByRole("checkbox", { name: /^Select (?!every)/ });
    const li = canvas.getByRole("link", { name: "Ada North" }).closest("li");
    if (isWide(canvasElement) || !li) return;
    const row = within(li);
    await expect(row.getByText("Leeds")).toBeVisible();
    // The second column does not fit beside the name.
    await expect(row.queryByText("2 days")).toBeNull();
    await expect(row.getByRole("button", { name: "Mark done" })).toBeVisible();
  },
};

function Records({ at = "view=waiting" }: { at?: string }) {
  const { api, place, acts } = useRecordsDemo({ at });
  return (
    <div className="p-4 sm:p-6">
      <RecordList record={LEAD_META.id} api={api} place={place} acts={acts} needs={LEAD_NEEDS} />
      <Toasts />
    </div>
  );
}

/** The quiet action sets the row aside with an Undo toast, and Undo brings it back. */
export const QuietAction: Story = {
  render: () => <Records />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const link = await canvas.findByRole("link", { name: "Ada North" });
    const row = link.closest("li, tr") as HTMLElement;
    await userEvent.click(within(row).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(canvas.queryByRole("link", { name: "Ada North" })).toBeNull());
    const undo = await within(document.body).findByRole("button", { name: "Undo" });
    await userEvent.click(undo);
    await expect(await canvas.findByRole("link", { name: "Ada North" })).toBeVisible();
  },
};
