/**
 * A local media file as a public URL: put in the media bucket under a
 * content hash, handed out as a presigned GET good for a day (Graph and
 * TikTok fetch it right away). Nothing else reads the bucket.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { MediaHost } from "@wren/core/content";

const TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
};

export function s3MediaHost(o: {
  bucket: string;
  /** The SDK's own resolution (AWS_REGION, the Lambda's) when absent. */
  region?: string;
  client?: S3Client;
  expiresSeconds?: number;
}): MediaHost {
  const s3 = o.client ?? new S3Client(o.region ? { region: o.region } : {});
  return {
    async host(path) {
      const bytes = await readFile(path);
      const ext = extname(path).toLowerCase();
      const key = `media/${createHash("sha256").update(bytes).digest("hex").slice(0, 32)}${ext}`;
      await s3.send(
        new PutObjectCommand({
          Bucket: o.bucket,
          Key: key,
          Body: bytes,
          ContentType: TYPES[ext] ?? "application/octet-stream",
        }),
      );
      return getSignedUrl(s3, new GetObjectCommand({ Bucket: o.bucket, Key: key }), {
        expiresIn: o.expiresSeconds ?? 86_400,
      });
    },
  };
}
