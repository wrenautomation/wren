import { describe, expect, it } from "vitest";
import { effectiveRole, noteRole } from "./access.js";

const me = { email: "sam@example.com", team: false, inWorkspace: true, client: "acme" };
const note = {
  owner: "ana@example.com",
  general: "private" as const,
  generalRole: "view" as const,
};

describe("noteRole", () => {
  it("the owner owns it, any case", () => {
    expect(noteRole({ ...note, owner: "SAM@example.com" }, [], me)).toBe("owner");
  });

  it("private: nobody else, admins included", () => {
    expect(noteRole(note, [], { ...me, team: true })).toBeNull();
  });

  it("the best share wins", () => {
    expect(
      noteRole(
        note,
        [
          { who: "sam@example.com", role: "view" },
          { who: "client:acme", role: "comment" },
        ],
        me,
      ),
    ).toBe("comment");
    expect(noteRole(note, [{ who: "team", role: "edit" }], me)).toBeNull();
    expect(noteRole(note, [{ who: "team", role: "edit" }], { ...me, team: true })).toBe("edit");
  });

  it("the workspace's access, only inside it", () => {
    const open = { ...note, general: "workspace" as const, generalRole: "comment" as const };
    expect(noteRole(open, [], me)).toBe("comment");
    expect(noteRole(open, [], { ...me, inWorkspace: false })).toBeNull();
  });

  it("an agent's note is run by whoever may edit it", () => {
    const agent = {
      owner: "agent:claude",
      general: "workspace" as const,
      generalRole: "edit" as const,
    };
    expect(noteRole(agent, [], me)).toBe("owner");
  });
});

describe("effectiveRole", () => {
  it("held to the app permission", () => {
    expect(effectiveRole("edit", "view")).toBe("view");
    expect(effectiveRole("owner", "comment")).toBe("comment");
    expect(effectiveRole("owner", "edit")).toBe("owner");
    expect(effectiveRole("view", "edit")).toBe("view");
    expect(effectiveRole("edit", null)).toBeNull();
    expect(effectiveRole(null, "edit")).toBeNull();
  });
});
