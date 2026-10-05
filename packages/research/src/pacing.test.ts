import { describe, expect, it } from "vitest";
import { bucketRoom } from "./pacing.js";

const MIN = 60_000;
// 96 a day: one spend refills every 15 minutes.
const bucket = { perDay: 96, burst: 4 };

describe("bucketRoom", () => {
  it("a bucket never spent is full", () => {
    expect(bucketRoom([], 0, bucket)).toEqual({ room: 4, nextInMs: 0 });
  });

  it("a burst empties it, and it refills one spend per gap", () => {
    const burst = [0, 0, 0, 0];
    expect(bucketRoom(burst, 0, bucket)).toEqual({ room: 0, nextInMs: 15 * MIN });
    expect(bucketRoom(burst, 15 * MIN, bucket).room).toBe(1);
    expect(bucketRoom(burst, 44 * MIN, bucket).room).toBe(2);
    expect(bucketRoom(burst, 10 * 60 * MIN, bucket).room).toBe(4);
  });

  it("a day of steady spending at the rate leaves only what refilled", () => {
    const steady = Array.from({ length: 96 }, (_, i) => i * 15 * MIN);
    expect(bucketRoom(steady, 96 * 15 * MIN, bucket).room).toBe(4);
    expect(bucketRoom(steady, 95 * 15 * MIN, bucket).room).toBe(3);
  });

  it("spends faster than the rate hold the bucket down", () => {
    const fast = Array.from({ length: 8 }, (_, i) => i * MIN);
    // 8 spent in 8 minutes against a burst of 4: the next waits out the 4 over, less the refill.
    const r = bucketRoom(fast, 8 * MIN, bucket);
    expect(r.room).toBe(0);
    expect(r.nextInMs).toBe(67 * MIN);
  });
});
