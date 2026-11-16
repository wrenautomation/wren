/**
 * Options for every S3 client. On the Mac: the static key `S3_STORE_*` (IAM user mac-s3-store,
 * SSM `/wren/mac-s3-store`, copied into the repo's env file) in place of the expiring login, so a
 * lapsed session stops no upload. S3 only: SSM and the rest keep the login. Lambda and the box
 * never hold the key, so their role stays. Same key as autobrowse's `s3Aws`.
 */
export interface S3Options {
  region?: string;
  requestChecksumCalculation?: "WHEN_REQUIRED" | "WHEN_SUPPORTED";
  credentials?: { accessKeyId: string; secretAccessKey: string };
}

export function s3Options(
  o: {
    region?: string | undefined;
    requestChecksumCalculation?: S3Options["requestChecksumCalculation"] | undefined;
  } = {},
  env: NodeJS.ProcessEnv = process.env,
): S3Options {
  const accessKeyId = env.S3_STORE_ACCESS_KEY_ID;
  const secretAccessKey = env.S3_STORE_SECRET_ACCESS_KEY;
  const out: S3Options = {};
  if (o.region) out.region = o.region;
  if (o.requestChecksumCalculation) out.requestChecksumCalculation = o.requestChecksumCalculation;
  // a Lambda's role always wins, even if the key leaks into its env
  if (accessKeyId && secretAccessKey && !env.AWS_LAMBDA_FUNCTION_NAME)
    out.credentials = { accessKeyId, secretAccessKey };
  return out;
}
