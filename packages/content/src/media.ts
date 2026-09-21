/**
 * The media store: an S3 bucket only this repo reads. `uploadMedia` (the
 * CLI, on the laptop) puts a file under its content hash and answers
 * `s3://bucket/key`, which a draft carries; `s3MediaHost` (the worker)
 * signs that, or uploads a path of its own, into a GET URL good for a day
 * that Graph, TikTok and the autobrowse box fetch right away.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { isStoredMedia, type MediaHost } from "@wren/core/content";

const TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".m4v": "video/x-m4v",
  ".webm": "video/webm",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
};

export interface MediaStoreOptions {
  bucket: string;
  /** The SDK's own resolution (AWS_REGION, the Lambda's) when absent. */
  region?: string;
  client?: S3Client;
}

const clientOf = (o: MediaStoreOptions) =>
  o.client ?? new S3Client(o.region ? { region: o.region } : {});

/** `s3://bucket/key` → its parts, or null. */
export function parseStored(source: string): { bucket: string; key: string } | null {
  const m = /^s3:\/\/([^/]+)\/(.+)$/i.exec(source);
  return m?.[1] && m[2] ? { bucket: m[1], key: m[2] } : null;
}

/** Put a local file in the store under its content hash; answers `s3://bucket/key`. Same bytes, same key. */
export async function uploadMedia(path: string, o: MediaStoreOptions): Promise<string> {
  const bytes = await readFile(path);
  const ext = extname(path).toLowerCase();
  const key = `media/${createHash("sha256").update(bytes).digest("hex").slice(0, 32)}${ext}`;
  await clientOf(o).send(
    new PutObjectCommand({
      Bucket: o.bucket,
      Key: key,
      Body: bytes,
      ContentType: TYPES[ext] ?? "application/octet-stream",
    }),
  );
  return `s3://${o.bucket}/${key}`;
}

export function s3MediaHost(o: MediaStoreOptions & { expiresSeconds?: number }): MediaHost {
  const s3 = clientOf(o);
  const sign = (bucket: string, key: string) =>
    getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), {
      expiresIn: o.expiresSeconds ?? 86_400,
    });
  return {
    async host(source) {
      if (isStoredMedia(source)) {
        const at = parseStored(source);
        if (!at) throw new Error(`not a stored object: ${source}`);
        return sign(at.bucket, at.key);
      }
      const stored = parseStored(await uploadMedia(source, { ...o, client: s3 }));
      if (!stored) throw new Error("upload answered no object");
      return sign(stored.bucket, stored.key);
    },
  };
}
