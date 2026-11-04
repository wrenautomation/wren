/**
 * The engine's `MediaStore` on the media bucket (WA-1029): `cache/<platform>/<id>.mp4` and `.json`,
 * so a video downloads once. Mac only, on the Mac's AWS chain; the worker's role stays on `media/*`.
 * Kept forever, Glacier IR after 30 days (`deploy/terraform/media.tf`).
 */
import { createReadStream, createWriteStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { MediaStore, VideoMeta } from "@wrenautomation/read/video";

export const CACHE_PREFIX = "cache/";

export function s3MediaStore(bucket: string, client: S3Client = new S3Client({})): MediaStore {
  const at = (key: string, ext: string) => `${CACHE_PREFIX}${key}.${ext}`;
  // A miss is null; any other error (no credentials, a throttle) throws, so the reader says why.
  const get = async (Key: string) => {
    try {
      return await client.send(new GetObjectCommand({ Bucket: bucket, Key }));
    } catch (err) {
      if (err instanceof NoSuchKey) return null;
      throw err;
    }
  };
  return {
    async get(key, dest) {
      const info = await get(at(key, "json"));
      if (!info?.Body) return null;
      const meta = JSON.parse(await info.Body.transformToString()) as VideoMeta;
      const file = await get(at(key, "mp4"));
      if (!file?.Body) return null;
      await pipeline(file.Body as Readable, createWriteStream(dest));
      return meta;
    },
    async put(key, file, info) {
      // The mp4 first: the json marks a complete pair, and `get` reads it first.
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: at(key, "mp4"),
          Body: createReadStream(file),
          ContentLength: (await stat(file)).size,
          ContentType: "video/mp4",
        }),
      );
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: at(key, "json"),
          Body: JSON.stringify(info),
          ContentType: "application/json",
        }),
      );
    },
  };
}
