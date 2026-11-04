/**
 * What the shell reads on every page: the account, its bells and badges. Synthetic data only.
 */
import type { accountsApi } from "@wren/core/accounts/console";
import type { consoleApi } from "@wren/core/console";
import type { DeliveryApi } from "@wren/delivery/restate";
import type { NotesApi } from "@wren/notes/console";
import { serve } from "../api.js";
import { CLIENT } from "./me.js";

/** A time `days` before the stories' fixed clock (`@wren/ui` vitest.setup.ts: 2026-10-17 15:00Z). */
export const ago = (days: number) =>
  new Date(Date.parse("2026-10-17T15:00:00Z") - days * 864e5).toISOString();

const OWNER = { id: CLIENT.id, name: CLIENT.name };

export const SHELL = {
  ...serve<DeliveryApi>("delivery", {
    account: {
      name: CLIENT.name,
      since: ago(120),
      you: { email: "owner@acme.example", role: "owner", wren: false },
      bought: [
        {
          id: 1,
          offerId: "reactivation",
          offer: "Reactivation",
          app: "campaigns",
          addOn: null,
          startsOn: ago(90).slice(0, 10),
          status: "active",
        },
      ],
      people: 3,
      owners: ["owner@acme.example"],
      billing: { open: 1, overdue: 0 },
    },
  }),
  ...serve<ReturnType<typeof consoleApi>>("console", { surveysDue: [], prefs: {}, savedViews: [] }),
  ...serve<ReturnType<typeof accountsApi>>("accounts", {
    accounts: {
      owner: OWNER,
      team: false,
      mayAct: true,
      agent: false,
      accounts: [],
      paused: [],
      sites: [],
    },
    now: {
      owner: OWNER,
      team: false,
      count: 1,
      items: [
        {
          client: CLIENT.id,
          clientName: CLIENT.name,
          accountId: 1,
          site: "google_business",
          siteLabel: "Google Business",
          ref: "Acme Plumbing",
          id: 1,
          kind: "waiting",
          for: "client",
          level: "warn",
          title: "Verify your Google Business profile",
          why: "Google sent a code by post.",
          at: ago(1),
          open: true,
        },
      ],
    },
  }),
  ...serve<NotesApi>("notes", {
    needsYou: { n: 2 },
    mentions: {
      unseen: 1,
      mentions: [
        {
          id: "m1",
          noteId: "n1",
          name: "Spring promo plan",
          commentId: null,
          comment: null,
          by: "Sam Rivera",
          at: ago(0.5),
          seen: false,
          home: "/notes/all",
          thread: null,
        },
        {
          id: "m2",
          noteId: "n2",
          name: "Call back the Brandt job",
          commentId: "c1",
          comment: "Can you move this to Thursday? The crew is out Wednesday.",
          by: "Jo Chen",
          at: ago(2),
          seen: true,
          home: "/notes/all",
          thread: null,
        },
      ],
    },
  }),
};
