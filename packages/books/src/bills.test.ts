import { describe, expect, it } from "vitest";
import { billsStep } from "./bills.js";
import type { VendorSpec } from "./chart.js";

const specs = [
  { key: "host", mail: { from: ["billing.example"], subject: ["invoice"] } },
] as unknown as VendorSpec[];
const at = { client: null, workflow: "watch", node: "bills", with: {} };
const event = (id: unknown) => ({
  subject: `mail:${id}`,
  kind: "mail" as const,
  data: { mailId: id },
});

function step(mail: Record<number, { fromAddress: string; subject: string }>) {
  const ran: string[] = [];
  const s = billsStep({
    mailOf: async (id) => mail[id] ?? null,
    runBooks: async (key) => {
      ran.push(key);
    },
    vendorSpecs: specs,
  });
  return { s, ran };
}

describe("bills from the Watch", () => {
  it("a vendor's bill runs the books once per mail; anything else runs nothing", async () => {
    const { s, ran } = step({
      1: { fromAddress: "no-reply@billing.example", subject: "Your invoice" },
      2: { fromAddress: "no-reply@billing.example", subject: "Product news" },
      3: { fromAddress: "friend@other.example", subject: "invoice?" },
    });
    for (const id of [1, 2, 3, 4]) expect(await s("mail", event(id), at)).toEqual([]);
    expect(ran).toEqual(["books-bill:1"]);
  });

  it("an event with no kept mail is an error, not a skip", async () => {
    await expect(step({}).s("mail", event("x"), at)).rejects.toThrow(/no kept email/);
  });
});
