import type { Branch, Piece } from "@wren/content/pieces";
import { describe, expect, it } from "vitest";
import { shelfState, wentTo } from "./video-shelf-state.js";

const branch = (platform: string, state: Branch["state"]): Branch => ({
  id: `${platform}-${state}`,
  platform,
  format: "long",
  state,
  at: null,
  url: null,
  views: null,
  engaged: null,
  error: null,
});
const piece = (branches: Branch[], children: Piece[] = []): Piece => ({
  id: "p",
  kind: "video" as Piece["kind"],
  title: "A synthetic video",
  text: "",
  at: "2026-10-15T00:00:00Z",
  branches,
  children,
});

describe("video shelf", () => {
  it("names what the video needs, a render first", () => {
    expect(shelfState({ state: "edited", render: "failed" }, false).label).toBe("Render failed");
    expect(shelfState({ state: "rendered", render: "rendering" }, false).label).toBe("Rendering");
    expect(shelfState({ state: "failed", render: null }, false).label).toBe("Upload failed");
    expect(shelfState({ state: "uploaded", render: null }, false).label).toBe("Posted");
    expect(shelfState({ state: "approved", render: null }, true).label).toBe("Posted");
    expect(shelfState({ state: "approved", render: null }, false).label).toBe("Approved");
    expect(shelfState({ state: "rendered", render: "done" }, false).label).toBe("Waiting on you");
    expect(shelfState({ state: "added", render: null }, false).label).toBe("Editing");
  });

  it("lists each live platform once, clips included, never the editor or the site", () => {
    const p = piece(
      [branch("youtube", "live"), branch("editor", "editing")],
      [piece([branch("tiktok", "live"), branch("youtube", "live"), branch("instagram", "draft")])],
    );
    expect(wentTo(p)).toEqual(["youtube", "tiktok"]);
    expect(wentTo(piece([branch("site", "live")]))).toEqual([]);
    expect(wentTo(undefined)).toEqual([]);
  });
});
