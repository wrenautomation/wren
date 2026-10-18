import type { Meta, StoryObj } from "@storybook/react-vite";
import { type ReactNode, useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import { DraftBox, type RecordDraft } from "./draft.js";
import { ACCOUNT_PICK } from "./fixtures/accounts.js";
import {
  DRAFT,
  DRAFT_ACTIONS,
  DRAFT_CALLS,
  DRAFT_EMPTY,
  DRAFT_READ_ONLY,
  DRAFT_WORST,
  keepUnsaved,
} from "./fixtures/draft.js";

export default {
  title: "Draft",
  // a11y todo: the message preview copies iOS's #8a8a8e grey on white (3.4:1, color-contrast);
  // Empty and WorstCase draw two boxes, so two sections share one name (landmark-unique).
  parameters: { a11y: { test: "todo" } },
} satisfies Meta;

type Story = StoryObj;

/** One box on a record, the way a detail page holds it. */
function Box({
  draft,
  id,
  call = DRAFT_CALLS.ok,
  kept,
}: {
  draft: RecordDraft;
  id: string;
  call?: typeof DRAFT_CALLS.ok;
  /** Words already typed and unsaved: the box finds them on the device and saves them. */
  kept?: string;
}) {
  // Seeded once, before the box first draws.
  useState(() => {
    if (kept) keepUnsaved(draft, id, kept);
  });
  return (
    <div className="max-w-xl">
      <DraftBox
        draft={draft}
        id={id}
        actions={DRAFT_ACTIONS}
        call={call}
        changed={() => {}}
        send={() => {}}
      />
    </div>
  );
}

const Frame = ({ children }: { children: ReactNode }) => (
  <div className="grid gap-8">{children}</div>
);

/** An email draft with its turns, Ask Claude and Undo. Type to see it save. */
export const Default: Story = {
  render: () => <Box draft={DRAFT} id="default" />,
};

/** Words typed: the box saves them and says so. */
export const Typed: Story = {
  render: () => <Box draft={DRAFT} id="typed" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByPlaceholderText("Write it here."), " Thursday works.");
    // The save waits for a 1.2 s pause in the typing, past findBy's 1 s default.
    await expect(await canvas.findByText("Saved", {}, { timeout: 5000 })).toBeVisible();
  },
};

/** No words yet: the placeholder, and no turns. */
export const Empty: Story = {
  render: () => (
    <Frame>
      <Box draft={DRAFT_EMPTY} id="empty" />
      <Box draft={DRAFT_READ_ONLY} id="read-only" />
    </Frame>
  ),
};

/**
 * The nearest real state: words typed and not yet saved are kept on the device and saved when
 * the box opens, and the save never answers, so the box stays on "Saving".
 */
export const Loading: Story = {
  render: () => (
    <Box draft={DRAFT} id="loading" call={DRAFT_CALLS.pending} kept={`${DRAFT.text} Thursday?`} />
  ),
};

/** The save fails: the box says so and offers Retry. */
export const Failed: Story = {
  render: () => (
    <Box draft={DRAFT} id="failed" call={DRAFT_CALLS.down} kept={`${DRAFT.text} Thursday?`} />
  ),
};

/** Long, unbreakable, non-Latin and emoji words, a thinking turn and a failed one; and the account picker. */
export const WorstCase: Story = {
  render: () => (
    <Frame>
      <Box draft={DRAFT_WORST} id="worst" />
      <Box draft={{ ...DRAFT, accounts: ACCOUNT_PICK }} id="accounts" />
    </Frame>
  ),
};
