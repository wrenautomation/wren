// A connected mailbox as the Monitor's Mailbox, on fake Gmail and Graph APIs: no network.
import { describe, expect, it } from "vitest";
import { gmailMailbox, graphMailbox, graphMetaOf, MailApiError } from "./mailbox.js";

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
