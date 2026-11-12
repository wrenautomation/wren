import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { S3Client } from "@aws-sdk/client-s3";
import { fakeModel } from "@wrenautomation/models";
import { afterEach, describe, expect, it } from "vitest";
import { canonKey, fileSourceOf, putCanonFile } from "./canon-files.js";

// a bucket in memory: Head, Put, Get by key
function fakeBucket() {
  const kept = new Map<string, unknown>();
  const client = {
    async send(cmd: { constructor: { name: string }; input: { Key: string; Body?: unknown } }) {
      const name = cmd.constructor.name;
      if (name === "HeadObjectCommand") {
        if (kept.has(cmd.input.Key)) return {};
        throw Object.assign(new Error("not found"), { name: "NotFound" });
      }
      if (name === "PutObjectCommand") kept.set(cmd.input.Key, cmd.input.Body);
      return {};
    },
  } as unknown as S3Client;
  return { kept, o: { bucket: "b", client } };
}

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});
const tmp = async () => {
  const d = await mkdtemp(join(tmpdir(), "canon-files-"));
  dirs.push(d);
  return d;
};

describe("canon files", () => {
  it("a picture: canon/<hash> key, put once, its own image- record read by the eye", async () => {
    const d = await tmp();
    const png = join(d, "Shot 1.PNG");
    await writeFile(png, "png bytes");
    const { kept, o } = fakeBucket();
    const eye = fakeModel("Hello on screen.\n\nA chat window.");
    const made = await fileSourceOf(png, { ...o, eye, title: "His chat", priority: 5 });
    const key = canonKey(new TextEncoder().encode("png bytes"), ".png");
    expect(made.files).toEqual([{ key, type: "image/png", role: "image", name: "Shot 1.PNG" }]);
    expect(made.source.name).toMatch(/^image-[0-9a-f]{12}\.md$/);
    expect(made.source.md).toContain("A chat window.");
    expect([...kept.keys()]).toEqual([key]);
    // same bytes again: no second put
    kept.set(key, "marker");
    await putCanonFile(png, o, "image");
    expect(kept.get(key)).toBe("marker");
  });

  it("a type Canon does not keep is refused", async () => {
    const d = await tmp();
    const zip = join(d, "a.zip");
    await writeFile(zip, "z");
    await expect(putCanonFile(zip, fakeBucket().o, "file")).rejects.toThrow(
      "is not a type Canon keeps",
    );
  });
});
