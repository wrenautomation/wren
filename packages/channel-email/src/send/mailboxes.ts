/**
 * SMTP/IMAP logins for the roster's `transport = "smtp"` inboxes: one JSON
 * file, `{ "<address>": { smtp: {host, port, user, pass}, imap: {...} } }`,
 * written by autobrowse (SSM `/wren/prod/mailboxes` on Lambda). It holds
 * passwords, so no message here ever quotes a value: only addresses and keys.
 */
import { existsSync, readFileSync } from "node:fs";
import { ImapFlow } from "imapflow";

/** One server login. */
export interface Login {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly pass: string;
}

export interface Mailbox {
  readonly smtp: Login;
  readonly imap: Login;
}

/** Lowercased address → its logins. */
export type Mailboxes = ReadonlyMap<string, Mailbox>;

function loginOf(raw: unknown, at: string): Login {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`${at}: must be an object with host, port, user, pass`);
  }
  const { host, port, user, pass } = raw as Record<string, unknown>;
  for (const [key, value] of [
    ["host", host],
    ["user", user],
    ["pass", pass],
  ] as const) {
    if (typeof value !== "string" || !value)
      throw new Error(`${at}.${key} must be a non-empty string`);
  }
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${at}.port must be a port number`);
  }
  return { host: host as string, port, user: user as string, pass: pass as string };
}

/** Parse the file's text; `where` names it in errors. */
export function parseMailboxes(text: string, where: string): Map<string, Mailbox> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`${where} is not valid JSON`);
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error(`${where} must be a JSON object of address → {smtp, imap}`);
  }
  const out = new Map<string, Mailbox>();
  for (const [address, entry] of Object.entries(data)) {
    const at = `${where} ${address}`;
    if (typeof entry !== "object" || entry === null) throw new Error(`${at}: must be {smtp, imap}`);
    const { smtp, imap } = entry as Record<string, unknown>;
    out.set(address.toLowerCase(), {
      smtp: loginOf(smtp, `${at}.smtp`),
      imap: loginOf(imap, `${at}.imap`),
    });
  }
  return out;
}

/** The logins at `path`; no path = none (a fleet on Gmail alone). A named file that is missing is an error. */
export function loadMailboxes(path: string | undefined): Map<string, Mailbox> {
  if (!path) return new Map();
  if (!existsSync(path)) throw new Error(`mailboxes file not found at ${path}`);
  return parseMailboxes(readFileSync(path, "utf8"), path);
}

// --- IMAP sessions, shared by SmtpTransport (Sent) and ImapReader (INBOX, spam) ---

/** A client for this login: TLS on 993, STARTTLS required elsewhere; no logger, which would print the login. */
export function imapClient(login: Login): ImapFlow {
  const secure = login.port === 993;
  return new ImapFlow({
    host: login.host,
    port: login.port,
    secure,
    doSTARTTLS: secure ? undefined : true,
    auth: { user: login.user, pass: login.pass },
    logger: false,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
  });
}

/** One session: connect, run, log out (close when the logout fails). */
export async function withImap<T>(
  client: ImapFlow,
  run: (client: ImapFlow) => Promise<T>,
): Promise<T> {
  // A dropped socket rejects the command in flight; the bare event must not crash the process.
  client.on("error", () => {});
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.logout().catch(() => client.close());
  }
}

/** The folder flagged `use` (`\Sent`, `\Junk`), or null. */
export async function specialFolder(client: ImapFlow, use: string): Promise<string | null> {
  return (await client.list()).find((f) => f.specialUse === use)?.path ?? null;
}

/** `run` with `path` open read-only (EXAMINE: no flag ever changes), given its UIDVALIDITY. */
export async function inFolder<T>(
  client: ImapFlow,
  path: string,
  run: (uidValidity: string) => Promise<T>,
): Promise<T> {
  const lock = await client.getMailboxLock(path, { readOnly: true });
  try {
    if (!client.mailbox) throw new Error(`imap: ${path} did not open`);
    return await run(String(client.mailbox.uidValidity));
  } finally {
    lock.release();
  }
}
