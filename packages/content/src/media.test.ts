import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";
import { parseStored, s3MediaHost, signMediaPut, storedHead, uploadMedia } from "./media.js";

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
  it("a path not on this machine stays a path: the desk (the Mac) reads its own disk", async () => {
    const { client, puts } = fakeS3();
    const host = s3MediaHost({ bucket: "wren-media", client });
    expect(await host.host("/not/on/this/machine/long.mp4")).toBe("/not/on/this/machine/long.mp4");
    expect(puts).toEqual([]);
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

describe("browser uploads", () => {
  const sha = "ab".repeat(32);
  it("signs the PUT at the hash key, with the hash S3 checks the bytes against", async () => {
    const client = new S3Client({
      region: "us-east-1",
      credentials: { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "x" },
      requestChecksumCalculation: "WHEN_REQUIRED",
    });
    const up = await signMediaPut(
      { bucket: "b", client },
      { sha256: sha, ext: ".png", type: "image/png", size: 10 },
    );
    const url = new URL(up.url);
    expect(url.pathname).toBe(`/b/media/${sha.slice(0, 32)}.png`);
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe(
      "content-length;content-type;host;x-amz-checksum-sha256",
    );
    expect(up.headers["x-amz-checksum-sha256"]).toBe(Buffer.from(sha, "hex").toString("base64"));
    expect(up.source).toBe(`s3://b/media/${sha.slice(0, 32)}.png`);
    await expect(
      signMediaPut({ bucket: "b", client }, { sha256: "nope", ext: ".png", type: "", size: 1 }),
    ).rejects.toThrow("SHA-256");
  });
  it("reads a stored file's size and head in one ranged GET, only a hash key here", async () => {
    const got: Record<string, unknown>[] = [];
    const client = {
      async send(cmd: { input: Record<string, unknown> }) {
        got.push(cmd.input);
        return {
          ContentRange: "bytes 0-7/12345",
          Body: { transformToByteArray: async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]) },
        };
      },
    } as unknown as S3Client;
    const key = `media/${sha.slice(0, 32)}.png`;
    expect(await storedHead({ bucket: "b", client }, `s3://b/${key}`)).toEqual({
      size: 12345,
      head: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    });
    expect(got).toEqual([{ Bucket: "b", Key: key, Range: "bytes=0-7" }]);
    for (const bad of [`s3://other/${key}`, "s3://b/clients/x.png", "https://b/x.png"])
      await expect(storedHead({ bucket: "b", client }, bad)).rejects.toThrow("media store");
  });
});
