import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { encodeResult, RenderLambdaError, type RenderRequest, renderLambda } from "./index.js";

describe("renderLambda wire", () => {
  it("a read comes back as the page", async () => {
    const asked: RenderRequest[] = [];
    const lambda = renderLambda("fn", async (req) => {
      asked.push(req);
      return encodeResult({
        html: "<p>hi</p>",
        finalUrl: "https://example.test/",
        statusCode: 200,
      });
    });
    expect(await lambda.read("https://example.test", "ua")).toEqual({
      html: "<p>hi</p>",
      finalUrl: "https://example.test/",
      statusCode: 200,
    });
    expect(asked).toEqual([{ op: "read", url: "https://example.test", userAgent: "ua" }]);
  });

  it("a paint keeps every byte of its images and pdf", async () => {
    const images = [new Uint8Array([255, 216, 0, 1]), new Uint8Array([255, 216, 2])];
    const pdf = new Uint8Array([37, 80, 68, 70]);
    const lambda = renderLambda("fn", async () => encodeResult({ images, pdf }));
    expect(await lambda.paint("<div/>", 2, 1080)).toEqual({ images, pdf });
  });

  it("a result past the cap is an error, not a cut", async () => {
    // random bytes: gzip cannot shrink them under the cap
    const noise = randomBytes(6_000_000);
    const res = encodeResult({ images: [new Uint8Array(noise)], pdf: new Uint8Array() });
    expect(res).toEqual({ error: expect.stringMatching(/MB; the Lambda answers 6 MB at most/) });
    const lambda = renderLambda("fn", async () => res);
    await expect(lambda.paint("<div/>", 1, 1080)).rejects.toBeInstanceOf(RenderLambdaError);
  });
});
