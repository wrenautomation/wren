import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

/**
 * Where a document's bytes live. Keys are content addresses, so a put of the
 * same bytes twice is harmless and nothing is ever overwritten with other bytes.
 */
export interface DocumentStore {
  put(key: string, bytes: Uint8Array, mediaType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const EXTENSIONS: Record<string, string> = {
  "message/rfc822": ".eml",
  "application/pdf": ".pdf",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "text/csv": ".csv",
};

/** `books/documents/<sha256>.<ext>`: one key per distinct content. */
export function storeKey(hash: string, mediaType: string): string {
  return `books/documents/${hash}${EXTENSIONS[mediaType] ?? ""}`;
}

/** A private S3 bucket (credentials from the default chain). */
export function s3Store(bucket: string, opts: { client?: S3Client; region?: string } = {}) {
  const client = opts.client ?? new S3Client(opts.region ? { region: opts.region } : {});
  return {
    async put(key, bytes, mediaType) {
      await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: mediaType }),
      );
    },
    async get(key) {
      const out = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!out.Body) throw new Error(`s3://${bucket}/${key}: empty body`);
      return out.Body.transformToByteArray();
    },
  } satisfies DocumentStore;
}

/** A local directory: tests, and a laptop with no bucket. */
export function dirStore(root: string) {
  return {
    async put(key, bytes) {
      const path = join(root, key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes);
    },
    async get(key) {
      return new Uint8Array(await readFile(join(root, key)));
    },
  } satisfies DocumentStore;
}
