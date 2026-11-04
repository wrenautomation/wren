import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { NoSuchKey, type S3Client } from "@aws-sdk/client-s3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { s3MediaStore } from "./media-store.js";

// The bucket as a map: puts keep their bytes, a missing get throws NoSuchKey like S3.
function fakeS3() {
  const objects = new Map<string, Buffer>();
  const bytesOf = async (body: unknown) =>
    typeof body === "string"
      ? Buffer.from(body)
      : Buffer.concat(await (body as Readable).toArray());
  const client = {
    async send(cmd: { constructor: { name: string }; input: { Key: string; Body?: unknown } }) {
      const { Key, Body } = cmd.input;
      if (cmd.constructor.name === "PutObjectCommand") {
        objects.set(Key, await bytesOf(Body));
        return {};
      }
      const got = objects.get(Key);
      if (!got) throw new NoSuchKey({ message: "no", $metadata: {} });
      return {
        Body: Object.assign(Readable.from([got]), {
          transformToString: async () => got.toString("utf8"),
        }),
      };
    },
  };
  return { objects, client: client as unknown as S3Client };
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "media-store-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe("s3MediaStore", () => {
  it("keeps a video under cache/ and gives it back with its meta", async () => {
    const s3 = fakeS3();
    const store = s3MediaStore("bucket", s3.client);
    const src = join(dir, "in.mp4");
    await writeFile(src, "video bytes");
    await store.put("instagram/r1", src, { id: "r1", title: "A reel", uploader: "maker" });
    expect([...s3.objects.keys()]).toEqual(["cache/instagram/r1.mp4", "cache/instagram/r1.json"]);

    const dest = join(dir, "out.mp4");
    expect(await store.get("instagram/r1", dest)).toEqual({
      id: "r1",
      title: "A reel",
      uploader: "maker",
    });
    expect(await readFile(dest, "utf8")).toBe("video bytes");
  });

  it("answers null for a video it never kept", async () => {
    const store = s3MediaStore("bucket", fakeS3().client);
    expect(await store.get("tiktok/1", join(dir, "x.mp4"))).toBeNull();
  });
});
