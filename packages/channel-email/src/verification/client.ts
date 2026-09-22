/**
 * The Lambda's view of the prober: `POST /verify {email}` to the service on the
 * database box (`apps/prober`), bearer-authenticated. The verdict is the prober's own
 * SmtpVerifier verdict, so rows read the same whichever host ran the handshake.
 */

import type { FetchLike } from "../fetch-like.js";
import type { VerificationResult } from "../schema.js";
import { VERIFICATION_RESULTS } from "../schema.js";
import type { EmailVerifier, Verdict } from "./verifier.js";

/** The prober did not answer, or answered with something other than a verdict: stop the run. */
export class ProberError extends Error {
  override name = "ProberError";
}

export class ProbeClientVerifier implements EmailVerifier {
  readonly name = "smtp";
  readonly authoritative = true;
  readonly costsCredits = false;
  private readonly base: string;

  constructor(
    baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {
    this.base = baseUrl.replace(/\/+$/, "");
  }

  async verify(email: string): Promise<Verdict> {
    let resp: Response;
    try {
      resp = await this.fetchImpl(`${this.base}/verify`, {
        method: "POST",
        headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
        body: JSON.stringify({ email }),
        // A probe walks up to three MX hosts with a socket timeout each.
        signal: AbortSignal.timeout(60_000),
      });
    } catch (err) {
      // The token rides in a header, never in a message; keep the error to its name.
      throw new ProberError(`prober unreachable: ${err instanceof Error ? err.name : "Error"}`);
    }
    if (!resp.ok) {
      // The prober's own error text (ours, short, never a secret); anything else is dropped.
      const detail = await resp
        .json()
        .then((d: unknown) =>
          d && typeof d === "object" ? (d as { error?: unknown }).error : null,
        )
        .catch(() => null);
      throw new ProberError(
        `prober HTTP ${resp.status}${typeof detail === "string" ? `: ${detail}` : ""}`,
      );
    }
    const data = (await resp.json()) as { result?: unknown; raw?: unknown };
    if (!VERIFICATION_RESULTS.includes(data.result as VerificationResult))
      throw new ProberError(`unexpected verdict: ${JSON.stringify(data.result)}`);
    return {
      result: data.result as VerificationResult,
      raw: (data.raw ?? {}) as Record<string, unknown>,
    };
  }
}
