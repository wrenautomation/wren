import { describe, expect, it } from "vitest";
import {
  ACCESS_CHANNELS,
  can,
  type Grant,
  granted,
  isNeed,
  MEMBER_ROLES,
  needOf,
  PERMISSIONS,
  type Permission,
  refusal,
  sentence,
  type TEAM_ROLES,
  toSpend,
  type Who,
  WREN,
  whole,
  why,
} from "./access.js";

/**
 * The 10-05 matrix, written out by hand: what each role held inside its scope before scoped
 * access. Every one of these seven verbs must answer exactly as it did.
 */
const BEFORE: Record<string, Permission[]> = {
  admin: ["read", "act", "run", "effect", "money", "manage", "team"],
  operator: ["read", "act", "run"],
  "team viewer": ["read"],
  owner: ["read", "act", "money", "manage"],
  member: ["read", "act"],
  "client viewer": ["read"],
  demo: ["read"],
};
const OLD_VERBS = ["read", "act", "run", "effect", "money", "manage", "team"] as const;
/** Today: `comment` joins every role that could act. */
const MATRIX: Record<string, Permission[]> = Object.fromEntries(
  Object.entries(BEFORE).map(([k, v]) => [k, v.includes("act") ? [...v, "comment"] : v]),
);
const team = (role: (typeof TEAM_ROLES)[number], clients: string[] | null = null): Who => ({
  team: role,
  clients,
});
const member = (role: (typeof MEMBER_ROLES)[number], client = "acme"): Who => ({
  member: role,
  client,
});
const WHO: Record<string, Who> = {
  admin: team("admin"),
  operator: team("operator"),
  "team viewer": team("viewer"),
  owner: member("owner"),
  member: member("member"),
  "client viewer": member("viewer"),
  demo: { demo: true },
};

describe("today's roles", () => {
  for (const [name, who] of Object.entries(WHO))
    it(`${name} answers the seven old verbs exactly as before, at every client`, () => {
      for (const p of OLD_VERBS)
        for (const at of [undefined, "acme", "other", WREN]) {
          const inside =
            at === undefined ||
            at === "acme" ||
            name === "admin" ||
            name.startsWith("op") ||
            name === "team viewer" ||
            name === "demo";
          expect(can(who, p, at), `${p} at ${at}`).toBe(
            inside && (BEFORE[name]?.includes(p) ?? false),
          );
        }
    });
});

describe("can", () => {
  for (const [name, who] of Object.entries(WHO))
    for (const p of PERMISSIONS)
      it(`${name} ${MATRIX[name]?.includes(p) ? "may" : "may not"} ${p}`, () => {
        const want = MATRIX[name]?.includes(p) ?? false;
        expect(can(who, p)).toBe(want);
        expect(can(who, p, "acme")).toBe(want);
      });

  it("nobody may do anything", () => {
    for (const p of PERMISSIONS) expect(can(null, p)).toBe(false);
  });

  it("a member holds nothing at another client", () => {
    for (const role of MEMBER_ROLES)
      for (const p of PERMISSIONS) expect(can(member(role), p, "other")).toBe(false);
  });

  it("a scoped team login holds nothing outside its clients, and `wren` is Wren's apps", () => {
    for (const role of ["operator", "viewer"] as const) {
      const who = team(role, ["acme"]);
      expect(can(who, "read", "acme")).toBe(true);
      expect(can(who, "read", "other")).toBe(false);
      expect(can(who, "read", WREN)).toBe(false);
      expect(can(team(role, [WREN]), "read", WREN)).toBe(true);
      expect(can(team(role, []), "read", "acme")).toBe(false);
    }
  });

  it("an admin's scope is everything, even with a list", () => {
    expect(can(team("admin", ["acme"]), "money", "other")).toBe(true);
  });

  it("granted lists what can says", () => {
    for (const [name, who] of Object.entries(WHO)) expect(granted(who)).toEqual(MATRIX[name]);
    expect(granted(member("owner"), "other")).toEqual([]);
  });
});

describe("needs", () => {
  it("reads a plain or a wren: need", () => {
    expect(needOf("act")).toEqual({ permission: "act", wren: false });
    expect(needOf("wren:money")).toEqual({ permission: "money", wren: true });
    expect(isNeed("wren:effect")).toBe(true);
    expect(isNeed("write")).toBe(false);
    expect(isNeed("wren:")).toBe(false);
    expect(isNeed(undefined)).toBe(false);
  });
});

/** The design's YouTube editor at Wren, as data: a custom role and two extras. */
const NOW = new Date("2026-10-06T12:00:00Z");
const FRIDAY = "2026-10-09T17:00:00Z";
const EDITOR_ROLE: Grant[] = [
  {
    verbs: ["read", "act", "comment"],
    scope: { apps: ["marketing"], channels: ["youtube"] },
    role: "wren.youtube-editor",
  },
  {
    verbs: ["read", "comment"],
    scope: { apps: ["marketing", "outbound"] },
    role: "wren.youtube-editor",
  },
];
const EXTRAS: Grant[] = [
  { id: 1, verbs: ["act"], scope: { client: WREN, channels: ["linkedin"] }, until: FRIDAY },
  { id: 2, verbs: ["effect"], scope: { client: WREN, record: "marketing.post:812" }, usesLeft: 1 },
];
const editor = (grants: Grant[] = [...EDITOR_ROLE, ...EXTRAS]): Who => ({
  team: "wren.youtube-editor",
  clients: [WREN],
  grants,
});
const at = (app: string, channel: string | null, record: string | null = null) => ({
  client: WREN,
  app,
  channel,
  record,
});

describe("scoped grants: the YouTube editor", () => {
  const who = editor();
  it("edits YouTube work in Marketing", () => {
    expect(can(who, "act", at("marketing", "youtube"), NOW)).toBe(true);
    expect(can(who, "read", at("marketing", "youtube"), NOW)).toBe(true);
  });

  it("reads and comments on every other channel, never edits it", () => {
    for (const c of ACCESS_CHANNELS.filter((x) => x !== "youtube" && x !== "linkedin")) {
      expect(can(who, "read", at("marketing", c), NOW)).toBe(true);
      expect(can(who, "comment", at("outbound", c), NOW)).toBe(true);
      expect(can(who, "act", at("marketing", c), NOW)).toBe(false);
    }
    // A record with no channel in his apps: read, never act.
    expect(can(who, "read", at("marketing", null), NOW)).toBe(true);
    expect(can(who, "act", at("marketing", null), NOW)).toBe(false);
  });

  it("holds nothing in apps the role leaves out", () => {
    expect(can(who, "read", at("money", null), NOW)).toBe(false);
    expect(can(who, "read", at("pipeline", "email"), NOW)).toBe(false);
  });

  it("covers LinkedIn until Friday, then not", () => {
    expect(can(who, "act", at("marketing", "linkedin"), NOW)).toBe(true);
    expect(can(who, "act", at("marketing", "linkedin"), new Date("2026-10-09T17:00:01Z"))).toBe(
      false,
    );
  });

  it("may not publish one post: effect stays with admins on Wren's apps", () => {
    expect(can(who, "effect", at("marketing", "youtube", "marketing.post:812"), NOW)).toBe(false);
  });

  it("holds a verb somewhere when the target is left open, never wholly", () => {
    expect(can(who, "act", WREN, NOW)).toBe(true);
    expect(whole(who, "act", WREN)).toBe(false);
    expect(whole(team("operator"), "act", WREN)).toBe(true);
  });

  it("never reaches past the seat's clients", () => {
    expect(can(who, "read", { client: "acme", app: "marketing", channel: "youtube" }, NOW)).toBe(
      false,
    );
  });

  it("says which grants match", () => {
    const yes = why(who, "act", at("marketing", "linkedin"), NOW);
    expect(yes.map((g) => g.id)).toEqual([1]);
    expect(granted(who, WREN)).toEqual(["read", "act", "comment"]);
  });
});

describe("one record, counted uses", () => {
  const post = "delivery.update:812";
  const who: Who = {
    member: "viewer",
    client: "acme",
    grants: [{ id: 9, verbs: ["act"], scope: { client: "acme", record: post }, usesLeft: 1 }],
  };
  it("opens that record only", () => {
    expect(can(who, "act", { client: "acme", app: "work", record: post }, NOW)).toBe(true);
    expect(can(who, "act", { client: "acme", app: "work", record: "delivery.update:813" })).toBe(
      false,
    );
    expect(can(who, "act", { client: "acme", app: "work", record: null })).toBe(false);
  });
  it("must be spent, and a spent one says no", () => {
    expect(toSpend(who, "act", { client: "acme", record: post }, NOW)?.map((g) => g.id)).toEqual([
      9,
    ]);
    const spent: Who = { ...who, grants: [{ ...(who.grants?.[0] as Grant), usesLeft: 0 }] };
    expect(can(spent, "act", { client: "acme", record: post })).toBe(false);
    // A role that says yes on its own has nothing to spend.
    expect(toSpend(member("member"), "act", { client: "acme", record: post })).toBeNull();
  });
  it("a member's grant never leaves their client", () => {
    const stray: Who = {
      member: "viewer",
      client: "acme",
      grants: [{ verbs: ["act"], scope: { client: "beta" } }],
    };
    expect(can(stray, "act", "beta")).toBe(false);
    expect(can(stray, "act", "acme")).toBe(false);
  });
});

describe("handing out a grant", () => {
  it("an owner grants what they hold, on their own client only", () => {
    const owner = member("owner");
    expect(
      refusal(owner, { verbs: ["act"], scope: { client: "acme", channels: ["linkedin"] } }),
    ).toBe(null);
    expect(refusal(owner, { verbs: ["act"], scope: { client: "beta" } })).toBe(
      "you don't manage that",
    );
    expect(refusal(owner, { verbs: ["run"], scope: { client: "acme" } })).toBe(
      "you can't run there yourself",
    );
  });
  it("a grant above the granter's own is refused", () => {
    const lead: Who = {
      member: "viewer",
      client: "acme",
      grants: [{ verbs: ["manage", "act"], scope: { client: "acme", channels: ["youtube"] } }],
    };
    expect(
      refusal(lead, { verbs: ["act"], scope: { client: "acme", channels: ["youtube"] } }),
    ).toBe(null);
    expect(refusal(lead, { verbs: ["act"], scope: { client: "acme" } })).toBe(
      "you don't manage that",
    );
    expect(
      refusal(lead, { verbs: ["money"], scope: { client: "acme", channels: ["youtube"] } }),
    ).toBe("you can't money there yourself");
  });
  it("nobody hands out money or sends on Wren's apps, not even an admin", () => {
    expect(refusal(team("admin"), { verbs: ["effect"], scope: { client: WREN } })).toMatch(
      /stay with admins/,
    );
    expect(
      refusal(team("admin"), { verbs: ["act"], scope: { client: WREN, apps: ["marketing"] } }),
    ).toBe(null);
  });
  it("checks names", () => {
    expect(refusal(team("admin"), { verbs: [], scope: { client: "acme" } })).toBe(
      "say what they may do",
    );
    expect(
      refusal(team("admin"), { verbs: ["act"], scope: { client: "acme", apps: ["nope"] } }),
    ).toBe("no such app");
    expect(
      refusal(team("admin"), { verbs: ["act"], scope: { client: "acme", channels: ["fax"] } }),
    ).toBe("no such channel");
  });
});

describe("sentences", () => {
  it("says a grant the way a person would", () => {
    expect(sentence(EXTRAS[0] as Grant, NOW, "UTC")).toBe("Can act on LinkedIn until Fri 5:00 PM.");
    expect(sentence(EDITOR_ROLE[1] as Grant, NOW)).toBe(
      "Can see and raise issues on everything in Marketing and Outbound.",
    );
    expect(sentence(EXTRAS[1] as Grant, NOW)).toBe(
      "Can send and spend on one record (marketing.post 812), once.",
    );
    expect(sentence({ ...(EXTRAS[0] as Grant), until: "2026-10-01T00:00:00Z" }, NOW)).toBe(
      "Can act on LinkedIn. Ended.",
    );
  });
});
