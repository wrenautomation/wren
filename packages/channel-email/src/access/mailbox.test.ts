// A connected mailbox as the Monitor's Mailbox, on fake Gmail and Graph APIs: no network.
import { describe, expect, it } from "vitest";
import {
  gmailMailbox,
  gmailReply,
  graphMailbox,
  graphMetaOf,
  graphReply,
  MailApiError,
  replySubject,
} from "./mailbox.js";

type Route = (url: URL) => { status?: number; body: unknown } | undefined;

function api(route: Route) {
  const asked: string[] = [];
  const auths: string[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    asked.push(url);
    auths.push(String((init?.headers as Record<string, string>)?.authorization ?? ""));
    const r = route(new URL(url));
    if (!r) return new Response("nope", { status: 404 });
    return Response.json(r.body, { status: r.status ?? 200 });
  };
  return { fetch, asked, auths };
}

describe("gmailMailbox", () => {
  it("pages a search and reads metadata on the mailbox's token", async () => {
    const a = api((u) => {
      if (u.pathname.endsWith("/messages") && !u.searchParams.get("pageToken"))
        return { body: { messages: [{ id: "m1" }], nextPageToken: "p2" } };
      if (u.pathname.endsWith("/messages")) return { body: { messages: [{ id: "m2" }] } };
      if (u.pathname.endsWith("/messages/m1"))
        return {
          body: {
            id: "m1",
            threadId: "t1",
            snippet: "Hi &amp; hello",
            internalDate: "1790000000000",
            payload: {
              headers: [
                { name: "From", value: "Bo Lee <bo@client.example>" },
                { name: "Subject", value: "Quote" },
              ],
            },
          },
        };
      return undefined;
    });
    const box = gmailMailbox(a.fetch, "ann@acme.example", async () => "tok");
    expect(await box.search("in:inbox after:1")).toEqual(["m1", "m2"]);
    const m = await box.meta("m1");
    expect(m).toMatchObject({ id: "m1", fromAddress: "bo@client.example", subject: "Quote" });
    expect(a.auths.every((x) => x === "Bearer tok")).toBe(true);
    expect(a.asked.at(-1)).toContain("format=metadata");
  });

  it("a 401 is a MailApiError with its status", async () => {
    const a = api(() => ({ status: 401, body: { error: { message: "Invalid Credentials" } } }));
    const err = await gmailMailbox(a.fetch, "a@b.c", async () => "t")
      .search("x")
      .catch((e) => e);
    expect(err).toBeInstanceOf(MailApiError);
    expect(err.status).toBe(401);
  });
});

describe("graphMailbox", () => {
  it("reads the inbox since the query's after:, and Outlook's own link", async () => {
    const a = api((u) => {
      if (u.pathname.endsWith("/mailFolders/inbox/messages") && !u.searchParams.get("$skip"))
        return {
          body: {
            value: [{ id: "g1" }],
            "@odata.nextLink":
              "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$skip=1",
          },
        };
      if (u.pathname.endsWith("/mailFolders/inbox/messages"))
        return { body: { value: [{ id: "g2" }] } };
      if (u.pathname.endsWith("/messages/g1"))
        return {
          body: {
            id: "g1",
            conversationId: "c1",
            subject: "Hi",
            bodyPreview: "Can we talk",
            receivedDateTime: "2026-10-07T12:00:00Z",
            webLink: "https://outlook.office365.com/owa/?ItemID=g1",
            from: { emailAddress: { name: "Bo", address: "BO@client.example" } },
          },
        };
      return undefined;
    });
    const box = graphMailbox(a.fetch, "ann@acme.example", async () => "tok");
    expect(await box.search("in:inbox after:1790000000")).toEqual(["g1", "g2"]);
    const first = new URL(a.asked[0] ?? "");
    expect(first.searchParams.get("$filter")).toBe(
      `receivedDateTime ge ${new Date(1790000000 * 1000).toISOString()}`,
    );
    const m = await box.meta("g1");
    expect(m).toMatchObject({
      threadId: "c1",
      fromAddress: "bo@client.example",
      link: "https://outlook.office365.com/owa/?ItemID=g1",
    });
  });

  it("never follows a next link off Graph", async () => {
    const a = api(() => ({
      body: { value: [{ id: "g1" }], "@odata.nextLink": "https://evil.example/steal" },
    }));
    expect(await graphMailbox(a.fetch, "a@b.c", async () => "t").search("x")).toEqual(["g1"]);
    expect(a.asked.some((u) => u.includes("evil"))).toBe(false);
  });

  it("a message with no sender reads as blank", () => {
    expect(graphMetaOf({ id: "x" })).toMatchObject({ fromAddress: "", subject: "", link: null });
  });
});

/** A fake provider that records each write's method, path and JSON body. */
function writes(answer: (path: string) => { status?: number; body?: unknown } | undefined) {
  const posts: { method: string; path: string; body: unknown }[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const method = init?.method ?? "GET";
    if (method === "POST")
      posts.push({ method, path: u.pathname, body: JSON.parse(String(init?.body ?? "null")) });
    const r = answer(`${method} ${u.pathname}`);
    if (!r) return new Response("nope", { status: 404 });
    return r.body === undefined
      ? new Response(null, { status: r.status ?? 202 })
      : Response.json(r.body, { status: r.status ?? 200 });
  };
  return { fetch, posts };
}

const TO = {
  messageId: "m1",
  threadId: "t1",
  to: "lee@patient.example",
  subject: "Quote for a crown?",
};

describe("replySubject", () => {
  it("adds Re once", () => {
    expect(replySubject("Quote")).toBe("Re: Quote");
    expect(replySubject("RE: Quote")).toBe("RE: Quote");
    expect(replySubject("Quote\r\nBcc: x@y.example")).toBe("Re: Quote Bcc: x@y.example");
  });
});

describe("gmailReply", () => {
  it("threads by Gmail's thread id and the original's Message-ID and References", async () => {
    const g = writes((at) => {
      if (at === "GET /gmail/v1/users/me/messages/m1")
        return {
          body: {
            id: "m1",
            payload: {
              headers: [
                { name: "Message-ID", value: "<orig@patient.example>" },
                { name: "References", value: "<first@kappa.example>" },
              ],
            },
          },
        };
      if (at === "POST /gmail/v1/users/me/messages/send")
        return { body: { id: "s1", threadId: "t1" } };
      return undefined;
    });
    const out = await gmailReply(g.fetch, async () => "tok", {
      from: "front@kappa.example",
      to: TO,
      body: "A crown runs $1,200. Saturday works.",
      ours: "<ours@kappa.example>",
      read: true,
    });
    expect(out).toEqual({ id: "s1", threadId: "t1" });
    const [post] = g.posts;
    const sent = post?.body as { raw: string; threadId: string };
    expect(sent.threadId).toBe("t1");
    const mime = Buffer.from(sent.raw, "base64url").toString("utf8");
    expect(mime).toContain("From: front@kappa.example");
    expect(mime).toContain("To: lee@patient.example");
    expect(mime).toContain("Subject: Re: Quote for a crown?");
    expect(mime).toContain("In-Reply-To: <orig@patient.example>");
    expect(mime).toMatch(/References: <first@kappa\.example>\s+<orig@patient\.example>/);
    expect(mime).toContain("Message-ID: <ours@kappa.example>");
  });

  it("threads by thread id alone on a send-only mailbox", async () => {
    const g = writes((at) =>
      at === "POST /gmail/v1/users/me/messages/send" ? { body: { id: "s2" } } : undefined,
    );
    const out = await gmailReply(g.fetch, async () => "tok", {
      from: "front@kappa.example",
      to: TO,
      body: "Yes.",
      ours: "<ours2@kappa.example>",
      read: false,
    });
    expect(out).toEqual({ id: "s2", threadId: "t1" });
    const raw = (g.posts[0]?.body as { raw: string } | undefined)?.raw ?? "";
    const mime = Buffer.from(raw, "base64url").toString();
    expect(mime).not.toContain("In-Reply-To");
  });

  it("says a refused send with its status", async () => {
    const g = writes((at) =>
      at.startsWith("POST")
        ? { status: 403, body: { error: { message: "Insufficient Permission" } } }
        : undefined,
    );
    const err = await gmailReply(g.fetch, async () => "tok", {
      from: "front@kappa.example",
      to: TO,
      body: "Yes.",
      ours: "<o@kappa.example>",
      read: false,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MailApiError);
    expect((err as MailApiError).status).toBe(403);
  });
});

describe("graphReply", () => {
  it("answers through Graph's own reply on their message", async () => {
    const g = writes((at) =>
      at === "POST /v1.0/me/messages/m1/reply" ? { status: 202 } : undefined,
    );
    const out = await graphReply(g.fetch, async () => "tok", { to: TO, body: "Saturday works." });
    expect(out).toEqual({ id: null, threadId: "t1" });
    expect(g.posts).toEqual([
      {
        method: "POST",
        path: "/v1.0/me/messages/m1/reply",
        body: { message: { body: { contentType: "Text", content: "Saturday works." } } },
      },
    ]);
  });
});
