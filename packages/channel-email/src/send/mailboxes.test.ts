/**
 * Inboxes on their own login: the mailboxes file, `SmtpTransport` against a fake SMTP
 * server on loopback, and `ImapReader` against an in-memory IMAP fake. Synthetic data only.
 */
import { createServer, type Server } from "node:net";
import type { ImapFlow } from "imapflow";
import SMTPConnection from "nodemailer/lib/smtp-connection";
import { afterEach, describe, expect, it } from "vitest";
import { ImapReader, RoutedReader } from "../inbox/imap.js";
import { type Login, type Mailbox, parseMailboxes } from "./mailboxes.js";
import { SmtpTransport, threadOf } from "./smtp.js";
import { type OutgoingEmail, TransportAmbiguous, TransportRefused } from "./transport.js";

const ANN = "ann@example.com";

describe("the mailboxes file", () => {
  const login = { host: "mail.example.com", port: 465, user: ANN, pass: "s3cret-value" };
  it("parses, keyed by lowercased address", () => {
    const text = JSON.stringify({
      "Ann@Example.com": { smtp: login, imap: { ...login, port: 993 } },
    });
    const boxes = parseMailboxes(text, "test");
    expect(boxes.get(ANN)?.imap.port).toBe(993);
  });
  it.each([
    ["not json", /not valid JSON/],
    ["[]", /must be a JSON object/],
    [JSON.stringify({ [ANN]: { smtp: login } }), /imap: must be an object/],
    [JSON.stringify({ [ANN]: { smtp: { ...login, port: "465" }, imap: login } }), /port must be/],
    [JSON.stringify({ [ANN]: { smtp: { ...login, pass: "" }, imap: login } }), /pass must be/],
  ])("refuses %j and never quotes a value", (text, match) => {
    expect(() => parseMailboxes(text, "test")).toThrow(match);
    try {
      parseMailboxes(text, "test");
    } catch (err) {
      expect((err as Error).message).not.toContain("s3cret");
    }
  });
});

// ---------------------------------------------------------------------------
// A fake IMAP server's client: folders of raw messages, every open recorded.

interface Stored {
  uid: number;
  raw: Buffer;
  date: Date;
}
interface Folder {
  specialUse?: string;
  uidValidity: bigint;
  messages: Stored[];
}

/** The header fields of `raw` named in `names` (folded lines kept), as a server returns them. */
function headerFields(raw: Buffer, names: readonly string[]): Buffer {
  const head = raw.toString("utf8").split("\r\n\r\n")[0] ?? "";
  const wanted = new Set(names.map((n) => n.toLowerCase()));
  const fields = head.split(/\r\n(?![ \t])/);
  const kept = fields.filter((f) => wanted.has(f.slice(0, f.indexOf(":")).toLowerCase()));
  return Buffer.from(`${kept.join("\r\n")}\r\n\r\n`);
}

const messageIdOf = (raw: Buffer) => /^message-id:\s*(\S+)/im.exec(raw.toString("utf8"))?.[1];

class FakeImap {
  folders = new Map<string, Folder>();
  mailbox: { uidValidity: bigint } | false = false;
  opened: { path: string; readOnly: boolean }[] = [];
  appended: { path: string; flags: string[] }[] = [];
  down = false;
  private current = "";

  on() {
    return this;
  }
  async connect() {
    if (this.down) throw new Error("connect ECONNREFUSED");
  }
  async logout() {}
  close() {}
  async list() {
    return [...this.folders].map(([path, f]) => ({ path, specialUse: f.specialUse }));
  }
  async getMailboxLock(path: string, opts?: { readOnly?: boolean }) {
    const folder = this.folders.get(path);
    if (!folder) throw new Error(`no folder ${path}`);
    this.opened.push({ path, readOnly: opts?.readOnly ?? false });
    this.current = path;
    this.mailbox = { uidValidity: folder.uidValidity };
    return { release: () => (this.mailbox = false) };
  }
  private here(): Stored[] {
    return this.folders.get(this.current)?.messages ?? [];
  }
  async search(q: { header?: Record<string, string> }) {
    const id = q.header?.["message-id"];
    return this.here()
      .filter((m) => messageIdOf(m.raw) === id)
      .map((m) => m.uid);
  }
  private shape(m: Stored, q: { internalDate?: boolean; headers?: string[]; source?: boolean }) {
    return {
      uid: m.uid,
      ...(q.internalDate ? { internalDate: m.date } : {}),
      ...(q.headers ? { headers: headerFields(m.raw, q.headers) } : {}),
      ...(q.source ? { source: m.raw } : {}),
    };
  }
  async fetchAll(range: { since: Date }, q: { headers?: string[] }) {
    // SINCE compares whole days.
    const day = range.since.toISOString().slice(0, 10);
    return this.here()
      .filter((m) => m.date.toISOString().slice(0, 10) >= day)
      .map((m) => this.shape(m, { ...q, internalDate: true }));
  }
  async fetchOne(uid: string, q: { internalDate?: boolean; headers?: string[]; source?: boolean }) {
    const m = this.here().find((x) => String(x.uid) === uid);
    return m ? this.shape(m, q) : false;
  }
  async append(path: string, raw: Buffer, flags: string[]) {
    const folder = this.folders.get(path);
    if (!folder) throw new Error(`no folder ${path}`);
    const uid = folder.messages.length + 1;
    folder.messages.push({ uid, raw, date: new Date("2026-10-05T15:00:00Z") });
    this.appended.push({ path, flags });
    return { destination: path, uidValidity: folder.uidValidity, uid };
  }
}

function fakeImap(): FakeImap {
  const imap = new FakeImap();
  imap.folders.set("INBOX", { uidValidity: 11n, messages: [] });
  imap.folders.set("Sent Items", { specialUse: "\\Sent", uidValidity: 7n, messages: [] });
  imap.folders.set("Junk", { specialUse: "\\Junk", uidValidity: 12n, messages: [] });
  return imap;
}
const asClient = (imap: FakeImap) => () => imap as unknown as ImapFlow;

// ---------------------------------------------------------------------------
// A fake SMTP server on loopback, told how to answer each stage.

interface Script {
  greet?: boolean;
  auth?: string;
  rcpt?: string;
  /** The reply to the end of DATA; "drop" hangs up instead. */
  data?: string;
}

const servers: Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

async function fakeSmtp(script: Script = {}): Promise<{ port: number; received: string[] }> {
  const received: string[] = [];
  const server = createServer((socket) => {
    socket.on("error", () => {});
    if (script.greet === false) return void socket.destroy();
    socket.write("220 mx.example.com ESMTP\r\n");
    let buffer = "";
    let inData = false;
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      for (let at = buffer.indexOf("\r\n"); at >= 0; at = buffer.indexOf("\r\n")) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        if (inData) {
          if (line !== ".") continue;
          inData = false;
          if (script.data === "drop") return void socket.destroy();
          socket.write(`${script.data ?? "250 2.0.0 queued"}\r\n`);
          continue;
        }
        const verb = line.split(" ")[0]?.toUpperCase();
        received.push(verb === "AUTH" ? "AUTH" : line);
        if (verb === "EHLO") socket.write("250-mx.example.com\r\n250 AUTH PLAIN\r\n");
        else if (verb === "AUTH") socket.write(`${script.auth ?? "235 2.7.0 ok"}\r\n`);
        else if (verb === "MAIL") socket.write("250 2.1.0 ok\r\n");
        else if (verb === "RCPT") socket.write(`${script.rcpt ?? "250 2.1.5 ok"}\r\n`);
        else if (verb === "DATA") {
          inData = true;
          socket.write("354 go ahead\r\n");
        } else if (verb === "QUIT") socket.end("221 bye\r\n");
        else socket.write("502 5.5.2 what\r\n");
      }
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { port: (server.address() as { port: number }).port, received };
}

/** A port nobody listens on. */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  await new Promise((resolve) => server.close(resolve));
  return port;
}

const loopback = (login: Login) =>
  new SMTPConnection({
    host: "127.0.0.1",
    port: login.port,
    ignoreTLS: true,
    connectionTimeout: 2000,
    greetingTimeout: 2000,
    socketTimeout: 2000,
  });

const mailboxOn = (port: number): Mailbox => ({
  smtp: { host: "127.0.0.1", port, user: ANN, pass: "pw" },
  imap: { host: "127.0.0.1", port: 993, user: ANN, pass: "pw" },
});

const OPENER: OutgoingEmail = {
  fromAddress: ANN,
  fromName: "Ann",
  to: "lead@example.org",
  subject: "A question",
  replySubject: null,
  body: "Hi.\n\nAnn",
  messageId: "<m1@example.com>",
};

describe("SmtpTransport", () => {
  it("sends our bytes, files a read copy in Sent, and threads by the first id", async () => {
    const { port, received } = await fakeSmtp();
    const imap = fakeImap();
    const smtp = new SmtpTransport(mailboxOn(port), { smtp: loopback, imap: asClient(imap) });
    const receipt = await smtp.send(OPENER);
    expect(received).toEqual(
      expect.arrayContaining(["AUTH", "MAIL FROM:<ann@example.com>", "RCPT TO:<lead@example.org>"]),
    );
    expect(receipt).toEqual({
      messageId: OPENER.messageId,
      providerId: "7:1",
      threadId: threadOf(OPENER.messageId),
      internalDate: null,
    });
    expect(imap.appended).toEqual([{ path: "Sent Items", flags: ["\\Seen"] }]);
    // A follow-up rides the opener's thread.
    const followUp = { ...OPENER, messageId: "<m2@example.com>", inReplyTo: OPENER.messageId };
    expect((await smtp.send(followUp)).threadId).toBe(threadOf(OPENER.messageId));
  });

  it("does not file twice when the server already did", async () => {
    const { port } = await fakeSmtp();
    const imap = fakeImap();
    const raw = Buffer.from(`Message-ID: ${OPENER.messageId}\r\nSubject: x\r\n\r\nbody\r\n`);
    imap.folders
      .get("Sent Items")
      ?.messages.push({ uid: 40, raw, date: new Date("2026-10-05T15:00:00Z") });
    const smtp = new SmtpTransport(mailboxOn(port), { smtp: loopback, imap: asClient(imap) });
    const receipt = await smtp.send(OPENER);
    expect(imap.appended).toEqual([]);
    expect([receipt.providerId, receipt.internalDate?.toISOString()]).toEqual([
      "7:40",
      "2026-10-05T15:00:00.000Z",
    ]);
  });

  it("a Sent copy that cannot be filed does not fail the send", async () => {
    const { port } = await fakeSmtp();
    const imap = fakeImap();
    imap.down = true;
    const smtp = new SmtpTransport(mailboxOn(port), { smtp: loopback, imap: asClient(imap) });
    expect((await smtp.send(OPENER)).providerId).toBe("unfiled");
  });

  it.each([
    ["no server at all", "closed", true],
    ["hangs up before the greeting", { greet: false }, true],
    ["login refused", { auth: "535 5.7.8 bad credentials" }, true],
    ["recipient refused", { rcpt: "550 5.1.1 no such user" }, false],
    ["message refused at the end of DATA", { data: "554 5.7.1 rejected" }, true],
  ] as const)("refused: %s (inbox sidelined: %s)", async (_what, script, senderLevel) => {
    const port = script === "closed" ? await closedPort() : (await fakeSmtp(script)).port;
    const smtp = new SmtpTransport(mailboxOn(port), { smtp: loopback, imap: asClient(fakeImap()) });
    const err = await smtp.send(OPENER).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TransportRefused);
    expect((err as TransportRefused).senderLevel).toBe(senderLevel);
    expect((err as Error).message).not.toContain("pw");
  });

  it("ambiguous: the line drops after the message went", async () => {
    const { port } = await fakeSmtp({ data: "drop" });
    const smtp = new SmtpTransport(mailboxOn(port), { smtp: loopback, imap: asClient(fakeImap()) });
    await expect(smtp.send(OPENER)).rejects.toBeInstanceOf(TransportAmbiguous);
  });

  it("a message that cannot be built is refused before any connection", async () => {
    const smtp = new SmtpTransport(mailboxOn(await closedPort()), { smtp: loopback });
    const err = await smtp.send({ ...OPENER, subject: "a\r\nBcc: x@example.net" }).catch((e) => e);
    expect(err).toBeInstanceOf(TransportRefused);
    expect((err as TransportRefused).senderLevel).toBe(false);
  });

  it("find looks our Message-ID up in Sent, read-only", async () => {
    const imap = fakeImap();
    const raw = Buffer.from(
      `Message-ID: <m2@example.com>\r\nReferences: <m0@example.com>\r\n <m1@example.com>\r\nIn-Reply-To: <m1@example.com>\r\n\r\nbody\r\n`,
    );
    imap.folders
      .get("Sent Items")
      ?.messages.push({ uid: 3, raw, date: new Date("2026-10-05T15:00:00Z") });
    const smtp = new SmtpTransport(mailboxOn(1), { imap: asClient(imap) });
    expect(await smtp.find(ANN, "<m2@example.com>")).toEqual({
      messageId: "<m2@example.com>",
      providerId: "7:3",
      threadId: threadOf("<m0@example.com>"),
      internalDate: new Date("2026-10-05T15:00:00Z"),
    });
    expect(await smtp.find(ANN, "<nope@example.com>")).toBeNull();
    expect(imap.opened.every((o) => o.readOnly)).toBe(true);
    imap.folders.delete("Sent Items");
    await expect(smtp.find(ANN, "<m2@example.com>")).rejects.toThrow(/no Sent folder/);
  });
});

describe("ImapReader", () => {
  const AFTER = Date.parse("2026-10-05T12:00:00Z") / 1000;
  const reply = (id: string) =>
    Buffer.from(
      `Message-ID: <${id}@example.org>\r\nFrom: Lead <lead@example.org>\r\nSubject: Re: A question\r\n` +
        `References: <m0@example.com>\r\n <m1@example.com>\r\nX-Other: not asked for\r\n\r\nYes please.\r\n`,
    );
  function stocked(): FakeImap {
    const imap = fakeImap();
    imap.folders.get("INBOX")?.messages.push(
      { uid: 1, raw: reply("old"), date: new Date("2026-10-05T09:00:00Z") }, // before `after`
      { uid: 2, raw: reply("r1"), date: new Date("2026-10-05T14:00:00Z") },
    );
    imap.folders
      .get("Junk")
      ?.messages.push({ uid: 9, raw: reply("r2"), date: new Date("2026-10-06T08:00:00Z") });
    // Sent is never read.
    imap.folders
      .get("Sent Items")
      ?.messages.push({ uid: 5, raw: reply("ours"), date: new Date("2026-10-06T08:00:00Z") });
    return imap;
  }

  it("lists INBOX and spam after the cursor, ids tagged by folder, validity and inbox", async () => {
    const imap = stocked();
    const reader = new ImapReader(mailboxOn(1), { imap: asClient(imap) });
    const [ids, next] = await reader.listMessages(ANN, `after:${AFTER} -in:sent -in:draft`);
    expect(next).toBeNull();
    expect(ids).toHaveLength(2);
    expect(ids[0]).toMatch(/^inbox:11:2:[0-9a-f]{8}$/);
    expect(ids[1]).toMatch(/^spam:12:9:[0-9a-f]{8}$/);
    expect(imap.opened.map((o) => o.path)).toEqual(["INBOX", "Junk"]);
    expect(imap.opened.every((o) => o.readOnly)).toBe(true);
  });

  it("metadata comes back in Gmail's shape, the asked headers unfolded", async () => {
    const imap = stocked();
    const reader = new ImapReader(mailboxOn(1), { imap: asClient(imap) });
    const [ids] = await reader.listMessages(ANN, `after:${AFTER}`);
    const id = ids[0] as string;
    const expected = {
      payload: {
        headers: [
          { name: "Message-ID", value: "<r1@example.org>" },
          { name: "From", value: "Lead <lead@example.org>" },
          { name: "Subject", value: "Re: A question" },
          { name: "References", value: "<m0@example.com> <m1@example.com>" },
        ],
      },
      internalDate: String(Date.parse("2026-10-05T14:00:00Z")),
      threadId: null,
    };
    expect(await reader.getMetadata(ANN, id)).toEqual(expected);
    // A fresh reader (no listing cached) fetches the same shape.
    const cold = new ImapReader(mailboxOn(1), { imap: asClient(imap) });
    expect(await cold.getMetadata(ANN, id)).toEqual(expected);
    expect(Buffer.from(await cold.getRaw(ANN, id)).toString("utf8")).toContain("Yes please.");
  });

  it("refuses an id from another inbox or a renumbered folder", async () => {
    const imap = stocked();
    const reader = new ImapReader(mailboxOn(1), { imap: asClient(imap) });
    const [ids] = await reader.listMessages(ANN, `after:${AFTER}`);
    const id = ids[0] as string;
    await expect(reader.getRaw("bo@example.com", id)).rejects.toThrow(/not an id from/);
    const inbox = imap.folders.get("INBOX");
    if (inbox) inbox.uidValidity = 99n;
    await expect(reader.getRaw(ANN, id)).rejects.toThrow(/renumbered/);
  });

  it("RoutedReader sends each inbox to its own reader", async () => {
    const reader = new ImapReader(mailboxOn(1), { imap: asClient(stocked()) });
    const gmailCalls: string[] = [];
    const gmail = {
      listMessages: async (sender: string) => {
        gmailCalls.push(sender);
        return [[], null] as [string[], null];
      },
      getMetadata: async () => ({}),
      getRaw: async () => new Uint8Array(),
    };
    const routed = new RoutedReader(gmail, new Map([[ANN, reader]]));
    expect((await routed.listMessages("Ann@example.com", `after:${AFTER}`, {}))[0]).toHaveLength(2);
    await routed.listMessages("will@example.com", `after:${AFTER}`, {});
    expect(gmailCalls).toEqual(["will@example.com"]);
  });
});
