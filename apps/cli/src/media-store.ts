import { S3Client } from "@aws-sdk/client-s3";
import { s3Options } from "@wren/config/s3";
import { s3MediaStore } from "@wrenautomation/read/s3";

/** read's media store on the Mac's static S3 key when set (WA-1409); else read's own client (default chain, proxy aware). */
export function mediaStore(bucket: string) {
  const o = s3Options();
  return s3MediaStore(bucket, o.credentials ? { client: new S3Client(o) } : {});
}
