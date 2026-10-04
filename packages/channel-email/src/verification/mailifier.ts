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
import { promises as dns } from "node:dns";
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

/** Whether a host may probe now: its IP's PTR names it (mail servers refuse an IP without one). */
export type Ready = (host: string) => Promise<boolean>;

/** PTR of the host's IP equals the host. Any lookup failure reads as not ready. */
export const ptrNamesHost: Ready = async (host) => {
  const [ip] = await dns.resolve4(host).catch(() => [] as string[]);
  if (!ip) return false;
  const names = await dns.reverse(ip).catch(() => [] as string[]);
  return names.some((n) => n.replace(/\.$/, "").toLowerCase() === host.toLowerCase());
};

/** Re-check each host's readiness at most this often. */
export const READY_TTL_MS = 60 * 60 * 1000;

/**
 * Several prober hosts, each with its own IP. Only hosts whose PTR names them probe;
 * an IP without one gets refused, and every refusal costs it standing. If no host is
 * ready, the first listed probes alone (the fleet then behaves as one prober), so a
 * new box can sit in the list and joins on its own once its PTR lands.
 *
 * Among ready hosts, a recipient domain always goes to the same host first, so a mail
 * server sees one IP at a steady pace and that host's catch-all cache and refusal holds
 * stay meaningful. When the home host's IP is refused (`SECOND_OPINION_REASONS`) or the
 * host is down, the next ready host asks once. Each verdict says which host answered
 * (`raw.prober`), so outcomes split by IP.
 */
export class ProbeFleet implements MailboxProbe {
  readonly name = "smtp";
  private readonly checked = new Map<string, { ready: boolean; at: number }>();
  constructor(
    private readonly members: readonly FleetMember[],
    private readonly ready: Ready = async () => true,
    private readonly now: () => number = Date.now,
  ) {
    if (members.length === 0) throw new Error("a probe fleet needs at least one host");
  }

  private async isReady(host: string): Promise<boolean> {
    const hit = this.checked.get(host);
    if (hit && this.now() - hit.at < READY_TTL_MS) return hit.ready;
    const ready = await this.ready(host).catch(() => false);
    this.checked.set(host, { ready, at: this.now() });
    return ready;
  }

  /** The hosts allowed to probe now, in list order. */
  private async active(): Promise<FleetMember[]> {
    const flags = await Promise.all(this.members.map((m) => this.isReady(m.host)));
    const ready = this.members.filter((_, i) => flags[i]);
    return ready.length > 0 ? ready : this.members.slice(0, 1);
  }

  async verify(email: string): Promise<Verdict> {
    const domain = (email.split("@").pop() ?? "").toLowerCase();
    const [home, next] = fleetOrder(await this.active(), domain);
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
 * `urls` is one URL or several, comma-separated; they share the bearer. A host probes
 * only while its PTR names it (`ptrNamesHost`), else the first listed probes alone.
 */
export const remoteProbeVerifier = (urls: string, token: string): EmailVerifier =>
  new ProbeVerifier(
    new ProbeFleet(
      urls
        .split(",")
        .map((u) => u.trim())
        .filter(Boolean)
        .map((url) => ({ host: new URL(url).hostname, probe: new RemoteProbe(url, token) })),
      ptrNamesHost,
    ),
  );

/** Do the handshake here. Only from a host that can open port 25 and owns the HELO name. */
export const directProbeVerifier = (helo: string): EmailVerifier =>
  new ProbeVerifier(new SmtpProbe({ helo }));
