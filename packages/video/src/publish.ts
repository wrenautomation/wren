/**
 * An encoded video, put where a watch page can play it: `v/<id>.mp4`,
 * `v/<id>.jpg` and `v/<id>.json` (what the page shows around the player) in a
 * bucket a CDN serves. The id is the only way in, so it is random and long.
 */
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { Encoded } from "./encode.js";

export interface PublishOptions {
  bucket: string;
  /** Where the CDN serves the bucket, no trailing slash: "https://d123.cloudfront.net". */
  origin: string;
  region?: string;
  client?: S3Client;
}

export interface Published {
  id: string;
  mp4: string;
  poster: string;
  meta: string;
}

/** 16 random bytes as url-safe text: not guessable, not listable. */
export const newVideoId = (): string => randomBytes(16).toString("base64url");

/** A year: an id never changes what it points at, so caches may keep it. */
const CACHE = "public, max-age=31536000, immutable";

export async function publish(
  encoded: Encoded,
  id: string,
  meta: Record<string, unknown>,
  o: PublishOptions,
): Promise<Published> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(id)) throw new Error(`bad video id "${id}"`);
  const s3 = o.client ?? new S3Client(o.region ? { region: o.region } : {});
  const url = (ext: string) => `${o.origin}/v/${id}.${ext}`;
  const done = { id, mp4: url("mp4"), poster: url("jpg"), meta: url("json") };
  const put = async (ext: string, body: Buffer | string, type: string) => {
    await s3.send(
      new PutObjectCommand({
        Bucket: o.bucket,
        Key: `v/${id}.${ext}`,
        Body: body,
        ContentType: type,
        CacheControl: CACHE,
      }),
    );
  };
  await put("mp4", await readFile(encoded.mp4), "video/mp4");
  await put("jpg", await readFile(encoded.poster), "image/jpeg");
  // Last: the page reads this one, so it only appears once the media it names is there.
  const seconds = Math.round(encoded.seconds * 10) / 10;
  const body = { ...meta, mp4: done.mp4, poster: done.poster, seconds };
  await put("json", JSON.stringify(body), "application/json");
  return done;
}
