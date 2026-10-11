import { describe, expect, it } from "vitest";
import { TransportRefused } from "../send/transport.js";
import { InstantlyReader, InstantlyTransport, rawOf } from "./instantly.js";

const inbox = "sender@example.com";

function fakeFetch(pages: Record<string, unknown>[]) {
  const asked: string[] = [];
  const f = (async (url: string) => {
    asked.push(url);
    const page = pages.shift() ?? { items: [] };
    return new Response(JSON.stringify(page), { status: 200 });
  }) as unknown as typeof fetch;
  return { f, asked };
}

const email = (id: string, at: string, ue_type = 2) => ({
  id,
  timestamp_email: at,
  message_id: `<${id}@mail.example.net>`,
  subject: "Re: a question",
  from_address_email: "lead@example.net",
  from_address_json: [{ address: "lead@example.net", name: "Lea Doe" }],
  to_address_email_list: inbox,
  body: { text: "Yes, send more.\nThanks" },
  eaccount: inbox,
  ue_type,
});

describe("InstantlyReader", () => {
  it("lists received mail after the cursor across pages, newest first, and stops at older mail", async () => {
    const { f, asked } = fakeFetch([
      {
        items: [email("a", "2026-10-10T12:00:00Z"), email("s", "2026-10-10T11:00:00Z", 1)],
        next_starting_after: "s",
      },
      { items: [email("b", "2026-10-09T12:00:00Z"), email("old", "2026-10-01T00:00:00Z")] },
    ]);
    const reader = new InstantlyReader({ apiKey: "k", fetch: f });
    const after = Date.parse("2026-10-05T00:00:00Z") / 1000;
    const [ids, next] = await reader.listMessages(inbox, `after:${after}`);
    expect(ids).toEqual(["instantly:a", "instantly:b"]);
    expect(next).toBeNull();
    expect(asked[0]).toContain("mode=emode_all");
    expect(asked[0]).toContain(`eaccount=${encodeURIComponent(inbox)}`);
    expect(asked[1]).toContain("starting_after=s");

    const meta = await reader.getMetadata(inbox, "instantly:a");
    expect(meta.internalDate).toBe(String(Date.parse("2026-10-10T12:00:00Z")));
    expect(meta.payload).toMatchObject({
      headers: expect.arrayContaining([
        { name: "From", value: '"Lea Doe" <lead@example.net>' },
        { name: "Message-ID", value: "<a@mail.example.net>" },
      ]),
    });
  });

  it("writes a plain RFC 822 message, HTML stripped when there is no text body", () => {
    const raw = rawOf({
      ...email("h", "2026-10-10T12:00:00Z"),
      body: { html: "<p>Hi<br>there</p>" },
    });
    expect(raw).toContain("Subject: Re: a question\r\n");
    expect(raw).toContain("Content-Type: text/plain; charset=utf-8");
    expect(raw.split("\r\n\r\n")[1]).toBe("Hi\r\nthere\r\n");
  });

  it("refuses an id that is not Instantly's", async () => {
    const reader = new InstantlyReader({ apiKey: "k", fetch: fakeFetch([]).f });
    await expect(reader.getRaw(inbox, "inbox:1:2:abc")).rejects.toThrow(/not an Instantly id/);
  });
});

describe("InstantlyTransport", () => {
  it("refuses every send at the sender level", async () => {
    const err = await new InstantlyTransport().send({ fromAddress: inbox }).catch((e) => e);
    expect(err).toBeInstanceOf(TransportRefused);
    expect(err.senderLevel).toBe(true);
  });
});
