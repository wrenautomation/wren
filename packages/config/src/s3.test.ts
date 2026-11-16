import { describe, expect, it } from "vitest";
import { s3Options } from "./s3.js";

const KEY = { S3_STORE_ACCESS_KEY_ID: "AKIATEST", S3_STORE_SECRET_ACCESS_KEY: "test-only" };

describe("s3Options", () => {
  it("takes the static key when both halves are set", () => {
    expect(s3Options({ region: "us-east-1" }, KEY)).toEqual({
      region: "us-east-1",
      credentials: { accessKeyId: "AKIATEST", secretAccessKey: "test-only" },
    });
  });
  it("keeps the default chain without the key or with half of it", () => {
    expect(s3Options({}, {})).toEqual({});
    expect(s3Options({}, { S3_STORE_ACCESS_KEY_ID: "AKIATEST" })).toEqual({});
  });
  it("never on a Lambda", () => {
    expect(s3Options({}, { ...KEY, AWS_LAMBDA_FUNCTION_NAME: "wren-prod-worker" })).toEqual({});
  });
  it("passes the checksum mode through", () => {
    expect(s3Options({ requestChecksumCalculation: "WHEN_REQUIRED" }, {})).toEqual({
      requestChecksumCalculation: "WHEN_REQUIRED",
    });
  });
});
