/** Fixtures for `accounts.tsx`: a record type with an account field, the accounts, and the picker's options. */
import type { AccountPick, RecordAccount } from "@wren/core/record-accounts";
import { setRecordAccounts } from "@wren/core/record-accounts";
import type { RecordMeta } from "@wren/core/records";
import { accountField, defineRecord, metaOf, name, status } from "@wren/core/records";
import { WORST } from "./worst.js";

const TWO = {
  a: { label: "A", tone: "neutral" as const },
  b: { label: "B", tone: "neutral" as const },
};

/** Two Reddit accounts and a LinkedIn page. */
export const ACCOUNTS: RecordAccount[] = [
  { key: "reddit@one", platform: "reddit", label: "u/synthetic_one" },
  { key: "reddit@two", platform: "reddit", label: "u/synthetic_two" },
  { key: "linkedin@one", platform: "linkedin", label: "Synthetic Co" },
];

/** Accounts with the worst names, and enough of them to scroll a menu. */
export const WORST_ACCOUNTS: RecordAccount[] = [
  { key: "reddit@long", platform: "reddit", label: `u/${WORST.email}` },
  { key: "linkedin@long", platform: "linkedin", label: WORST.longCompany },
  { key: "x@non-latin", platform: "x", label: WORST.nonLatin },
  { key: "x@emoji", platform: "x", label: WORST.emoji },
  { key: "reddit@short", platform: "reddit", label: WORST.shortName },
  ...Array.from({ length: 8 }, (_, i) => ({
    key: `reddit@extra${i}`,
    platform: "reddit",
    label: `u/synthetic_extra_${i}`,
  })),
];

/**
 * A record type that declares its account field (or not): the account list is read when the
 * type is built, so each call keeps the accounts it was given.
 */
export const accountsMeta = (declared: boolean, accounts = ACCOUNTS): RecordMeta => {
  setRecordAccounts(accounts);
  return metaOf(
    defineRecord({
      id: "t.sends",
      app: "marketing",
      channel: { field: "platform" },
      name: { one: "send", many: "sends" },
      rows: async () => [],
      key: "id",
      title: "who",
      fields: {
        who: name("Who"),
        platform: status(TWO, "Site"),
        state: status(TWO, "State"),
        on: accountField("On"),
      },
      views: [{ id: "all", label: "All" }],
      ...(declared ? { account: "on" as const } : {}),
    }),
    false,
  );
};

export const ACCOUNTS_META = accountsMeta(true);
/** A type with no account in the system: the filter has nothing to offer. */
export const NO_ACCOUNTS_META = accountsMeta(true, []);
export const WORST_ACCOUNTS_META = accountsMeta(true, WORST_ACCOUNTS);

/** Which account it goes out as: two on one platform, one of them warned. */
export const ACCOUNT_PICK: AccountPick = {
  platform: "reddit",
  current: "reddit@one",
  fallback: "reddit@one",
  picked: false,
  options: [
    { key: "reddit@one", label: "u/synthetic_one", state: "active", warn: null },
    {
      key: "reddit@two",
      label: "u/synthetic_two",
      state: "warming",
      warn: "r/example needs 50 karma, u/synthetic_two has 3",
    },
  ],
};

/** The warned account is the one in use. */
export const WARNED_PICK: AccountPick = {
  ...ACCOUNT_PICK,
  current: "reddit@two",
  picked: true,
};

/** Nothing to pick from: the platform's default login. */
export const EMPTY_PICK: AccountPick = {
  platform: "reddit",
  current: null,
  fallback: null,
  picked: false,
  options: [],
};

/** Long labels, long warnings, a paused account and many options. */
export const WORST_PICK: AccountPick = {
  platform: "reddit",
  current: "reddit@long",
  fallback: "reddit@short",
  picked: true,
  options: [
    {
      key: "reddit@long",
      label: `u/${WORST.email}`,
      state: "paused",
      warn: WORST.longText,
    },
    { key: "reddit@short", label: WORST.shortName, state: "warming", warn: null },
    { key: "reddit@non-latin", label: WORST.nonLatin, state: "active", warn: WORST.url },
    { key: "reddit@emoji", label: WORST.emoji, state: null, warn: null },
    ...Array.from({ length: 8 }, (_, i) => ({
      key: `reddit@extra${i}`,
      label: `u/synthetic_extra_${i}`,
      state: "active",
      warn: null,
    })),
  ],
};
