import type { Meta, StoryObj } from "@storybook/react-vite";
import type { AccountPick } from "@wren/core/record-accounts";
import type { RecordMeta } from "@wren/core/records";
import { useState } from "react";
import { AccountBadge, AccountFilter, AccountPicker, accountFieldOf } from "./accounts.js";
import {
  ACCOUNT_PICK,
  ACCOUNTS_META,
  EMPTY_PICK,
  NO_ACCOUNTS_META,
  WARNED_PICK,
  WORST_ACCOUNTS_META,
  WORST_PICK,
} from "./fixtures/accounts.js";
import { fakePlace } from "./fixtures/place.js";

export default { title: "Accounts" } satisfies Meta;

type Story = StoryObj;

const label = "text-[12px] text-(--ui-ink-3)";

/** A picker that keeps its own pick, the way a draft saves one. */
function Picker({ pick, busy, unsaved }: { pick: AccountPick; busy?: boolean; unsaved?: boolean }) {
  const [now, setNow] = useState(pick);
  return (
    <AccountPicker
      pick={now}
      busy={busy}
      unsaved={unsaved}
      onPick={(key) => setNow({ ...now, current: key ?? now.fallback, picked: key !== null })}
    />
  );
}

/** Every account's badge, the filter in three states and the picker with a pick and without. */
function Everything({ meta, keys, pick }: { meta: RecordMeta; keys: string[]; pick: AccountPick }) {
  const field = accountFieldOf(meta);
  const first = keys[0] ?? "";
  return (
    <div className="grid max-w-2xl gap-6">
      <div className="grid gap-2">
        <p className={label}>badge</p>
        {keys.map((k) => (
          <AccountBadge key={k} field={field} value={k} />
        ))}
        <AccountBadge field={field} value={first} warn="Misses the place's rule" />
      </div>
      <div className="grid gap-2">
        <p className={label}>filter: none, one, two picked</p>
        <div className="flex flex-wrap gap-2">
          <AccountFilter meta={meta} place={fakePlace()} />
          <AccountFilter meta={meta} place={fakePlace(`on=${first}`)} />
          <AccountFilter meta={meta} place={fakePlace(`on=${keys.slice(0, 2).join(",")}`)} />
        </div>
      </div>
      <div className="grid gap-2">
        <p className={label}>picker</p>
        <Picker pick={pick} />
      </div>
    </div>
  );
}

const KEYS = ["reddit@one", "reddit@two", "linkedin@one"];

/** The badge, the filter and the picker, each live: open the menus and pick. */
export const Default: Story = {
  render: () => <Everything meta={ACCOUNTS_META} keys={KEYS} pick={ACCOUNT_PICK} />,
};

/** No accounts: the filter draws nothing, a badge reads the key, the picker offers the default. */
export const Empty: Story = {
  render: () => (
    <div className="grid max-w-2xl gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <AccountFilter meta={NO_ACCOUNTS_META} place={fakePlace()} />
        <span className={label}>filter: nothing to show</span>
      </div>
      <AccountBadge field={accountFieldOf(NO_ACCOUNTS_META)} value="gone@x" />
      <Picker pick={EMPTY_PICK} />
    </div>
  ),
};

/** The nearest real state: a picker has no loading state of its own, so a save in flight shows it busy. */
export const Loading: Story = {
  render: () => (
    <div className="grid max-w-2xl gap-6">
      <Picker pick={{ ...ACCOUNT_PICK, picked: true }} busy unsaved />
    </div>
  ),
};

/** The nearest real state: a picker has no error state, so a pick that was not saved says "Not saved yet", beside a warned account. */
export const Failed: Story = {
  render: () => (
    <div className="grid max-w-2xl gap-6">
      <Picker pick={WARNED_PICK} unsaved />
    </div>
  ),
};

/** Long names and warnings, a paused account, and eleven accounts to scroll. */
export const WorstCase: Story = {
  render: () => (
    <Everything
      meta={WORST_ACCOUNTS_META}
      keys={["reddit@long", "linkedin@long", "x@non-latin", "x@emoji", "reddit@short"]}
      pick={WORST_PICK}
    />
  ),
};
