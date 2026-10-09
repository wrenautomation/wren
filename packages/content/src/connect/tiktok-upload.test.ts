import { describe, expect, it } from "vitest";
import type { SocialConnectionRow } from "./schema.js";
import { socialSites, TIKTOK_CHUNK } from "./sites.js";
import { videoSeconds } from "./video-length.js";

const NOW = new Date("2026-10-07T12:00:00Z");
const FILE = "https://media.test/v.mp4?X-Amz-Signature=fake";
const UPLOAD = "https://upload.tiktok.test/put/1";
const INIT = "/v2/post/publish/video/init/";
const STATUS = "/v2/post/publish/status/fetch/";

const row: SocialConnectionRow = {
  id: 7,
  client: "acme",
  platform: "tiktok",
  accountId: 1,
  externalId: "e1",
  name: "Acme",
  handle: null,
  scopes: "",
  tokenRef: "ks_x",
  expiresAt: null,
  extra: {},
  state: "connected",
  why: null,
  connectedAt: NOW,
  checkedAt: NOW,
  by: "amy@acme.example",
};

/** A synthetic MP4: ftyp, a moov whose mvhd says `secs` at 1000 a second, then mdat to `size`. */
function mp4(secs: number, size: number): Uint8Array {
  const b = new Uint8Array(size);
  const v = new DataView(b.buffer);
  const box = (at: number, len: number, type: string) => {
    v.setUint32(at, len);
    for (let i = 0; i < 4; i++) b[at + 4 + i] = type.charCodeAt(i);
  };
  box(0, 16, "ftyp");
  box(16, 8 + 8 + 100, "moov");
  box(24, 108, "mvhd");
  v.setUint32(24 + 8 + 12, 1000);
  v.setUint32(24 + 8 + 16, secs * 1000);
  box(132, size - 132, "mdat");
  return b;
}

/** A host that answers ranges, as S3 does. */
function host(bytes: Uint8Array, type = "video/mp4") {
  return (init?: RequestInit) => {
    const range = new Headers(init?.headers).get("range");
    const m = range ? /bytes=(\d+)-(\d+)/.exec(range) : null;
    if (!m) return new Response(bytes, { headers: { "content-type": type } });
    const [a, z] = [Number(m[1]), Math.min(Number(m[2]), bytes.length - 1)];
    return new Response(bytes.slice(a, z + 1), {
      status: 206,
      headers: { "content-type": type, "content-range": `bytes ${a}-${z}/${bytes.length}` },
    });
  };
}

function client(route: (url: string, init?: RequestInit) => Response | undefined) {
  const asked: { url: string; init?: RequestInit }[] = [];
  const slept: number[] = [];
  const sites = socialSites({
    connection: async () => row,
    tokenOf: async () => "tok-fake",
    broke: async () => {},
    fetch: async (url: string, init?: RequestInit) => {
      asked.push({ url, ...(init ? { init } : {}) });
      return route(url, init) ?? new Response("{}", { status: 404 });
    },
    sleep: async (ms) => {
      slept.push(ms);
    },
  });
  return { sites, asked, slept };
}

describe("tiktok FILE_UPLOAD", () => {
  it("sends the file in chunks with Content-Range, the last taking the rest", async () => {
    const size = 2 * TIKTOK_CHUNK + 1234;
    const file = host(mp4(30, size));
    const { sites, asked } = client((url, init) => {
      if (url === FILE) return file(init);
      if (url.endsWith(INIT))
        return Response.json({ data: { publish_id: "pub1", upload_url: UPLOAD } });
      if (url === UPLOAD) return new Response(null, { status: 206 });
      return undefined;
    });
    const out = await sites.call(
      "tiktok",
      "POST",
      INIT,
      { post_info: { title: "t", privacy_level: "SELF_ONLY" }, file: FILE, maxSeconds: 60 },
      "social:7",
    );
    expect(out).toEqual({ data: { publish_id: "pub1" } });
    const init = asked.find((a) => a.url.endsWith(INIT));
    expect(JSON.parse(String(init?.init?.body))).toEqual({
      post_info: { title: "t", privacy_level: "SELF_ONLY" },
      source_info: {
        source: "FILE_UPLOAD",
        video_size: size,
        chunk_size: TIKTOK_CHUNK,
        total_chunk_count: 2,
      },
    });
    const puts = asked.filter((a) => a.url === UPLOAD).map((a) => new Headers(a.init?.headers));
    expect(puts.map((h) => h.get("content-range"))).toEqual([
      `bytes 0-${TIKTOK_CHUNK - 1}/${size}`,
      `bytes ${TIKTOK_CHUNK}-${size - 1}/${size}`,
    ]);
    expect(puts.map((h) => h.get("content-length"))).toEqual([
      String(TIKTOK_CHUNK),
      String(size - TIKTOK_CHUNK),
    ]);
    expect(puts[0]?.get("content-type")).toBe("video/mp4");
    // The token never goes to the upload URL nor the media host.
    expect(puts.every((h) => !h.has("authorization"))).toBe(true);
    expect(
      asked
        .filter((a) => a.url === FILE)
        .every((a) => !new Headers(a.init?.headers).has("authorization")),
    ).toBe(true);
  });

  it("a small file goes whole, even from a host that ignores ranges", async () => {
    const bytes = mp4(5, 4000);
    const { sites, asked } = client((url) => {
      if (url === FILE) return new Response(bytes, { headers: { "content-type": "video/mp4" } });
      if (url.endsWith(INIT))
        return Response.json({ data: { publish_id: "pub2", upload_url: UPLOAD } });
      if (url === UPLOAD) return new Response(null, { status: 201 });
      return undefined;
    });
    await sites.call("tiktok", "POST", INIT, { post_info: {}, file: FILE }, "social:7");
    const init = JSON.parse(String(asked.find((a) => a.url.endsWith(INIT))?.init?.body));
    expect(init.source_info).toEqual({
      source: "FILE_UPLOAD",
      video_size: 4000,
      chunk_size: 4000,
      total_chunk_count: 1,
    });
    const put = asked.find((a) => a.url === UPLOAD);
    expect(new Headers(put?.init?.headers).get("content-range")).toBe("bytes 0-3999/4000");
    expect((put?.init?.body as Uint8Array | undefined)?.byteLength).toBe(4000);
  });

  it("refuses a video past the account's longest before init", async () => {
    const file = host(mp4(90, 5000));
    const { sites, asked } = client((url, init) => (url === FILE ? file(init) : undefined));
    await expect(
      sites.call("tiktok", "POST", INIT, { post_info: {}, file: FILE, maxSeconds: 60 }, "social:7"),
    ).rejects.toThrow(/90 seconds; this account posts up to 60/);
    expect(asked.some((a) => a.url.endsWith(INIT))).toBe(false);
  });

  it("status waits while TikTok processes, then answers the last status", async () => {
    let n = 0;
    const { sites, slept } = client((url) => {
      if (!url.endsWith(STATUS)) return undefined;
      n += 1;
      return Response.json({
        data:
          n < 3
            ? { status: "PROCESSING_UPLOAD" }
            : { status: "PUBLISH_COMPLETE", publicaly_available_post_id: [42] },
      });
    });
    const out = await sites.call(
      "tiktok",
      "POST",
      STATUS,
      { publish_id: "p", wait: 120 },
      "social:7",
    );
    expect(out).toMatchObject({ data: { status: "PUBLISH_COMPLETE" } });
    expect(slept).toEqual([5000, 5000]);
  });

  it("status gives up waiting without throwing: a slow post isn't posted twice", async () => {
    const { sites, slept } = client((url) =>
      url.endsWith(STATUS) ? Response.json({ data: { status: "PROCESSING_UPLOAD" } }) : undefined,
    );
    const out = await sites.call(
      "tiktok",
      "POST",
      STATUS,
      { publish_id: "p", wait: 10 },
      "social:7",
    );
    expect(out).toMatchObject({ data: { status: "PROCESSING_UPLOAD" } });
    expect(slept).toEqual([5000, 5000]);
  });
});

describe("videoSeconds", () => {
  it("reads mvhd's duration, and null for what isn't an MP4", async () => {
    const b = mp4(42, 1000);
    const read = async (a: number, z: number) => b.slice(a, z + 1);
    expect(await videoSeconds(read, b.length)).toBe(42);
    const junk = new Uint8Array(100).fill(7);
    expect(await videoSeconds(async (a, z) => junk.slice(a, z + 1), 100)).toBeNull();
  });
});
