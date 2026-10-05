import { metaOf } from "@wren/core/mailbox";
import { describe, expect, it } from "vitest";
import { type Rule, settle } from "./triage.js";

const rule = (id: number, r: Partial<Rule>): Rule => ({
  id,
  words: `rule ${id}`,
  sender: null,
  subject: null,
  verdict: null,
  by: null,
  createdAt: new Date(0),
  ...r,
});

describe("settle", () => {
  const all = [
    rule(1, { sender: "shop.example", verdict: "hold" }),
    rule(2, { sender: "shop.example", subject: "Shipped", verdict: "show" }),
    rule(3, { words: "Hold newsletters." }),
    rule(4, { sender: "news@other.example", verdict: "drop" }),
  ];

  it("takes subject words over a bare sender, any case", () => {
    expect(
      settle(all, { fromAddress: "orders@mail.shop.example", subject: "Your order shipped" })?.id,
    ).toBe(2);
    expect(settle(all, { fromAddress: "orders@shop.example", subject: "Receipt" })?.id).toBe(1);
  });

  it("matches a whole address exactly, and leaves the rest to the model", () => {
    expect(settle(all, { fromAddress: "news@other.example", subject: "x" })?.id).toBe(4);
    expect(settle(all, { fromAddress: "boss@other.example", subject: "x" })).toBeNull();
  });

  it("prefers the newer of two equal rules", () => {
    const two = [...all, rule(5, { sender: "shop.example", verdict: "drop" })];
    expect(settle(two, { fromAddress: "a@shop.example", subject: "Receipt" })?.id).toBe(5);
  });
});

describe("metaOf", () => {
  it("reads From, Subject and the preview, never a body", () => {
    expect(
      metaOf({
        id: "m1",
        threadId: "t1",
        snippet: "It&#39;s on its way &amp; tracked",
        internalDate: "1759680000000",
        payload: {
          headers: [
            { name: "From", value: '"Shop Team" <Orders@Shop.example>' },
            { name: "Subject", value: "=?UTF-8?B?U2hpcHBlZA==?=" },
          ],
        },
      }),
    ).toEqual({
      id: "m1",
      threadId: "t1",
      fromName: "Shop Team",
      fromAddress: "orders@shop.example",
      subject: "Shipped",
      snippet: "It's on its way & tracked",
      at: new Date(1759680000000),
    });
  });
});
