import type { Spent, VendorKey, VendorKeys, VendorUse } from "@wren/core/vendor-keys";
import { VendorKeyMissing } from "@wren/core/vendor-keys";
import { VendorStop } from "@wren/core/vendor-stop";
import { describe, expect, it } from "vitest";
import { keyedProvider } from "./keyed.js";
import { FakeProvider } from "./provider.js";

const OWN = "KEYacme-telnyx-synthetic-9999ZZZZ";

/** The resolver's contract, in memory: a key per client, a cap, and what was metered. */
function fakeKeys(answer: VendorKey | Error, capped = false) {
  const metered: Spent[] = [];
  const reads: string[] = [];
  const keys: VendorKeys = {
    async key(client) {
      reads.push(client ?? "wren");
      if (answer instanceof Error) throw answer;
      return answer;
    },
    async use<T>(o: VendorUse<T>, run: (k: VendorKey) => Promise<T>) {
      const k = await keys.key(o.client, o.vendor, o.why);
      if (capped)
        throw new VendorStop("telnyx", "GATE", "", "telnyx", "Monthly cap of $5.00 reached");
      // No scrub here: the provider's own must hold.
      const out = await run(k);
      const s = o.spent ? o.spent(out) : { units: 1 };
      if (s) metered.push(s);
      return out;
    },
  };
  return { keys, metered, reads };
}

const own: VendorKey = { mode: "own", key: OWN, source: "store:ks_x", last4: "ZZZZ" };
const managed: VendorKey = { mode: "managed", key: "wren-key", source: "env" };
const msg = { from: "+15550000001", to: "+15550000002", text: "hi" };

describe("keyedProvider", () => {
  it("own key: sends on the client's account, metered in parts and dollars", async () => {
    const wren = new FakeProvider();
    const mine = new FakeProvider();
    const made: string[] = [];
    const k = fakeKeys(own);
    const p = keyedProvider({
      client: "acme",
      keys: k.keys,
      managed: wren,
      own: (key) => {
        made.push(key);
        return mine;
      },
    });
    expect((await p.send(msg)).ok).toBe(true);
    await p.send({ ...msg, to: "+15550000003" });
    expect([wren.sent.length, mine.sent.length]).toEqual([0, 2]);
    expect(made).toEqual([OWN]);
    expect(k.metered).toEqual([
      { units: 1, micros: 4000 },
      { units: 1, micros: 4000 },
    ]);
  });

  it("managed: Wren's account; other calls on the same key", async () => {
    const wren = new FakeProvider();
    const p = keyedProvider({
      client: "beta",
      keys: fakeKeys(managed).keys,
      managed: wren,
      own: () => {
        throw new Error("never");
      },
    });
    await p.send(msg);
    expect(wren.sent.length).toBe(1);
    expect(await p.balance()).toBe(25);
  });

  it("no key saved: nothing leaves, try later, never Wren's account", async () => {
    const wren = new FakeProvider();
    const p = keyedProvider({
      client: "gamma",
      keys: fakeKeys(
        new VendorKeyMissing("gamma", "telnyx", "Connect your Telnyx key in Account → Vendors"),
      ).keys,
      managed: wren,
      own: () => wren,
    });
    expect(await p.send(msg)).toEqual({
      ok: false,
      retry: true,
      detail: "Connect your Telnyx key in Account → Vendors",
    });
    expect(wren.sent).toEqual([]);
    await expect(p.balance()).rejects.toThrow("Connect your Telnyx key");
  });

  it("a cap: try later, not metered", async () => {
    const k = fakeKeys(managed, true);
    const wren = new FakeProvider();
    const p = keyedProvider({ client: "beta", keys: k.keys, managed: wren, own: () => wren });
    const r = await p.send(msg);
    expect(r).toMatchObject({ ok: false, retry: true });
    expect([wren.sent.length, k.metered.length]).toEqual([0, 0]);
  });

  it("a carrier error after the send started is still a throw (maybe sent), without the key", async () => {
    const mine = new FakeProvider();
    mine.send = async () => {
      throw new Error(`connection reset for Bearer ${OWN}`);
    };
    const p = keyedProvider({
      client: "acme",
      keys: fakeKeys(own).keys,
      managed: new FakeProvider(),
      own: () => mine,
    });
    const err = (await p.send(msg).catch((e: unknown) => e)) as Error;
    expect(err).toBeInstanceOf(Error);
    expect(`${err.message}${err.stack}`).not.toContain(OWN);
  });

  it("a rejected text isn't metered", async () => {
    const mine = new FakeProvider();
    mine.reject.set(msg.to, { code: "40300", detail: "blocked" });
    const k = fakeKeys(own);
    const p = keyedProvider({
      client: "acme",
      keys: k.keys,
      managed: new FakeProvider(),
      own: () => mine,
    });
    expect((await p.send(msg)).ok).toBe(false);
    expect(k.metered).toEqual([]);
  });
});
