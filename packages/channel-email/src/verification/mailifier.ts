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

/** Ask the prober host over HTTP: the Lambda's only way, port 25 being shut there. */
export const remoteProbeVerifier = (url: string, token: string): EmailVerifier =>
  new ProbeVerifier(new RemoteProbe(url, token));

/** Do the handshake here. Only from a host that can open port 25 and owns the HELO name. */
export const directProbeVerifier = (helo: string): EmailVerifier =>
  new ProbeVerifier(new SmtpProbe({ helo }));
