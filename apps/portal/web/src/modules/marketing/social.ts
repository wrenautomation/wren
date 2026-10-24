/**
 * Accounts (operator API keys), invites and connects: the social logins' row actions.
 */
import type { Action } from "@wren/ui";
import { said } from "./drafts.js";

/**
 * The operator's API keys on Accounts (designs/2026-10-19-api-keys-as-accounts.md): rotate starts
 * the vendor's mint flow on the Mac, revoke and mark spent act in the vault. A client's own key is
 * rotated where it is kept (Account → Vendors), so these show on operator keys only.
 */
export const ACCOUNT_ACTIONS: Action[] = [
  {
    id: "marketing.keyRotate",
    label: "Rotate",
    handler: "marketing/keyRotate",
    confirm: "Make a new key at the vendor? The run asks in To approve before it signs in.",
    when: { origin: ["vault"], state: ["live", "spent"] },
    done: said("Rotation started: approve it in To approve"),
  },
  {
    id: "marketing.keyRevoke",
    label: "Revoke",
    handler: "marketing/keyRevoke",
    confirm: "Revoke this key here? Revoke the vendor's own copy by hand.",
    when: { origin: ["vault"], state: ["live", "spent"] },
    done: said("Revoked here. Revoke the vendor's copy by hand."),
  },
  {
    id: "marketing.keySpend",
    label: "Mark spent",
    handler: "marketing/keySpend",
    each: true,
    form: [
      {
        field: "until",
        label: "Until",
        type: "date",
        optional: true,
        hint: "The day it works again. The 1st of next month when empty.",
      },
    ],
    when: { origin: ["vault"], state: ["live"] },
    done: said("Marked out of credit"),
  },
];

export const INVITE_ACTIONS: Action[] = [
  {
    id: "marketing.inviteMessage",
    label: "Message",
    icon: "dm",
    handler: "marketing/dmReply",
    confirm: "Send this message?",
    key: "r",
    when: { status: ["accepted"] },
    done: said("Queued. It leaves on the next tick."),
  },
  {
    id: "marketing.inviteRead",
    label: "Mark read",
    icon: "read",
    handler: "marketing/dmRead",
    bulk: true,
    key: "e",
    when: { status: ["accepted"] },
    done: said("Marked read"),
  },
  {
    id: "marketing.inviteWithdraw",
    label: "Withdraw",
    icon: "close",
    handler: "marketing/inviteWithdraw",
    key: "w",
    when: { status: ["pending"] },
    done: said("Withdrawn"),
  },
];

/** An invite the sweep proposed: only his yes sends it, under the day's cap. */
export const CONNECT_ACTIONS: Action[] = [
  {
    id: "marketing.connectApprove",
    label: "Send invite",
    icon: "check",
    handler: "marketing/connectApprove",
    confirm: "Send these invites? They go out under the day's cap.",
    bulk: true,
    key: "a",
    when: { status: ["proposed"] },
    done: said("Approved. They go out on the next ticks."),
  },
  {
    id: "marketing.connectSkip",
    label: "Skip",
    icon: "close",
    handler: "marketing/connectSkip",
    bulk: true,
    key: "e",
    when: { status: ["proposed"] },
    done: said("Skipped. They won't be proposed again."),
  },
];
