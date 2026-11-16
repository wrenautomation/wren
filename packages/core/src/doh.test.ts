/** DNS-JSON Status handling: a resolver hiccup must be distinguishable from an authoritative empty answer. */
import { describe, expect, it } from "vitest";
import { DohStatusError, type FetchLike, resolve } from "./doh.js";

const json =
  (payload: unknown): FetchLike =>
  async () =>
    new Response(JSON.stringify(payload), { status: 200 });
const raw =
  (body: string): FetchLike =>
  async () =>
    new Response(body, { status: 200 });

describe("resolve", () => {
  it("NOERROR returns the answers of the asked type", async () => {
    expect(
      await resolve(
        "foo.com",
        "MX",
        json({ Status: 0, Answer: [{ type: 15, data: "10 mail.foo.com." }] }),
      ),
    ).toEqual(["10 mail.foo.com."]);
    expect(
      await resolve(
        "foo.com",
        "AAAA",
        json({
          Status: 0,
          Answer: [
            { type: 1, data: "1.2.3.4" },
            { type: 28, data: "::1" },
          ],
        }),
      ),
    ).toEqual(["::1"]);
  });
  it("NOERROR with no records and NXDOMAIN are empty", async () => {
    expect(await resolve("foo.com", "MX", json({ Status: 0 }))).toEqual([]);
    expect(await resolve("nosuchdomain.example", "MX", json({ Status: 3 }))).toEqual([]);
  });
  it.each([2, 5])("status %i raises", async (status) =>
    expect(resolve("foo.com", "MX", json({ Status: status }))).rejects.toBeInstanceOf(
      DohStatusError,
    ),
  );
  it("non-JSON body raises DohStatusError", async () =>
    expect(resolve("foo.com", "MX", raw("<html>not dns-json</html>"))).rejects.toBeInstanceOf(
      DohStatusError,
    ));
  it("sends the dns-json accept header and query", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const fetchImpl: FetchLike = async (url, init) => {
      seen = { url, init };
      return new Response(JSON.stringify({ Status: 0 }), { status: 200 });
    };
    await resolve("foo.com", "MX", fetchImpl);
    expect(seen?.url).toBe("https://cloudflare-dns.com/dns-query?name=foo.com&type=MX");
    expect((seen?.init.headers as Record<string, string> | undefined)?.accept).toBe(
      "application/dns-json",
    );
  });
});
