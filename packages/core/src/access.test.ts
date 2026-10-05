import { describe, expect, it } from "vitest";
import {
  can,
  granted,
  isNeed,
  MEMBER_ROLES,
  needOf,
  PERMISSIONS,
  type Permission,
  type TEAM_ROLES,
  type Who,
  WREN,
} from "./access.js";

/** The doc's matrix, written out by hand: what each role holds inside its scope. */
const MATRIX: Record<string, Permission[]> = {
  admin: ["read", "act", "run", "effect", "money", "manage", "team"],
  operator: ["read", "act", "run"],
  "team viewer": ["read"],
  owner: ["read", "act", "money", "manage"],
  member: ["read", "act"],
  "client viewer": ["read"],
  demo: ["read"],
};
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
