import { describe, expect, it } from "vitest";
import { creditOf, WiseError, wiseReader } from "./wise.js";

const line = (over: Record<string, unknown> = {}) => ({
  type: "CREDIT",
  date: "2026-10-15T12:00:00.000Z",
  amount: { value: 995.5, currency: "USD" },
  totalFees: { value: 4.5, currency: "USD" },
  details: {
    type: "DEPOSIT",
    senderName: "Example Payer",
    paymentReference: "WREN-1001",
    description: "Received money",
  },
  referenceNumber: "DEPOSIT-1",
  ...over,
});

describe("creditOf", () => {
  it("reads a statement credit in cents", () => {
    expect(creditOf("b1", line())).toMatchObject({
      wiseId: "DEPOSIT-1",
      balanceId: "b1",
      currency: "USD",
      cents: 99_550,
      feeCents: 450,
      kind: "DEPOSIT",
      payer: "Example Payer",
      memo: "WREN-1001",
    });
  });
  it("skips debits, zero and undated lines", () => {
    expect(creditOf("b1", line({ type: "DEBIT" }))).toBeNull();
    expect(creditOf("b1", line({ amount: { value: 0, currency: "USD" } }))).toBeNull();
    expect(creditOf("b1", line({ date: "never" }))).toBeNull();
  });
});

describe("wiseReader", () => {
  it("only GETs: balances, then each balance's statement; oldest first", async () => {
    const calls: { url: string; method: string | undefined; auth: string | null }[] = [];
    const fake: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push({
        url,
        method: init?.method,
        auth: new Headers(init?.headers).get("authorization"),
      });
      const body = url.includes("/balances?")
        ? [
            { id: 7, currency: "USD" },
            { id: 8, currency: "CAD" },
          ]
        : url.includes("/balance-statements/7/")
          ? { transactions: [line({ date: "2026-10-15T12:00:00Z" }), line({ type: "DEBIT" })] }
          : {
              transactions: [
                line({
                  date: "2026-10-14T12:00:00Z",
                  referenceNumber: "CONV-1",
                  amount: { value: 10, currency: "CAD" },
                  details: { type: "CONVERSION" },
                }),
              ],
            };
      return new Response(JSON.stringify(body), { status: 200 });
    };
    const w = wiseReader({ token: "t0k", profileId: "42", fetch: fake, base: "https://wise.test" });
    const got = await w.credits(new Date("2026-10-08T00:00:00Z"), new Date("2026-10-15T13:00:00Z"));
    expect(got.map((c) => [c.wiseId, c.balanceId, c.kind])).toEqual([
      ["CONV-1", "8", "CONVERSION"],
      ["DEPOSIT-1", "7", "DEPOSIT"],
    ]);
    expect(calls.every((c) => c.method === "GET" && c.auth === "Bearer t0k")).toBe(true);
    expect(calls[0]?.url).toBe("https://wise.test/v4/profiles/42/balances?types=STANDARD");
    expect(calls[1]?.url).toContain(
      "/v1/profiles/42/balance-statements/7/statement.json?currency=USD",
    );
  });

  it("a failed call names the path and status, never the token", async () => {
    const w = wiseReader({
      token: "secret-token",
      profileId: "42",
      fetch: async () => new Response("no", { status: 403 }),
    });
    const err = await w.credits(new Date(0), new Date()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WiseError);
    expect(String(err)).toContain("403");
    expect(String(err)).not.toContain("secret-token");
  });
});
