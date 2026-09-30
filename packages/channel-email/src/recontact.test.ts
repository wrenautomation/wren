import { describe, expect, it } from "vitest";
import {
  DEFAULT_RECONTACT,
  RESTING_OUTCOMES,
  type RecontactOverrides,
  recontactPolicy,
} from "./recontact.js";

describe("DEFAULT_RECONTACT", () => {
  it("matches the spec table", () => {
    expect(DEFAULT_RECONTACT).toEqual({
      restDays: {
        no_reply: 90,
        not_now: 90,
        not_interested: 180,
        wrong_person: 0,
        referral: 0,
        bounced: 30,
      },
      perYear: 2,
    });
  });
  it("gives every resting outcome a rest", () => {
    expect(Object.keys(DEFAULT_RECONTACT.restDays).sort()).toEqual([...RESTING_OUTCOMES].sort());
  });
});

describe("recontactPolicy", () => {
  it("is the defaults with no overrides", () => {
    expect(recontactPolicy()).toEqual(DEFAULT_RECONTACT);
    expect(recontactPolicy({})).toEqual(DEFAULT_RECONTACT);
    expect(recontactPolicy({ restDays: {} })).toEqual(DEFAULT_RECONTACT);
  });

  it("merges overrides over the defaults", () => {
    const policy = recontactPolicy({ restDays: { no_reply: 60, bounced: 0 }, perYear: 3 });
    expect(policy).toEqual({
      restDays: { ...DEFAULT_RECONTACT.restDays, no_reply: 60, bounced: 0 },
      perYear: 3,
    });
  });

  it("never mutates the defaults", () => {
    recontactPolicy({ restDays: { no_reply: 7 }, perYear: 9 });
    expect(DEFAULT_RECONTACT.restDays.no_reply).toBe(90);
    expect(DEFAULT_RECONTACT.perYear).toBe(2);
  });

  it("allows null (never) for a resting outcome", () => {
    const policy = recontactPolicy({ restDays: { not_interested: null } });
    expect(policy.restDays.not_interested).toBeNull();
    expect(policy.restDays.no_reply).toBe(90);
  });

  it("skips an explicit undefined", () => {
    // A spec built from optional fields can carry an explicit undefined.
    const restDays = { no_reply: undefined } as unknown as NonNullable<
      RecontactOverrides["restDays"]
    >;
    const policy = recontactPolicy({ restDays });
    expect(policy.restDays.no_reply).toBe(90);
  });

  it("allows zero days and a cap of 1", () => {
    const policy = recontactPolicy({ restDays: { no_reply: 0 }, perYear: 1 });
    expect(policy.restDays.no_reply).toBe(0);
    expect(policy.perYear).toBe(1);
  });

  it.each(["opted_out", "warm", "stopped_by_hand", "needs_a_look", "active", "bogus"])(
    "rejects '%s', which is not a resting outcome",
    (outcome) => {
      expect(() =>
        recontactPolicy({ restDays: { [outcome]: 10 } as Record<string, number> }, "niche 'x'"),
      ).toThrow(new RegExp(`niche 'x': '${outcome}' is not a resting outcome`));
    },
  );

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects %s days", (days) => {
    expect(() => recontactPolicy({ restDays: { no_reply: days } })).toThrow(
      /recontact: rest for 'no_reply' must be whole days/,
    );
  });

  it.each([0, -1, 1.5, Number.NaN])("rejects perYear %s", (perYear) => {
    expect(() => recontactPolicy({ perYear }, "niche 'x'")).toThrow(
      /niche 'x': perYear must be a whole number ≥ 1/,
    );
  });
});
