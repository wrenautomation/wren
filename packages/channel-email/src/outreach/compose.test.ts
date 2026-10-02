/** Which companies a limited compose day reaches first. */
import { describe, expect, it } from "vitest";
import { bestReachableFirst } from "./compose.js";

const row = (company_id: number, person_id: number, role_rank: number) => ({
  company_id,
  person_id,
  role_rank,
});

describe("bestReachableFirst", () => {
  it("an owner's company goes before an untitled contact's; ties keep company order", () => {
    const groups = [[row(1, 10, 3)], [row(2, 20, 1)], [row(3, 30, 3)], [row(4, 40, 1)]];
    const order = bestReachableFirst(groups, new Set([10, 20, 30, 40]));
    expect(order.map((g) => g[0]?.company_id)).toEqual([2, 4, 1, 3]);
  });

  it("ranks a company by its best person who has an address", () => {
    const groups = [[row(1, 10, 1), row(1, 11, 3)], [row(2, 20, 2)]];
    // The owner at company 1 has no address, so its untitled contact sets its place.
    expect(bestReachableFirst(groups, new Set([11, 20])).map((g) => g[0]?.company_id)).toEqual([
      2, 1,
    ]);
  });

  it("a company with nobody addressable goes last", () => {
    const groups = [[row(1, 10, 1)], [row(2, 20, 3)]];
    expect(bestReachableFirst(groups, new Set([20])).map((g) => g[0]?.company_id)).toEqual([2, 1]);
  });
});
