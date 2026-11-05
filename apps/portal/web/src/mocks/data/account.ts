/**
 * Account pages' reads and writes for stories (`../../modules/account/`): People, Social, Mail,
 * and a person's access. The lists live in a store the writes
 * change, so a story sees a row go. `forgetAccount()` puts it back before each story, and
 * `ACCOUNT_CALLS` keeps the writes sent, in order. Synthetic data only.
 */

import type { MailPageView } from "@wren/starling-email/access/console";
import type { SocialPageView } from "@wren/starling-inbound/connect";
import type { Answers } from "../api.js";
import { ANSWERS } from "./index.js";
import { ago } from "./shell.js";

/** The writes the pages sent since the last `forgetAccount()`, in order. */
export const ACCOUNT_CALLS: { path: string; body: Record<string, unknown> }[] = [];

type Reply = (body: Record<string, unknown>) => unknown;
/** An answer that keeps the call it got. */
const keep =
  (path: string, out: Reply): Reply =>
  (body) => {
    ACCOUNT_CALLS.push({ path, body });
    return out(body);
  };

const MEMBERS = () => [
  {
    email: "owner@acme.example",
    role: "owner",
    invitedBy: null,
    invitedAt: ago(120),
    lastSeenAt: ago(0.1),
  },
  {
    email: "sam@acme.example",
    role: "member",
    invitedBy: "owner@acme.example",
    invitedAt: ago(30),
    lastSeenAt: ago(2),
  },
  {
    email: "pat@acme.example",
    role: "viewer",
    invitedBy: "owner@acme.example",
    invitedAt: ago(10),
    lastSeenAt: null,
  },
];

const MAILBOXES = () => [
  {
    id: 11,
    address: "owner@acme.example",
    provider: "google" as const,
    personal: false,
    want: "read" as const,
    state: "read_send" as const,
    blocking: null,
    next: null,
    may: { connectSend: true, connectRead: true },
    org: null,
    connectedAt: ago(20),
    checkedAt: ago(1),
  },
  {
    id: 12,
    address: "sales@acme.example",
    provider: "google" as const,
    personal: false,
    want: "read" as const,
    state: "waiting_admin" as const,
    blocking: "Your Google admin has not trusted Wren's app yet.",
    next: "Your admin pastes the app ID into Google admin.",
    may: { connectSend: true, connectRead: true },
    org: null,
    connectedAt: null,
    checkedAt: null,
  },
  {
    id: 13,
    address: "pat@acme.example",
    provider: "google" as const,
    personal: false,
    want: "send" as const,
    state: "broken" as const,
    blocking: "Google stopped the sign-in.",
    next: "Connect it again.",
    may: { connectSend: true, connectRead: false },
    org: null,
    connectedAt: ago(40),
    checkedAt: ago(2),
  },
];

const CONNECTION = (id: number, handle: string, name: string, extra = {}) => ({
  id,
  name,
  handle,
  avatarUrl: null,
  state: "connected" as const,
  why: null,
  connectedAt: ago(20),
  checkedAt: ago(1),
  expiresAt: null,
  expiring: false,
  ...extra,
});
const PLATFORM = {
  selfServe: "Connect it here with one sign-in.",
  forYou: "We can connect it for you.",
  dms: true,
  comments: true,
  blocking: null,
  today: null,
  may: { connect: true },
};
const SOCIAL = (): Extract<SocialPageView, { wren: false }> => ({
  owner: { id: "acme", name: "Acme Plumbing" },
  wren: false,
  mayAct: true,
  apps: { meta: true, linkedin: true, linkedin_pages: true, google: true, x: true, tiktok: true },
  platforms: [
    {
      ...PLATFORM,
      platform: "linkedin",
      label: "LinkedIn",
      state: "connected",
      connections: [
        CONNECTION(21, "acme-plumbing", "Acme Plumbing"),
        CONNECTION(22, "sam-rivera", "Sam Rivera", {
          state: "broken",
          why: "LinkedIn stopped the sign-in.",
        }),
      ],
    },
    {
      ...PLATFORM,
      platform: "tiktok",
      label: "TikTok",
      state: "connected",
      connections: [
        CONNECTION(23, "acmepipes", "Acme Pipes", {
          numbers: {
            followers: 1280,
            likes: 20450,
            videos: 2,
            recent: [
              {
                id: "v1",
                title: "Fix a dripping tap in two minutes",
                views: 1800,
                likes: 80,
                comments: 3,
                url: "https://www.tiktok.example/@acmepipes/video/1",
                cover: null,
                postedAt: ago(3),
              },
              {
                id: "v2",
                title: "Why your boiler clicks",
                views: 940,
                likes: 41,
                comments: 1,
                url: null,
                cover: null,
                postedAt: ago(9),
              },
            ],
            gaps: [],
            asOf: ago(0.1),
          },
        }),
      ],
    },
    {
      ...PLATFORM,
      platform: "x",
      label: "X",
      state: "not_connected",
      connections: [],
    },
  ],
});

const MAIL = (): Extract<MailPageView, { wren: false }> => ({
  owner: { id: "acme", name: "Acme Plumbing" },
  wren: false,
  mayAct: true,
  apps: { google: true, microsoft: true },
  keyStore: true,
  googleClientId: "1234.apps.example",
  googleAdminUrl: "https://admin.example.com/apps",
  mailboxes: MAILBOXES(),
  orgs: [],
});

const GRANTS = () => [
  {
    id: 1,
    email: "sam@acme.example",
    what: "Act in Leads on Email.",
    reason: "Covers the winter run.",
    state: "live",
    by: "owner@acme.example",
    at: ago(4),
  },
  {
    id: 2,
    email: "sam@acme.example",
    what: "See every app.",
    reason: null,
    state: "live",
    by: "owner@acme.example",
    at: ago(3),
  },
  {
    id: 3,
    email: "sam@acme.example",
    what: "Run Reactivation.",
    reason: null,
    state: "ended",
    by: "owner@acme.example",
    at: ago(20),
  },
];

const store = {
  members: MEMBERS(),
  mailboxes: MAILBOXES(),
  accounts: SOCIAL().platforms.flatMap((p) => p.connections.map((c) => c.id)),
  grants: GRANTS(),
};

/** Puts the stores and the kept calls back; called before each story. */
export function forgetAccount() {
  ACCOUNT_CALLS.splice(0);
  Object.assign(store, {
    members: MEMBERS(),
    mailboxes: MAILBOXES(),
    accounts: SOCIAL().platforms.flatMap((p) => p.connections.map((c) => c.id)),
    grants: GRANTS(),
  });
}

const page = (rows: object[]) => ({
  record: "",
  view: null,
  rows,
  total: rows.length,
  counts: {},
  next: null,
  totals: {},
});

export const ACCOUNT_ANSWERS: Answers = {
  "delivery/people": () => ({
    people: store.members,
    canManage: true,
    roles: [
      { id: "owner", name: "Owner" },
      { id: "member", name: "Member" },
      { id: "viewer", name: "Viewer" },
    ],
    mail: null,
  }),
  "delivery/remove": keep("delivery/remove", (b) => {
    store.members = store.members.filter((m) => m.email !== b.email);
    return { ok: true };
  }),
  "console/recordsList": (b) => {
    const base = ANSWERS["console/recordsList"] as Reply;
    if (b.record === "access.role")
      return page([{ id: "member", name: "Member", grants: "See every app.\nAct in Leads." }]);
    if (b.record === "access.grant") return page(store.grants);
    return base(b);
  },
  "console/grantEnd": keep("console/grantEnd", (b) => {
    store.grants = store.grants.map((g) => (g.id === b.id ? { ...g, state: "ended" } : g));
    return { ok: true };
  }),

  "social/social": () => {
    const v = SOCIAL();
    return {
      ...v,
      platforms: v.platforms.map((p) => ({
        ...p,
        connections: p.connections.filter((c) => store.accounts.includes(c.id)),
      })),
    };
  },
  "social/check": keep("social/check", () => ({ ok: true })),
  "social/disconnect": keep("social/disconnect", (b) => {
    store.accounts = store.accounts.filter((a) => a !== b.id);
    return { ok: true };
  }),

  "mail/mail": () => ({ ...MAIL(), mailboxes: store.mailboxes }),
  "mail/check": keep("mail/check", () => ({ emits: [] })),
  "delivery/interest": keep("delivery/interest", () => ({ ok: true })),
};
