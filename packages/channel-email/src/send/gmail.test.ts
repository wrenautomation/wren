/**
 * The Gmail wire, with no network anywhere (§4). Every request goes through
 * an injected fetch and every bearer comes from an injected token factory.
 */
import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { GmailApiError, GmailClient, GmailTransport, SEND_AND_READ_SCOPES } from "./gmail.js";
import {
  GMAIL_MODIFY_SCOPE,
  GMAIL_SEND_SCOPE,
  ServiceAccountKeyError,
  serviceAccountToken,
  TokenRefreshError,
  type TokenSupplier,
} from "./google-auth.js";
import { buildMime, formatAddress } from "./mime.js";
import { type OutgoingEmail, TransportAmbiguous, TransportRefused } from "./transport.js";

const SENDER = "will@wren-automation.com";

function mail(overrides: Partial<OutgoingEmail> = {}): OutgoingEmail {
  return {
    fromAddress: SENDER,
    fromName: "Will Jin",
    to: "jane@acme.example",
    subject: "Quick question, Jane",
    replySubject: null,
    body: "Hello there.\nTwo lines.",
    messageId: "<m1@wren-automation.com>",
    listUnsubscribe: `<mailto:${SENDER}?subject=unsubscribe>`,
    ...overrides,
  };
}

interface Seen {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}
type Handler = (req: Seen) => Response | Promise<Response>;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function build(
  handler: Handler,
  tokenFactory?: (sender: string) => TokenSupplier,
): { client: GmailClient; seen: Seen[] } {
  const seen: Seen[] = [];
  const client = new GmailClient({
    fetch: async (input, init = {}) => {
      const req: Seen = {
        url: new URL(input),
        method: init.method ?? "GET",
        headers: Object.fromEntries(Object.entries((init.headers as Record<string, string>) ?? {})),
        body: typeof init.body === "string" ? init.body : null,
      };
      seen.push(req);
      return handler(req);
    },
    scopes: SEND_AND_READ_SCOPES,
    tokenFactory: tokenFactory ?? ((sender) => async () => `token-for-${sender}`),
  });
  return { client, seen };
}

const accepted: Handler = () => jsonResponse(200, { id: "gmail-1", threadId: "thread-1" });
const error =
  (status: number, message = "nope"): Handler =>
  () =>
    jsonResponse(status, { error: { message } });
const raising =
  (err: Error): Handler =>
  () => {
    throw err;
  };
const fetchFailed = (code: string): Error =>
  new TypeError("fetch failed", { cause: Object.assign(new Error(code), { code }) });

/** The message as Gmail received it, parsed back: headers and the decoded parts. */
function sentMime(req: Seen | undefined): {
  headers: Record<string, string>;
  parts: Array<{ type: string; content: string }>;
} {
  if (!req) throw new Error("no request captured");
  const raw = (JSON.parse(req.body ?? "{}") as { raw: string }).raw;
  const text = Buffer.from(raw, "base64url").toString("utf8");
  return parseMime(text);
}

function parseMime(text: string): {
  headers: Record<string, string>;
  parts: Array<{ type: string; content: string }>;
} {
  const [head, ...rest] = text.split("\r\n\r\n");
  const headers: Record<string, string> = {};
  for (const line of (head ?? "").split("\r\n")) {
    const i = line.indexOf(": ");
    if (i > 0) headers[line.slice(0, i)] = line.slice(i + 2);
  }
  const boundary = /boundary="([^"]+)"/.exec(headers["Content-Type"] ?? "")?.[1] ?? "";
  const body = rest.join("\r\n\r\n");
  const parts = body
    .split(`--${boundary}`)
    .filter((p) => p.trim() && p.trim() !== "--")
    .map((p) => {
      const [partHead, ...partBody] = p.replace(/^\r\n/, "").split("\r\n\r\n");
      const type = /Content-Type: ([^;]+)/.exec(partHead ?? "")?.[1] ?? "";
      const content = Buffer.from(
        partBody.join("\r\n\r\n").replaceAll("\r\n", ""),
        "base64",
      ).toString("utf8");
      return { type, content };
    });
  return { headers, parts };
}

describe("what goes on the wire", () => {
  it("an opener is two parts with our own headers", async () => {
    const { client, seen } = build(accepted);
    const receipt = await new GmailTransport(client).send(mail());
    expect(receipt).toEqual({
      messageId: "<m1@wren-automation.com>",
      providerId: "gmail-1",
      threadId: "thread-1",
      internalDate: null,
    });
    const req = seen[0];
    if (!req) throw new Error("no request captured");
    expect(req.method).toBe("POST");
    expect(req.url.toString()).toBe("https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
    expect(req.headers.authorization).toBe(`Bearer token-for-${SENDER}`);
    const body = JSON.parse(req.body ?? "{}") as Record<string, unknown>;
    expect(body).not.toHaveProperty("threadId");
    const msg = sentMime(req);
    expect(msg.headers.From).toBe("Will Jin <will@wren-automation.com>");
    expect(msg.headers.To).toBe("jane@acme.example");
    expect(msg.headers.Subject).toBe("Quick question, Jane");
    expect(msg.headers["Message-ID"]).toBe("<m1@wren-automation.com>");
    expect(msg.headers["List-Unsubscribe"]).toBe(`<mailto:${SENDER}?subject=unsubscribe>`);
    expect(msg.headers.Date).toBeTruthy();
    expect(msg.headers["In-Reply-To"]).toBeUndefined();
    expect(msg.headers.References).toBeUndefined();
    expect(msg.headers["Content-Type"]).toMatch(/^multipart\/alternative; boundary=/);
    expect(msg.parts.map((p) => p.type)).toEqual(["text/plain", "text/html"]);
    expect(msg.parts[0]?.content).toBe("Hello there.\nTwo lines.");
    expect(msg.parts[1]?.content).toContain("Hello there.");
    const raw = Buffer.from(body.raw as string, "base64url")
      .toString("utf8")
      .toLowerCase();
    const decodedHtml = msg.parts[1]?.content.toLowerCase() ?? "";
    for (const forbidden of ["<img", "<script", "<link", "<style", "background:url", "srcset"]) {
      expect(decodedHtml).not.toContain(forbidden);
      expect(raw).not.toContain(forbidden);
    }
  });

  it("a tracked message carries the pixel and still nothing else", async () => {
    const { client, seen } = build(accepted);
    const url = "https://t.wrenautomation.com/p/PxJb3nQ7RtY2kLmW9dF4vAeH.gif";
    await new GmailTransport(client).send(mail({ pixelUrl: url }));
    const msg = sentMime(seen[0]);
    const html = msg.parts[1]?.content ?? "";
    expect(html).toContain(url);
    expect(html.toLowerCase().split("<img").length - 1).toBe(1);
    for (const forbidden of ["<script", "<link", "<style", "background:url", "srcset"]) {
      expect(html.toLowerCase()).not.toContain(forbidden);
    }
    expect(msg.parts[0]?.content).toBe("Hello there.\nTwo lines.");
  });

  it("a follow-up rides the thread by header and by thread id", async () => {
    const { client, seen } = build(accepted);
    await new GmailTransport(client).send(
      mail({
        subject: null,
        replySubject: "Quick question, Jane",
        messageId: "<m2@wren-automation.com>",
        inReplyTo: "<m1@wren-automation.com>",
        references: ["<m0@wren-automation.com>", "<m1@wren-automation.com>"],
        threadId: "thread-1",
      }),
    );
    const body = JSON.parse(seen[0]?.body ?? "{}") as { threadId?: string };
    expect(body.threadId).toBe("thread-1");
    const msg = sentMime(seen[0]);
    expect(msg.headers.Subject).toBe("Re: Quick question, Jane");
    expect(msg.headers["In-Reply-To"]).toBe("<m1@wren-automation.com>");
    expect(msg.headers.References?.split(" ")).toEqual([
      "<m0@wren-automation.com>",
      "<m1@wren-automation.com>",
    ]);
  });

  it("without a display name the From is the bare address", async () => {
    const { client, seen } = build(accepted);
    await new GmailTransport(client).send(mail({ fromName: null }));
    expect(sentMime(seen[0]).headers.From).toBe(SENDER);
  });

  it("a riding step with no opener subject still gets a header", async () => {
    const { client, seen } = build(accepted);
    await new GmailTransport(client).send(mail({ subject: null, replySubject: null }));
    expect(sentMime(seen[0]).headers.Subject).toBe("Re:");
  });

  it("a unicode body survives as utf-8 in both parts", async () => {
    const { client, seen } = build(accepted);
    await new GmailTransport(client).send(mail({ body: "Hola — café, naïve, 😀" }));
    const msg = sentMime(seen[0]);
    expect(msg.parts[0]?.content).toContain("café");
    expect(msg.parts[1]?.content).toContain("café");
    expect(msg.parts[1]?.content).toContain("😀");
  });

  it("names with specials or non-ascii are quoted or encoded", () => {
    expect(formatAddress("Jin, Will", "a@b.com")).toBe('"Jin, Will" <a@b.com>');
    expect(formatAddress("Zoë", "a@b.com")).toBe("=?utf-8?B?Wm/Dqw==?= <a@b.com>");
    expect(() => buildMime(mail({ to: "x@y.com\r\nBcc: z@w.com" }))).toThrow("line break");
  });

  it("a message without our id is refused before anything leaves", async () => {
    const { client, seen } = build(accepted);
    await expect(new GmailTransport(client).send(mail({ messageId: "  " }))).rejects.toMatchObject({
      name: "TransportRefused",
      senderLevel: false,
    });
    expect(seen).toEqual([]);
  });
});

describe("error mapping: did it leave?", () => {
  it("a connect failure never left and is not the inbox's fault", async () => {
    const { client } = build(raising(fetchFailed("ECONNREFUSED")));
    await expect(new GmailTransport(client).send(mail())).rejects.toMatchObject({
      name: "TransportRefused",
      senderLevel: false,
    });
  });
  it.each(["ECONNRESET", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_SOCKET"])(
    "a mid-flight failure is ambiguous because the bytes left (%s)",
    async (code) => {
      const { client } = build(raising(fetchFailed(code)));
      await expect(new GmailTransport(client).send(mail())).rejects.toBeInstanceOf(
        TransportAmbiguous,
      );
    },
  );
  it("an abort is ambiguous", async () => {
    const { client } = build(raising(Object.assign(new Error("aborted"), { name: "AbortError" })));
    await expect(new GmailTransport(client).send(mail())).rejects.toBeInstanceOf(
      TransportAmbiguous,
    );
  });
  it("a server error is ambiguous: gmail may have queued it", async () => {
    const { client } = build(error(500, "backend error"));
    await expect(new GmailTransport(client).send(mail())).rejects.toThrow("backend error");
    await expect(new GmailTransport(client).send(mail())).rejects.toBeInstanceOf(
      TransportAmbiguous,
    );
  });
  it.each([401, 403, 429])(
    "auth and rate refusals sideline the whole inbox (%i)",
    async (status) => {
      const { client } = build(error(status, "Delegation denied"));
      const err = await new GmailTransport(client).send(mail()).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(TransportRefused);
      expect((err as TransportRefused).senderLevel).toBe(true);
      expect((err as Error).message).toContain("Delegation denied");
    },
  );
  it("a bad request refuses only this message", async () => {
    const { client } = build(error(400, "Invalid To header"));
    await expect(new GmailTransport(client).send(mail())).rejects.toMatchObject({
      senderLevel: false,
    });
  });
  it("an unparseable accept is ambiguous, not a refusal", async () => {
    const a = build(() => new Response("<html>not json</html>", { status: 200 }));
    await expect(new GmailTransport(a.client).send(mail())).rejects.toBeInstanceOf(
      TransportAmbiguous,
    );
    const b = build(() => jsonResponse(200, { id: "gmail-1" }));
    await expect(new GmailTransport(b.client).send(mail())).rejects.toBeInstanceOf(
      TransportAmbiguous,
    );
  });
  it.each([
    new ServiceAccountKeyError("key missing"),
    new TokenRefreshError(400, "unauthorized_client", SENDER),
  ])("a token that will not mint sidelines the inbox (%s)", async (exc) => {
    const { client, seen } = build(accepted, () => async () => {
      throw exc;
    });
    const err = await new GmailTransport(client).send(mail()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TransportRefused);
    expect((err as TransportRefused).senderLevel).toBe(true);
    expect(seen).toEqual([]);
  });
  it("an unreachable token endpoint refuses without blaming the inbox", async () => {
    const { client } = build(accepted, () => async () => {
      throw fetchFailed("ECONNREFUSED");
    });
    const err = await new GmailTransport(client).send(mail()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TransportRefused);
    expect((err as TransportRefused).senderLevel).toBe(false);
  });
  it("the bearer never appears in a failure message", async () => {
    const { client } = build(error(403, "Delegation denied"));
    const err = await new GmailTransport(client).send(mail()).catch((e: unknown) => e);
    expect((err as Error).message).not.toContain("token-for-");
  });
});

const foundHandler: Handler = (req) =>
  req.url.pathname.endsWith("/messages")
    ? jsonResponse(200, { messages: [{ id: "gmail-9" }] })
    : jsonResponse(200, { id: "gmail-9", threadId: "thread-9", internalDate: "1757289600000" });

describe("find: what reconcile asks", () => {
  it("returns the provider handles and the time it landed", async () => {
    const { client, seen } = build(foundHandler);
    const receipt = await new GmailTransport(client).find(SENDER, "<m1@wren-automation.com>");
    expect(receipt?.providerId).toBe("gmail-9");
    expect(receipt?.threadId).toBe("thread-9");
    expect(receipt?.messageId).toBe("<m1@wren-automation.com>");
    expect(receipt?.internalDate?.getTime()).toBe(1757289600000);
    expect(seen[0]?.url.searchParams.get("q")).toBe("rfc822msgid:m1@wren-automation.com");
    expect(seen[1]?.url.searchParams.get("format")).toBe("metadata");
  });
  it("says no when the mailbox has nothing", async () => {
    const { client } = build(() => jsonResponse(200, {}));
    expect(await new GmailTransport(client).find(SENDER, "<m1@wren-automation.com>")).toBeNull();
  });
  it("says no when the listed message is already gone", async () => {
    const { client } = build((req) =>
      req.url.pathname.endsWith("/messages")
        ? jsonResponse(200, { messages: [{ id: "gmail-9" }] })
        : jsonResponse(404, { error: { message: "Not Found" } }),
    );
    expect(await new GmailTransport(client).find(SENDER, "<m1@wren-automation.com>")).toBeNull();
  });
  it("a mailbox that will not answer raises rather than saying no", async () => {
    const { client } = build(error(500, "backend error"));
    const err = await new GmailTransport(client)
      .find(SENDER, "<m1@wren-automation.com>")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GmailApiError);
    expect((err as GmailApiError).status).toBe(500);
    expect((err as GmailApiError).sender).toBe(SENDER);
  });
});

describe("the client: tokens and the read side", () => {
  it("one token supplier per sender", async () => {
    const minted: string[] = [];
    const { client } = build(accepted, (sender) => {
      minted.push(sender);
      return async () => `token-for-${sender}`;
    });
    const transport = new GmailTransport(client);
    await transport.send(mail());
    await transport.send(mail({ messageId: "<m2@wren-automation.com>" }));
    await transport.send(mail({ fromAddress: "sam@wren-automation.org" }));
    expect(minted).toEqual([SENDER, "sam@wren-automation.org"]);
  });
  it("list messages pages through the cursor", async () => {
    const { client, seen } = build((req) =>
      req.url.searchParams.has("pageToken")
        ? jsonResponse(200, { messages: [{ id: "c" }] })
        : jsonResponse(200, { messages: [{ id: "a" }, { id: "b" }], nextPageToken: "page-2" }),
    );
    let [ids, token] = await client.listMessages(SENDER, "after:1757289600", { maxResults: 2 });
    expect([ids, token]).toEqual([["a", "b"], "page-2"]);
    expect(seen[0]?.url.searchParams.get("q")).toBe("after:1757289600");
    expect(seen[0]?.url.searchParams.get("maxResults")).toBe("2");
    [ids, token] = await client.listMessages(SENDER, "after:1757289600", { pageToken: token });
    expect([ids, token]).toEqual([["c"], null]);
    expect(seen[0]?.url.searchParams.has("includeSpamTrash")).toBe(false);
  });
  it("list messages can be told to read spam and trash", async () => {
    const { client, seen } = build(() => jsonResponse(200, { messages: [{ id: "a" }] }));
    expect(await client.listMessages(SENDER, "after:1", { includeSpamTrash: true })).toEqual([
      ["a"],
      null,
    ]);
    expect(seen[0]?.url.searchParams.get("includeSpamTrash")).toBe("true");
  });
  it("get metadata asks for exactly the headers it names", async () => {
    const payload = { id: "gmail-9", payload: { headers: [{ name: "Subject", value: "hi" }] } };
    const { client, seen } = build(() => jsonResponse(200, payload));
    expect(await client.getMetadata(SENDER, "gmail-9", ["Subject", "From"])).toEqual(payload);
    expect(seen[0]?.url.searchParams.getAll("metadataHeaders")).toEqual(["Subject", "From"]);
  });
  it("get raw decodes gmail's unpadded base64url", async () => {
    const body = Buffer.from("From: a@b.com\r\nSubject: hi\r\n\r\nbody\r\n");
    const { client, seen } = build(() => jsonResponse(200, { raw: body.toString("base64url") }));
    expect((await client.getRaw(SENDER, "gmail-9")).equals(body)).toBe(true);
    expect(seen[0]?.url.searchParams.get("format")).toBe("raw");
  });
  it("the read side asks for modify, not readonly", () => {
    expect(SEND_AND_READ_SCOPES).toEqual([GMAIL_SEND_SCOPE, GMAIL_MODIFY_SCOPE]);
    expect(GMAIL_MODIFY_SCOPE.endsWith("gmail.modify")).toBe(true);
  });
});

describe("service-account tokens", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const key = {
    clientEmail: "wren-sender@project.iam.gserviceaccount.com",
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    tokenUri: "https://oauth2.googleapis.com/token",
  };

  it("mints a signed jwt-bearer assertion acting as the subject and caches it", async () => {
    const calls: string[] = [];
    let clock = new Date("2026-09-08T13:00:00Z");
    const supplier = serviceAccountToken(key, {
      scopes: SEND_AND_READ_SCOPES,
      subject: SENDER,
      now: () => clock,
      fetch: async (input, init = {}) => {
        calls.push(input);
        const form = new URLSearchParams(init.body as string);
        expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
        const [h, p, s] = (form.get("assertion") ?? "").split(".");
        expect(JSON.parse(Buffer.from(h ?? "", "base64url").toString())).toEqual({
          alg: "RS256",
          typ: "JWT",
        });
        const claims = JSON.parse(Buffer.from(p ?? "", "base64url").toString()) as Record<
          string,
          unknown
        >;
        expect(claims.sub).toBe(SENDER);
        expect(claims.iss).toBe(key.clientEmail);
        expect(claims.scope).toBe(`${GMAIL_SEND_SCOPE} ${GMAIL_MODIFY_SCOPE}`);
        expect(claims.aud).toBe(key.tokenUri);
        const { createVerify } = await import("node:crypto");
        const verifier = createVerify("RSA-SHA256");
        verifier.update(`${h}.${p}`);
        expect(verifier.verify(publicKey, s ?? "", "base64url")).toBe(true);
        return jsonResponse(200, { access_token: "ya29.abc", expires_in: 3600 });
      },
    });
    expect(await supplier()).toBe("ya29.abc");
    expect(await supplier()).toBe("ya29.abc");
    expect(calls).toHaveLength(1);
    clock = new Date(clock.getTime() + 3600_000);
    await supplier();
    expect(calls).toHaveLength(2);
  });

  it("a refusal from google is a TokenRefreshError without the assertion in it", async () => {
    const supplier = serviceAccountToken(key, {
      scopes: [GMAIL_SEND_SCOPE],
      subject: SENDER,
      fetch: async () =>
        jsonResponse(401, {
          error: "unauthorized_client",
          error_description: "Client is unauthorized",
        }),
    });
    const err = await supplier().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TokenRefreshError);
    expect((err as Error).message).toContain("unauthorized_client: Client is unauthorized");
    expect((err as Error).message).not.toContain("eyJ");
  });
});
