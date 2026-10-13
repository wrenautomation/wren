import type { Db } from "@wren/db";
import { describe, expect, it } from "vitest";
import { isStoredPicture, keepPictures, type PictureStore } from "./pictures.js";

/** A database that answers the waiting list and records each repoint. */
function fakeDb(waiting: string[]) {
  const sets: unknown[] = [];
  const db = {
    execute: async () => waiting.map((url) => ({ url })),
    update: () => ({ set: (v: unknown) => ({ where: async () => void sets.push(v) }) }),
  } as unknown as Db;
  return { db, sets };
}

const store = (): PictureStore & { put: PictureStore["put"]; got: string[] } => {
  const got: string[] = [];
  return {
    got,
    put: async (bytes, ext) => {
      got.push(`${bytes.length}${ext}`);
      return `s3://bucket/media/${"a".repeat(32)}${ext}`;
    },
    sign: async (ref) => ref,
  };
};

describe("keepPictures", () => {
  it("copies a picture, drops a gone one, retries a failed host", async () => {
    const { db, sets } = fakeDb([
      "https://cdn.example/a.jpg",
      "https://cdn.example/expired.jpg",
      "https://cdn.example/down.jpg",
      "https://cdn.example/page",
    ]);
    const s = store();
    const fetchFn = async (url: string) => {
      if (url.endsWith("a.jpg"))
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "image/jpeg" },
        });
      if (url.endsWith("expired.jpg")) return new Response("", { status: 403 });
      if (url.endsWith("down.jpg")) return new Response("", { status: 503 });
      return new Response("<html>", { headers: { "content-type": "text/html" } });
    };
    const stats = await keepPictures(db, s, fetchFn);
    expect(stats).toEqual({ kept: 1, gone: 2, failed: 1 });
    expect(s.got).toEqual(["3.jpg"]);
    // Items then sources, for each picture kept or gone.
    expect(sets).toEqual([
      { thumbnailUrl: `s3://bucket/media/${"a".repeat(32)}.jpg` },
      { avatarUrl: `s3://bucket/media/${"a".repeat(32)}.jpg` },
      { thumbnailUrl: null },
      { avatarUrl: null },
      { thumbnailUrl: null },
      { avatarUrl: null },
    ]);
  });

  it("knows a stored ref", () => {
    expect(isStoredPicture("s3://b/media/x.jpg")).toBe(true);
    expect(isStoredPicture("https://cdn.example/x.jpg")).toBe(false);
    expect(isStoredPicture(null)).toBe(false);
  });
});
