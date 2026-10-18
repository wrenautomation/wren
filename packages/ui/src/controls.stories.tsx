import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button, ButtonLink, type ButtonTone, Tag, type TagTone } from "./controls.js";
import { WORST } from "./fixtures/index.js";

export default { title: "Controls" } satisfies Meta;

type Story = StoryObj;

const TONES: ButtonTone[] = ["primary", "secondary", "quiet"];
const TAGS: TagTone[] = ["neutral", "accent", "warn", "green"];
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

/** Pressed and running: `busy` keeps it solid with a bar under the label. */
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
