import { describe, expect, it } from "vitest";
import { can, type Viewer } from "./access.js";

const team: Viewer = { team: true, demo: false };
const client: Viewer = { team: false, demo: false, role: "member", features: ["export"] };
const owner: Viewer = { team: false, demo: false, role: "owner" };
const demo: Viewer = { team: false, demo: true };

describe("can", () => {
  it("lets everyone see what asks nothing", () => {
    for (const v of [team, client, owner, demo]) expect(can(v, undefined)).toBe(true);
    expect(can(demo, {})).toBe(true);
  });

  it("keeps team things to the team", () => {
    expect(can(team, { audience: "team" })).toBe(true);
    for (const v of [client, owner, demo]) expect(can(v, { audience: "team" })).toBe(false);
  });

  it("keeps a client's own off the demo", () => {
    expect(can(client, { audience: "client" })).toBe(true);
    expect(can(team, { audience: "client" })).toBe(true);
    expect(can(demo, { audience: "client" })).toBe(false);
    expect(can({ ...team, demo: true }, { audience: "client" })).toBe(false);
  });

  it("keeps the demo's own on the demo", () => {
    expect(can(demo, { audience: "demo" })).toBe(true);
    for (const v of [team, client, owner]) expect(can(v, { audience: "demo" })).toBe(false);
  });

  it("checks role and feature, which the team always passes", () => {
    expect(can(owner, { role: "owner" })).toBe(true);
    expect(can(client, { role: "owner" })).toBe(false);
    expect(can(client, { feature: "export" })).toBe(true);
    expect(can(client, { feature: "forecast" })).toBe(false);
    expect(can(team, { role: "owner", feature: "forecast" })).toBe(true);
  });

  it("checks needs against what the login holds here, the team too", () => {
    const viewerTeam: Viewer = { ...team, can: ["read"] };
    expect(can(viewerTeam, { needs: "read" })).toBe(true);
    expect(can(viewerTeam, { needs: "act" })).toBe(false);
    expect(can({ ...owner, can: ["read", "money"] }, { needs: "money" })).toBe(true);
    expect(can({ ...client, can: ["read", "act"] }, { needs: "money" })).toBe(false);
    // Unknown (the demo, a preview): not checked.
    expect(can(demo, { needs: "act" })).toBe(true);
  });
});
