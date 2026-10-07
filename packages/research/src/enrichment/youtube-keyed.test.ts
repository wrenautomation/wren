import type { VendorKey, VendorKeys, VendorUse } from "@wren/core/vendor-keys";
import { VendorKeyMissing } from "@wren/core/vendor-keys";
import { describe, expect, it } from "vitest";
import { clientYouTube, countYouTubeUnit, emptyYouTubeStats, YouTubeError } from "./youtube.js";

const OWN = "AIzaSynthetic-own-youtube-0000WXYZ";

function fakeKeys(answer: VendorKey | Error) {
  const used: { units: number | undefined; vendor: string }[] = [];
  const keys: VendorKeys = {
    async key() {
      if (answer instanceof Error) throw answer;
      return answer;
    },
    async use<T>(o: VendorUse<T>, run: (k: VendorKey) => Promise<T>) {
      const k = await keys.key(o.client, o.vendor, o.why);
      used.push({ units: o.units, vendor: o.vendor });
      return run(k);
    },
  };
  return { keys, used };
}

describe("clientYouTube", () => {
  it("own key reads on the client's key; managed on Wren's; search asks 100 units", async () => {
    const calls: string[] = [];
    const wren = async (r: string) => {
      calls.push(`wren ${r}`);
      return {};
    };
    const own = (key: string) => async (r: string) => {
      calls.push(`own ${key.slice(-4)} ${r}`);
      return {};
    };
    const mine = fakeKeys({ mode: "own", key: OWN, source: "store:ks_y", last4: "WXYZ" });
    const a = clientYouTube({ client: "acme", keys: mine.keys, wren, own, part: "t" });
    await a("channels", {});
    await a("search", {});
    const theirs = fakeKeys({ mode: "managed", key: null, source: "Wren's service account" });
    await clientYouTube({ client: "beta", keys: theirs.keys, wren, own, part: "t" })("videos", {});
    expect(calls).toEqual(["own WXYZ channels", "own WXYZ search", "wren videos"]);
    expect(mine.used.map((u) => u.units)).toEqual([1, 100]);
  });

  it("no key: the pass stops on why, nothing read on Wren's", async () => {
    let wrenReads = 0;
    const get = clientYouTube({
      client: "gamma",
      keys: fakeKeys(
        new VendorKeyMissing("gamma", "youtube", "Connect your YouTube key in Account → Vendors"),
      ).keys,
      wren: async () => {
        wrenReads++;
        return {};
      },
      own: () => async () => ({}),
      part: "t",
    });
    const err = (await get("channels", {}).catch((e: unknown) => e)) as YouTubeError;
    expect(err).toBeInstanceOf(YouTubeError);
    expect(err.quota).toBe(true);
    expect(wrenReads).toBe(0);
    const why = countYouTubeUnit(
      emptyYouTubeStats(),
      { companyId: 1, outcome: "quota", uploads: 0, error: err.message },
      { errors: 0 },
    );
    expect(why).toBe("YouTube stopped: Connect your YouTube key in Account → Vendors");
  });
});
