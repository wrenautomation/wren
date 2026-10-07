/**
 * The media store: an S3 bucket only this repo reads. `uploadMedia` (the
 * CLI, on the laptop) puts a file under its content hash and answers
 * `s3://bucket/key`, which a draft carries; `s3MediaHost` (the worker)
 * signs that, or uploads a path of its own, into a GET URL good for a day
 * that Graph, TikTok and the autobrowse box fetch right away. A path not on this machine is the
 * desk's own (a rendered video on the Mac): it stays a path, and the desk reads its disk.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
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
  ".srt": "application/x-subrip",
  ".vtt": "text/vtt",
};

export interface MediaStoreOptions {
  bucket: string;
  /** The SDK's own resolution (AWS_REGION, the Lambda's) when absent. */
  region?: string;
  client?: S3Client;
}

const clientOf = (o: MediaStoreOptions) =>
  o.client ?? new S3Client(o.region ? { region: o.region } : {});

/** What to do when the laptop's AWS session is gone. */
export const AWS_LOGIN_HINT =
  "run aws-login (cd autobrowse && pnpm -s autobrowse aws-login --user william)";

/**
 * Before a long job that ends in an upload: the session signs and S3 takes it. A one-key list
 * answers with an error code: AccessDenied is a good session without list rights (fine); an
 * expired, bad or missing session is the hint to log in again.
 */
export async function checkMediaStore(o: MediaStoreOptions): Promise<void> {
  try {
    await clientOf(o).send(
      new ListObjectsV2Command({ Bucket: o.bucket, Prefix: "media/", MaxKeys: 1 }),
    );
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "AccessDenied") return;
    if (name === "NoSuchBucket") throw new Error(`media bucket ${o.bucket} not found`);
    const why = err instanceof Error ? err.message || name : String(err);
    throw new Error(`AWS session not usable (${why}): ${AWS_LOGIN_HINT}`);
  }
}

/** `s3://bucket/key` → its parts, or null. */
export function parseStored(source: string): { bucket: string; key: string } | null {
  const m = /^s3:\/\/([^/]+)\/(.+)$/i.exec(source);
  return m?.[1] && m[2] ? { bucket: m[1], key: m[2] } : null;
}

/** Put a local file in the store under its content hash; answers `s3://bucket/key`. Same bytes, same key. */
export async function uploadMedia(path: string, o: MediaStoreOptions): Promise<string> {
  return putMedia(await readFile(path), extname(path).toLowerCase(), o);
}

/** Put bytes in the store under their content hash, `ext` naming the type (".jpg"). */
export async function putMedia(
  bytes: Uint8Array,
  ext: string,
  o: MediaStoreOptions,
): Promise<string> {
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
      if (!existsSync(source)) return source;
      const stored = parseStored(await uploadMedia(source, { ...o, client: s3 }));
      if (!stored) throw new Error("upload answered no object");
      return sign(stored.bucket, stored.key);
    },
  };
}
