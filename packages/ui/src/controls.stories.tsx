import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import {
  Button,
  ButtonLink,
  type ButtonTone,
  Check,
  Checks,
  Seg,
  Tag,
  type TagTone,
  Track,
} from "./controls.js";
import { WORST } from "./fixtures/index.js";

export default { title: "Controls" } satisfies Meta;

type Story = StoryObj;

const TONES: ButtonTone[] = ["primary", "secondary", "quiet"];
const TAGS: TagTone[] = ["neutral", "accent", "warn", "green", "bad"];
const row = "flex flex-wrap items-center gap-3";

/** Every tone at every size, and the tags. */
export const Default: Story = {
  render: () => (
    <div className="grid gap-6">
      {(["md", "sm", "dense", "next"] as const).map((size) => (
        <div key={size} className={row}>
          {TONES.map((tone) => (
            <Button key={tone} tone={tone} size={size}>
              {tone} {size}
            </Button>
          ))}
          <Button size={size} icon="mail" arrow>
            With icons
          </Button>
          <ButtonLink href="#controls" size={size} tone="quiet">
            A link
          </ButtonLink>
        </div>
      ))}
      <div className={row}>
        {TAGS.map((tone) => (
          <Tag key={tone} tone={tone} dot={tone !== "neutral"} title={`The ${tone} tag`}>
            {tone}
          </Tag>
        ))}
      </div>
    </div>
  ),
};

/** Nothing to say: a button and a tag with no label still keep their shape. */
export const Empty: Story = {
  render: () => (
    <div className={row}>
      {TONES.map((tone) => (
        <Button key={tone} tone={tone} aria-label={`${tone}, no label`}>
          {WORST.empty}
        </Button>
      ))}
      <Tag>{WORST.empty}</Tag>
    </div>
  ),
};

/** Pressed and running: `busy` keeps it solid with the busy ring after the label. */
export const Loading: Story = {
  render: () => (
    <div className={row}>
      {TONES.map((tone) => (
        <Button key={tone} tone={tone} busy>
          Saving
        </Button>
      ))}
      <Button size="dense" busy>
        Saving
      </Button>
      <Tag busy>Drafting</Tag>
    </div>
  ),
};

/** What went wrong: turned off, and the warn tag. */
export const Failed: Story = {
  render: () => (
    <div className={row}>
      <Button tone="primary" disabled>
        Send
      </Button>
      <Tag tone="warn" dot>
        Failed to send
      </Tag>
    </div>
  ),
};

/** Long, unbreakable, non-Latin and emoji labels in a narrow box. */
export const WorstCase: Story = {
  render: () => (
    <div className="grid max-w-80 grid-cols-1 gap-3">
      <Button tone="primary">{WORST.longLabel}</Button>
      <Button>{WORST.email}</Button>
      <Button tone="quiet">{WORST.nonLatin}</Button>
      <div className={row}>
        <Tag tone="accent">{WORST.emoji}</Tag>
        <Tag tone="green">{WORST.hugeCount.toLocaleString()}</Tag>
        <Tag tone="warn">{WORST.longLabel}</Tag>
        <Tag>{WORST.shortName}</Tag>
      </div>
    </div>
  ),
};

/** The parts of artifact #parts: chips, the switch, a goal and a check list. */
export const Parts: Story = {
  render: function Render() {
    const [view, setView] = useState<"week" | "month" | "year">("week");
    const [done, setDone] = useState({ a: true, b: false, c: false });
    const count = Object.values(done).filter(Boolean).length;
    return (
      <div className="grid max-w-md gap-6">
        <div className={row}>
          <Tag>
            Replies <b>3</b>
          </Tag>
          <Tag tone="accent" busy>
            Drafting
          </Tag>
          <Tag tone="green">Booked</Tag>
          <Tag tone="warn">Waiting</Tag>
          <Tag tone="bad">Bounced</Tag>
        </div>
        <Seg
          label="Range"
          value={view}
          onChange={setView}
          items={[
            { value: "week", label: "Week" },
            { value: "month", label: "Month", busy: view === "month" },
            { value: "year", label: "Year" },
          ]}
        />
        <Seg
          dense
          label="Show"
          value="table"
          onChange={() => {}}
          items={[
            { value: "table", label: "Table" },
            { value: "line", label: "By line" },
          ]}
          className="justify-self-start"
        />
        <Track
          value={count}
          max={3}
          label={
            <>
              This week: <b>{count} of 3</b> done
            </>
          }
          name="This week"
        />
        <Checks>
          <Check
            checked={done.a}
            onChange={(a) => setDone({ ...done, a })}
            note="r/coaching · due today"
          >
            Comment on 5 new threads
          </Check>
          <Check checked={done.b} onChange={(b) => setDone({ ...done, b })} note="due Thu">
            Film this week's video
          </Check>
          <Check checked={done.c} onChange={(c) => setDone({ ...done, c })} note="oldest 6 h">
            Answer 3 replies
          </Check>
        </Checks>
      </div>
    );
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await userEvent.click(c.getByRole("button", { name: "Year" }));
    await expect(c.getByRole("button", { name: "Year" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(c.getByRole("checkbox", { name: /Film this week/ }));
    await expect(c.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "2");
  },
};
