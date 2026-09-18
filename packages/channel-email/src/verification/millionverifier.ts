/**
 * MillionVerifier adapter (pay-as-you-go credits). Single-check API: fine at our
 * volumes, and stage-1 local checks have already removed the junk.
 */
import type { VerificationResult } from "../schema.js";
import type { EmailVerifier, Verdict } from "./verifier.js";

export const MILLIONVERIFIER_API_URL = "https://api.millionverifier.com/api/v3/";

const RESULT_MAP: Record<string, VerificationResult> = {
  ok: "valid",
  invalid: "invalid",
  disposable: "invalid",
  catch_all: "catch_all",
  unknown: "risky",
};

/** API-level failure (bad key, no credits, malformed response): stop the run, don't burn the list. */
export class MillionVerifierError extends Error {
  override name = "MillionVerifierError";
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export class MillionVerifier implements EmailVerifier {
  readonly name = "millionverifier";
  readonly authoritative = true; // a paid, real-provider verdict
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async verify(email: string): Promise<Verdict> {
    const url = `${MILLIONVERIFIER_API_URL}?${new URLSearchParams({ api: this.apiKey, email, timeout: "20" })}`;
    let resp: Response;
    try {
      resp = await this.fetchImpl(url, { signal: AbortSignal.timeout(30_000) });
    } catch (err) {
      // The key rides in the URL: never let a transport error's message (which may embed it) escape.
      throw new MillionVerifierError(
        `request failed: ${err instanceof Error ? err.name : "Error"}`,
      );
    }
    // Only the status code: the URL (and so the key) must never reach a message, a stats value, or stdout.
    if (!resp.ok) throw new MillionVerifierError(`HTTP ${resp.status}`);
    const data = (await resp.json()) as Record<string, unknown>;
    if (data.error) throw new MillionVerifierError(String(data.error));
    const result = RESULT_MAP[String(data.result)];
    if (result === undefined)
      throw new MillionVerifierError(`unexpected result field: ${JSON.stringify(data.result)}`);
    return { result, raw: data };
  }
}
