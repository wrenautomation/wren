/** SBA search: the request body, the whole-answer check, one file per code per day. No real API. */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FetchError, PoliteFetcher } from "./fetcher.js";
import { checkSbaAnswer, SBA_SEARCH_URL, sbaSearch, sbaSearchBody } from "./sba.js";

const spec = { name: "sba-demo", description: "demo", naics: ["561311", "561320"] };
const today = () => new Date("2026-09-30T23:30:00Z");
const fetcher = new PoliteFetcher("t (t@example.com)", {
  minInterval: 0,
  sleep: async () => {},
  fetch: (async () => new Response("unused", { status: 500 })) as unknown as typeof fetch,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sbaSearchBody", () => {
  it("everything open but one NAICS code, listed not primary", () => {
    const body = sbaSearchBody("561311");
    expect(body.naics).toEqual({
      codes: [{ value: "561311", label: "561311" }],
      isPrimary: false,
      operatorType: "Or",
    });
    expect(body.searchProfiles).toEqual({ searchTerm: "" });
    expect(body.location).toEqual({
      states: [],
      zipCodes: [],
      counties: [],
      districts: [],
      msas: [],
    });
    expect(body.samStatus).toEqual({ isActiveSAM: false });
    expect(body.lastUpdated).toEqual({ date: { label: "Anytime", value: "anytime" } });
    expect(JSON.parse(JSON.stringify(body))).toEqual(body); // serializable as sent
  });
});

describe("checkSbaAnswer", () => {
  it("a whole answer gives the result count", () => {
    expect(checkSbaAnswer('{"status":"ok","results":[{"uei":"A"},{"uei":"B"}]}', "561311")).toBe(2);
    expect(checkSbaAnswer('{"results":[]}', "561311")).toBe(0);
  });

  it("a cut-off answer is refused", () => {
    const whole = JSON.stringify({ results: [{ uei: "A", legal_business_name: "ACME" }] });
    const cut = whole.slice(0, 30);
    expect(() => checkSbaAnswer(cut, "561311")).toThrow(FetchError);
    expect(() => checkSbaAnswer(cut, "561311")).toThrow(
      /561311: answer is not whole JSON \(30 bytes\)/,
    );
    expect(() => checkSbaAnswer("", "561311")).toThrow(/not whole JSON/);
  });

  it.each([
    '{"status":"error"}',
    '{"results":{}}',
    '{"results":null}',
    "null",
    "[]",
    '"results"',
    "7",
  ])("no results array: %s", (text) => {
    expect(() => checkSbaAnswer(text, "561320")).toThrow(/561320: answer has no results array/);
  });
});

describe("sbaSearch", () => {
  it("one file per code for today (UTC), whatever the limit", async () => {
    const files = await sbaSearch(spec, today).listFiles(fetcher, 1);
    expect(files).toEqual([
      {
        dataset: "sba-demo",
        fileName: "naics-561311-2026-09-30.json",
        url: `${SBA_SEARCH_URL}#naics=561311`,
        period: "2026-09-30",
      },
      {
        dataset: "sba-demo",
        fileName: "naics-561320-2026-09-30.json",
        url: `${SBA_SEARCH_URL}#naics=561320`,
        period: "2026-09-30",
      },
    ]);
  });

  it.each([[["56131"]], [["5613111"]], [["56131a"]], [["561311", " 561320"]], [[]]])(
    "bad NAICS rejected: %j",
    (naics) => {
      expect(() => sbaSearch({ ...spec, naics })).toThrow(
        /sba dataset sba-demo: NAICS codes are 6 digits/,
      );
    },
  );

  it("download posts the code's body and lands only a whole answer", async () => {
    const posted: { url: string; init: RequestInit | undefined }[] = [];
    let answer = '{"status":"ok","results":[{"uei":"A"}]}';
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      posted.push({ url, init });
      return new Response(answer, { status: 200 });
    });
    const dataset = sbaSearch(spec, today);
    const download = dataset.download;
    if (!download) throw new Error("expected a download");
    const [remote] = await dataset.listFiles(fetcher, 1);
    if (!remote) throw new Error("expected a file");
    const root = mkdtempSync(join(tmpdir(), "sba-"));
    const dest = join(root, "sba-demo", remote.fileName);

    const got = await download(fetcher, remote, dest);
    expect(got).toMatchObject({ path: dest, downloaded: true });
    expect(readFileSync(dest, "utf8")).toBe(answer);
    expect(existsSync(`${dest}.part`)).toBe(false);
    expect(posted).toHaveLength(1);
    expect(posted[0]?.url).toBe(SBA_SEARCH_URL);
    expect(posted[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(posted[0]?.init?.body))).toEqual(sbaSearchBody("561311"));
    expect(posted[0]?.init?.headers).toMatchObject({ "User-Agent": fetcher.userAgent });

    // Already on disk: not asked again.
    expect(await download(fetcher, remote, dest)).toMatchObject({ downloaded: false });
    expect(posted).toHaveLength(1);

    // A cut-off answer never lands.
    answer = '{"status":"ok","results":[{"uei":"A"},{"ue';
    const dest2 = join(root, "sba-demo", "naics-561311-cut.json");
    await expect(download(fetcher, remote, dest2)).rejects.toThrow(/not whole JSON/);
    expect(existsSync(dest2)).toBe(false);
    expect(existsSync(`${dest2}.part`)).toBe(false);
  });

  it("a non-200 answer is a FetchError with the status", async () => {
    vi.stubGlobal("fetch", async () => new Response("busy", { status: 503 }));
    const dataset = sbaSearch(spec, today);
    const [remote] = await dataset.listFiles(fetcher, 1);
    if (!remote || !dataset.download) throw new Error("expected a file and a download");
    const root = mkdtempSync(join(tmpdir(), "sba-"));
    const err = await dataset
      .download(fetcher, remote, join(root, remote.fileName))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FetchError);
    expect((err as FetchError).message).toContain("HTTP 503");
  });

  it("an existing file is never overwritten", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("no network in tests");
    });
    const dataset = sbaSearch(spec, today);
    const [remote] = await dataset.listFiles(fetcher, 1);
    if (!remote || !dataset.download) throw new Error("expected a file and a download");
    const root = mkdtempSync(join(tmpdir(), "sba-"));
    const dest = join(root, remote.fileName);
    writeFileSync(dest, '{"results":[]}');
    expect(await dataset.download(fetcher, remote, dest)).toEqual({
      path: dest,
      downloaded: false,
      size: 14,
    });
  });
});
