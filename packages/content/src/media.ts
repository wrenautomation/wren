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
import { readFile, writeFile } from "node:fs/promises";
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
  ".pdf": "application/pdf",
  ".wav": "audio/wav",
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

const SHA256 = /^[0-9a-f]{64}$/;
const MEDIA_KEY = /^media\/[0-9a-f]{32}\.[a-z0-9]+$/;

/**
 * A browser's PUT straight to the store, at the key `putMedia` would give its bytes. The PUT
 * signs the SHA-256 the browser hashed: S3 refuses other bytes, so a hash key can't be poisoned.
 * The headers go on the PUT as they are.
 */
export async function signMediaPut(
  o: MediaStoreOptions,
  f: { sha256: string; ext: string; type: string; size: number },
): Promise<{ url: string; headers: Record<string, string>; source: string }> {
  if (!SHA256.test(f.sha256)) throw new Error("That file's hash isn't a SHA-256");
  const key = `media/${f.sha256.slice(0, 32)}${f.ext}`;
  const checksum = Buffer.from(f.sha256, "hex").toString("base64");
  // a presigned PUT carries no checksum of its own: only the one signed here
  const s3 =
    o.client ??
    new S3Client({
      ...(o.region ? { region: o.region } : {}),
      requestChecksumCalculation: "WHEN_REQUIRED",
    });
  const url = await getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: o.bucket,
      Key: key,
      ContentType: f.type,
      ContentLength: f.size,
      ChecksumSHA256: checksum,
    }),
    {
      expiresIn: 600,
      signableHeaders: new Set(["content-type", "content-length"]),
      unhoistableHeaders: new Set(["x-amz-checksum-sha256"]),
    },
  );
  return {
    url,
    headers: { "content-type": f.type, "x-amz-checksum-sha256": checksum },
    source: `s3://${o.bucket}/${key}`,
  };
}

/** A stored file's size and first `n` bytes, in one ranged GET; only a hash key in this store. */
export async function storedHead(
  o: MediaStoreOptions,
  source: string,
  n = 8,
): Promise<{ size: number; head: Uint8Array }> {
  const at = parseStored(source);
  if (!at || at.bucket !== o.bucket || !MEDIA_KEY.test(at.key))
    throw new Error("That file isn't in the media store");
  try {
    const r = await clientOf(o).send(
      new GetObjectCommand({ Bucket: at.bucket, Key: at.key, Range: `bytes=0-${n - 1}` }),
    );
    const size = Number(/\/(\d+)$/.exec(r.ContentRange ?? "")?.[1] ?? r.ContentLength ?? 0);
    return { size, head: r.Body ? await r.Body.transformToByteArray() : new Uint8Array() };
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    // a range on an empty object
    if (name === "InvalidRange") return { size: 0, head: new Uint8Array() };
    if (name === "NoSuchKey") throw new Error("The file didn't go up. Try again.");
    throw err;
  }
}

/**
 * A file at a fixed key, not its hash: the sound kit's bucket files (`sfx/<id>.wav`), whose
 * licence keeps them out of the public repo.
 */
export async function putKey(path: string, key: string, o: MediaStoreOptions): Promise<string> {
  await clientOf(o).send(
    new PutObjectCommand({
      Bucket: o.bucket,
      Key: key,
      Body: await readFile(path),
      ContentType: TYPES[extname(path).toLowerCase()] ?? "application/octet-stream",
    }),
  );
  return `s3://${o.bucket}/${key}`;
}

/** The object at `key` into the file `path`. */
export async function getKey(key: string, path: string, o: MediaStoreOptions): Promise<void> {
  const r = await clientOf(o).send(new GetObjectCommand({ Bucket: o.bucket, Key: key }));
  if (!r.Body) throw new Error(`s3://${o.bucket}/${key}: empty`);
  await writeFile(path, await r.Body.transformToByteArray());
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
