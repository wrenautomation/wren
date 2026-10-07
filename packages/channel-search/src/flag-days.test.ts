import type { SiteApplication, SiteEvent, SiteHit } from "@wren/channel-email";
import { describe, expect, it } from "vitest";
import { decide, SITE_MIN_VISITORS } from "./experiments.js";
import { rollupFlags } from "./flag-days.js";

let id = 0;
const seen = (visitor: string | null, flag: string, variant: string, ts: string): SiteEvent => ({
  id: ++id,
  ts,
  view: `view-${id}`,
  visitor,
  page: "/",
  name: "exp.seen",
  props: JSON.stringify({ flag, variant }),
});
const hit = (visitor: string, ts: string, o: Partial<SiteHit> = {}) =>
  ({ id: ++id, ts, visitor, page: "/", ...o }) as SiteHit;
const app = (visitor: string, ts: string, email: string) =>
  ({ id: ++id, ts, visitor, offer: "o", fit: 1, r: "", email }) as SiteApplication;

describe("flag days", () => {
  it("counts each visitor once per flag, under the first variant, with what came after", () => {
    const rows = rollupFlags(
      [
        seen("v-1", "hero", "a", "2026-10-01T10:00:00Z"),
        seen("v-1", "hero", "b", "2026-10-02T10:00:00Z"), // later views keep the first
        seen("v-2", "hero", "b", "2026-10-01T11:00:00Z"),
        seen("v-3", "hero", "b", "2026-10-01T12:00:00Z"),
        seen(null, "hero", "a", "2026-10-01T12:00:00Z"), // no consent: never counted
        seen("v-4", "hero", "nope!", "2026-10-01T12:00:00Z"), // bad props: dropped
      ],
      [
        hit("v-2", "2026-10-01T11:00:00Z", { utm_source: "youtube", utm_medium: "social" }),
        hit("v-3", "2026-10-01T11:59:00Z", { r: "code-1" }),
      ],
      [
        app("v-1", "2026-10-01T10:05:00Z", "one@example.test"),
        app("v-2", "2026-10-01T10:00:00Z", "two@example.test"), // before the exposure
      ],
      [
        { day: "2026-10-03", code: null, email: "ONE@example.test" },
        { day: "2026-10-02", code: "code-1", email: null },
      ],
    );
    expect(
      rows.map(({ day, variant, channel, visitors, forms, calls }) => ({
        day,
        variant,
        channel,
        visitors,
        forms,
        calls,
      })),
    ).toEqual([
      { day: "2026-10-01", variant: "a", channel: "direct", visitors: 1, forms: 1, calls: 1 },
      { day: "2026-10-01", variant: "b", channel: "content", visitors: 1, forms: 0, calls: 0 },
      { day: "2026-10-01", variant: "b", channel: "email", visitors: 1, forms: 0, calls: 1 },
    ]);
  });

  it("the bandit leans to the better variant, and settles only after enough visitors", () => {
    const counts = (a: number, b: number, n: number) => [
      { variant: "a", visitors: n, forms: a, calls: 0, paid: 0 },
      { variant: "b", visitors: n, forms: b, calls: 0, paid: 0 },
    ];
    const early = decide("hero", ["a", "b"], [], "forms", counts(1, 6, 60));
    expect(early.settled).toBe(false);
    expect((early.shares.b ?? 0) > (early.shares.a ?? 0)).toBe(true);
    const late = decide("hero", ["a", "b"], [], "forms", counts(4, 40, SITE_MIN_VISITORS * 2));
    // a falls under 2% P(best) with enough visitors: dropped, so b holds everything.
    expect(late).toMatchObject({ settled: true, best: "b", retired: ["a"], shares: { b: 1 } });
    const close = decide("hero", ["a", "b"], [], "forms", counts(33, 50, SITE_MIN_VISITORS * 2));
    expect(close).toMatchObject({ settled: true, best: "b", retired: [] });
    expect(close.shares.b).toBeCloseTo(0.9);
    const none = decide("hero", ["a", "b"], [], "calls", counts(3, 9, 10));
    expect(none.shares).toEqual({ a: 0.5, b: 0.5 });
  });
});
