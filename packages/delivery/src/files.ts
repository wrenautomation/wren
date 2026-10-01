/**
 * Client files in the private bucket (D11), under `clients/<id>/`. The browser
 * gets a PUT signed for exactly the type and size it declared, and a GET that
 * lasts minutes; the bytes never pass through the worker.
 */
import { randomUUID } from "node:crypto";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export { FILE_TYPES, MAX_FILE_BYTES, typeOfName } from "./routes.js";

/** A new key in the client's folder: the day, a random part, then the name made safe. */
export function newFileKey(clientId: string, name: string, now = new Date()): string {
  const safe =
    name
      .normalize("NFKD")
      .replace(/[^\w.-]+/g, "-")
      .replace(/^[-.]+|-+$/g, "")
      .slice(-120) || "file";
  return `clients/${clientId}/${now.toISOString().slice(0, 10)}/${randomUUID().slice(0, 8)}-${safe}`;
}

/** The name a key was uploaded under. */
export const fileNameOf = (key: string): string =>
  (key.split("/").pop() ?? "").replace(/^[0-9a-f]{8}-/, "") || "file";

export interface FileStore {
  /** Where the browser PUTs the bytes: only this type and size, for ten minutes. */
  putUrl(key: string, type: string, size: number): Promise<string>;
  /** A download under the file's name, for ten minutes: longer than the demo's edge cache. */
  getUrl(key: string): Promise<string>;
  /** The CLI's upload of local bytes. */
  put(key: string, bytes: Uint8Array, type: string): Promise<void>;
}

export function s3Files(o: { bucket: string; region?: string }): FileStore {
  // A presigned URL can't carry a checksum of bytes it hasn't seen; only add one when S3 needs it.
  const s3 = new S3Client({
    ...(o.region ? { region: o.region } : {}),
    requestChecksumCalculation: "WHEN_REQUIRED",
  });
  return {
    putUrl: (key, type, size) =>
      getSignedUrl(
        s3,
        new PutObjectCommand({
          Bucket: o.bucket,
          Key: key,
          ContentType: type,
          ContentLength: size,
        }),
        { expiresIn: 600, signableHeaders: new Set(["content-type", "content-length"]) },
      ),
    getUrl: (key) =>
      getSignedUrl(
        s3,
        new GetObjectCommand({
          Bucket: o.bucket,
          Key: key,
          ResponseContentDisposition: `attachment; filename="${fileNameOf(key)}"`,
        }),
        { expiresIn: 600 },
      ),
    put: async (key, bytes, type) => {
      await s3.send(
        new PutObjectCommand({ Bucket: o.bucket, Key: key, Body: bytes, ContentType: type }),
      );
    },
  };
}
