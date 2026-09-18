/**
 * EmailVerifier seam: mailbox-level verification behind an interface, so the paid
 * provider is swappable and tests run on the fake. The fake is steerable by
 * address suffix: offline fixtures encode the outcome they want in the email.
 */
import type { VerificationResult } from "../schema.js";

export interface Verdict {
  result: VerificationResult;
  raw: Record<string, unknown>;
}

export interface EmailVerifier {
  name: string;
  /**
   * Whether a VALID verdict from this verifier may advance lead status: a test
   * double must never mint a real fact. Local-check INVALID is authoritative regardless.
   */
  authoritative: boolean;
  verify(email: string): Promise<Verdict>;
}

const FAKE_SUFFIXES: Record<string, VerificationResult> = {
  "+invalid": "invalid",
  "+risky": "risky",
  "+catchall": "catch_all",
};

export class FakeVerifier implements EmailVerifier {
  readonly name = "fake";
  readonly authoritative: boolean;
  /** Default false: a stub must not silently promote real leads to verified. */
  constructor(opts: { authoritative?: boolean } = {}) {
    this.authoritative = opts.authoritative ?? false;
  }
  async verify(email: string): Promise<Verdict> {
    const local = email.split("@")[0] ?? "";
    for (const [suffix, result] of Object.entries(FAKE_SUFFIXES)) {
      if (local.endsWith(suffix)) return { result, raw: { fake: true, matched: suffix } };
    }
    return { result: "valid", raw: { fake: true, matched: null } };
  }
}

export interface VerifierEnv {
  millionverifierApiKey?: string | null;
}

export async function makeVerifier(name: string, env: VerifierEnv): Promise<EmailVerifier> {
  if (name === "fake") return new FakeVerifier();
  if (name === "millionverifier") {
    const { MillionVerifier } = await import("./millionverifier.js");
    if (!env.millionverifierApiKey)
      throw new Error("millionverifier needs MILLIONVERIFIER_API_KEY in the environment");
    return new MillionVerifier(env.millionverifierApiKey);
  }
  throw new Error(`unknown verifier '${name}'; expected 'fake' or 'millionverifier'`);
}
