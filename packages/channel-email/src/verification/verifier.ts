/**
 * EmailVerifier: what the funnel depends on, and what it wants to know about a
 * verdict — may it move a lead, and did it cost anything. Production is our own SMTP
 * prober, plugged in at `mailifier.ts`; tests run on the fake, steerable by address
 * suffix so offline fixtures encode the outcome they want in the email.
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
  /** Whether a verdict spends money: a free verifier may run inside the pool loop, unattended. */
  costsCredits: boolean;
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
  readonly costsCredits = false;
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
  /** The prober's URL and bearer, for `smtp` from a host with no port 25. */
  smtpProbeUrl?: string | null;
  smtpProbeToken?: string | null;
  /** HELO name for `smtp-direct`: a host that can open port 25 itself. */
  smtpHelo?: string | null;
}

export async function makeVerifier(name: string, env: VerifierEnv): Promise<EmailVerifier> {
  if (name === "fake") return new FakeVerifier();
  if (name === "smtp") {
    const { remoteProbeVerifier } = await import("./mailifier.js");
    if (!env.smtpProbeUrl || !env.smtpProbeToken)
      throw new Error(
        "smtp needs WREN_SMTP_PROBE_URL and WREN_SMTP_PROBE_TOKEN in the environment",
      );
    return remoteProbeVerifier(env.smtpProbeUrl, env.smtpProbeToken);
  }
  if (name === "smtp-direct") {
    const { directProbeVerifier } = await import("./mailifier.js");
    if (!env.smtpHelo) throw new Error("smtp-direct needs WREN_SMTP_HELO in the environment");
    return directProbeVerifier(env.smtpHelo);
  }
  throw new Error(`unknown verifier '${name}'; expected 'fake', 'smtp' or 'smtp-direct'`);
}
