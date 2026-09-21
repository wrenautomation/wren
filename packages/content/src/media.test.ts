import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";
import { parseStored, uploadMedia } from "./media.js";

/** Records puts. */
function fakeS3() {
  const puts: { Bucket?: string; Key?: string; ContentType?: string; size: number }[] = [];
  type Put = (typeof puts)[number];
  const client = {
    async send(cmd: { input: Record<string, unknown> }) {
      const { Body, ...rest } = cmd.input as Put & { Body?: Uint8Array };
      puts.push({ ...rest, size: Body?.byteLength ?? 0 });
      return {};
    },
  };
  return { client: client as unknown as S3Client, puts };
}

describe("media store", () => {
  it("parses s3 sources", () => {
    expect(parseStored("s3://b/media/abc.mp4")).toEqual({ bucket: "b", key: "media/abc.mp4" });
    expect(parseStored("https://x/y")).toBeNull();
    expect(parseStored("s3://b")).toBeNull();
  });
  it("uploads under the content hash with the file's type", async () => {
    const dir = await mkdtemp(join(tmpdir(), "media-"));
    const path = join(dir, "clip.mp4");
    await writeFile(path, new Uint8Array([1, 2, 3]));
    const { client, puts } = fakeS3();
    const a = await uploadMedia(path, { bucket: "wren-media", client });
    const b = await uploadMedia(path, { bucket: "wren-media", client });
    expect(a).toBe(b);
    expect(a).toMatch(/^s3:\/\/wren-media\/media\/[0-9a-f]{32}\.mp4$/);
    expect(puts[0]).toMatchObject({ Bucket: "wren-media", ContentType: "video/mp4", size: 3 });
  });
});
