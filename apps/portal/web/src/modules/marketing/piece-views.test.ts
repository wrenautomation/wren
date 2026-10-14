import { describe, expect, it } from "vitest";
import { nextOut, PIECE_VIEWS, paramsOf, viewOf } from "./piece-views.js";

describe("piece views", () => {
  it("each one names a different look", () => {
    const looks = PIECE_VIEWS.map((v) => `${v.what}/${v.show}/${v.sort}`);
    expect(new Set(looks).size).toBe(looks.length);
    expect(new Set(PIECE_VIEWS.map((v) => v.id)).size).toBe(PIECE_VIEWS.length);
  });

  it("finds the view the picks add up to, and none for a mix", () => {
    expect(viewOf("all", "queued", "soon")?.id).toBe("scheduled");
    expect(viewOf("carousel", "all", "new")?.id).toBe("carousels");
    expect(viewOf("all", "all", "new")?.id).toBe("all");
    expect(viewOf("carousel", "waiting", "new")).toBeNull();
  });

  it("every view reads back as itself from its own params", () => {
    for (const v of PIECE_VIEWS) {
      const p = paramsOf(v);
      expect(viewOf(p.what || "all", p.show || "all", p.sort || "new")?.id).toBe(v.id);
      expect(p.platform).toBe("");
    }
  });

  it("leaves defaults blank so the address stays short", () => {
    expect(paramsOf(PIECE_VIEWS[0] as never)).toEqual({
      what: "",
      show: "",
      sort: "",
      platform: "",
    });
    expect(paramsOf(viewOf("all", "waiting", "waiting") as never)).toMatchObject({
      show: "waiting",
      sort: "waiting",
    });
  });
});

describe("nextOut", () => {
  const branch = (state: string, at: string | null) => ({ state, at });
  it("is the earliest queued moment, children included", () => {
    const piece = {
      branches: [branch("queued", "2026-10-20T09:00:00Z"), branch("live", "2026-10-01T09:00:00Z")],
      children: [{ branches: [branch("queued", "2026-10-18T09:00:00Z")], children: [] }],
    };
    expect(nextOut(piece)).toBe("2026-10-18T09:00:00Z");
  });

  it("is null with nothing queued", () => {
    expect(nextOut({ branches: [branch("draft", null)], children: [] })).toBeNull();
  });
});
