/**
 * The one file in wren that knows the mailbox checker is `mailifier`.
 *
 * The library answers a narrow question — did the mail server accept this address —
 * and says nothing about whether we should believe it or what it costs. Those are
 * ours: an SMTP verdict is a server's own answer about its own mailbox, so it is
 * authoritative, and it is free because we run the probe. That policy is attached
 * here, at the seam, and nowhere else.
 *
 * TypeScript does the checking: the library's LocalChecker has to satisfy our
 * LocalCheckerLike and its Verdict has to satisfy ours, or this file fails to build.
 */
import { createHash } from "node:crypto";
import { LocalChecker, type MailboxProbe, RemoteProbe, SmtpProbe } from "mailifier";
import type { LocalCheckerLike } from "./local.js";
import type { EmailVerifier, Verdict } from "./verifier.js";

export { RemoteProbeError } from "mailifier";

/** Stage-1 checks, with the library's own cached DoH resolver. */
export const defaultLocalChecker = (): LocalCheckerLike => new LocalChecker();

/**
 * Any mailifier probe as an EmailVerifier. Authoritative and free: the mail server
 * itself answered, and no one billed us for asking.
 */
class ProbeVerifier implements EmailVerifier {
  readonly name: string;
  readonly authoritative = true;
  readonly costsCredits = false;
  constructor(private readonly probe: MailboxProbe) {
    this.name = probe.name;
  }
  verify(email: string): Promise<Verdict> {
    return this.probe.verify(email);
  }
}

/**
 * Refusals about our IP, not the address: another prober's IP may get a real answer.
 * Greylisting is left out on purpose: it lifts for the same IP on a retry, and a new
 * IP starts the wait over.
 */
export const SECOND_OPINION_REASONS: ReadonlySet<string> = new Set([
  "no_ptr",
  "blocked",
  "unreachable",
]);

/** One prober host: its name (the URL's host, stamped on each verdict) and the probe. */
export interface FleetMember {
  host: string;
  probe: MailboxProbe;
}

/** Rendezvous order of `members` for a recipient domain: stable, and a new host moves only its share. */
export function fleetOrder<T extends { host: string }>(members: readonly T[], domain: string): T[] {
  const score = (host: string) =>
    createHash("sha256").update(`${host}\n${domain}`).digest().readUInt32BE(0);
  return [...members].sort((a, b) => score(b.host) - score(a.host));
}

/**
 * Several prober hosts, each with its own IP. A recipient domain always goes to the same
 * host first, so a mail server sees one IP at a steady pace and that host's catch-all
 * cache and refusal holds stay meaningful. When the home host's IP is refused
 * (`SECOND_OPINION_REASONS`) or the host is down, the next host asks once. Each verdict
 * says which host answered (`raw.prober`), so outcomes split by IP.
 */
export class ProbeFleet implements MailboxProbe {
  readonly name = "smtp";
  constructor(private readonly members: readonly FleetMember[]) {
    if (members.length === 0) throw new Error("a probe fleet needs at least one host");
  }

  async verify(email: string): Promise<Verdict> {
    const domain = (email.split("@").pop() ?? "").toLowerCase();
    const [home, next] = fleetOrder(this.members, domain);
    if (!home) throw new Error("unreachable: fleet is never empty");
    let first: Verdict;
    try {
      first = await home.probe.verify(email);
    } catch (err) {
      if (!next) throw err;
      return stamp(await next.probe.verify(email), next.host, { home_down: home.host });
    }
    const reason = String(first.raw.reason ?? "");
    if (next && first.result === "risky" && SECOND_OPINION_REASONS.has(reason)) {
      const second = await next.probe.verify(email).catch(() => null);
      if (second && second.result !== "risky") {
        return stamp(second, next.host, { first: { prober: home.host, reason } });
      }
    }
    return stamp(first, home.host);
  }
}

function stamp(v: Verdict, host: string, extra: Record<string, unknown> = {}): Verdict {
  return { result: v.result, raw: { ...v.raw, prober: host, ...extra } };
}

/**
 * Ask the prober hosts over HTTP: the Lambda's only way, port 25 being shut there.
 * `urls` is one URL or several, comma-separated; they share the bearer.
 */
export const remoteProbeVerifier = (urls: string, token: string): EmailVerifier =>
  new ProbeVerifier(
    new ProbeFleet(
      urls
        .split(",")
        .map((u) => u.trim())
        .filter(Boolean)
        .map((url) => ({ host: new URL(url).hostname, probe: new RemoteProbe(url, token) })),
    ),
  );

/** Do the handshake here. Only from a host that can open port 25 and owns the HELO name. */
export const directProbeVerifier = (helo: string): EmailVerifier =>
  new ProbeVerifier(new SmtpProbe({ helo }));
