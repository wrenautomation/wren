/**
 * Adversarial tests for `clients set --set/--unset`. Tests that expose a bug
 * assert the correct behavior and are marked "Was a bug".
 */
import { afterEach, describe, expect, it } from "vitest";
import { changeProducts, parseAssignment } from "./products.js";

const proto = Object.prototype as Record<string, unknown>;
afterEach(() => {
  delete proto.on;
  delete proto.polluted;
});

const SENDERS = [
  { address: "a@x.example", name: "A" },
  { address: "b@x.example", name: "B" },
];

describe("changeProducts: paths that escape the block", () => {
  // Was a bug: `__proto__` walks onto Object.prototype and the set lands there, for every object
  // in the process (and zod then reads the inherited key as a setting).
  it("__proto__ in a path never touches Object.prototype", () => {
    try {
      changeProducts({ reactivation: {} }, [parseAssignment("reactivation.__proto__.on=true")], []);
    } catch {}
    expect(({} as Record<string, unknown>).on).toBeUndefined();
  });

  // Was a bug: same root, through constructor.prototype.
  it("constructor.prototype in a path never touches Object.prototype", () => {
    try {
      changeProducts(
        { reactivation: {} },
        [parseAssignment("reactivation.constructor.prototype.polluted=1")],
        [],
      );
    } catch {}
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("changeProducts: arrays", () => {
  // Was a bug: a path through an array replaces the whole array with an object, so one sender
  // can't be suspended without retyping every sender; the parser then fails confusingly.
  it("a path through an array sets that element", () => {
    const out = changeProducts(
      { reactivation: { senders: SENDERS } },
      [parseAssignment("reactivation.senders.1.suspended=true")],
      [],
    );
    expect(out.reactivation).toEqual({
      senders: [SENDERS[0], { ...SENDERS[1], suspended: true }],
    });
  });

  // Was a bug: an unset through an array is a silent no-op, reported as a change.
  it("an unset through an array removes that element or says it can't", () => {
    let out: Record<string, unknown> | null = null;
    let threw = false;
    try {
      out = changeProducts(
        { reactivation: { senders: SENDERS } },
        [],
        [["reactivation", "senders", "0"]],
      );
    } catch {
      threw = true;
    }
    expect(
      threw || JSON.stringify(out) !== JSON.stringify({ reactivation: { senders: SENDERS } }),
    ).toBe(true);
  });
});

describe("changeProducts: edges that work", () => {
  it("unsets run after sets, whatever the command-line order", () => {
    expect(
      changeProducts(
        { reactivation: { on: true, approval: "every" } },
        [parseAssignment("reactivation.on=false")],
        [["reactivation", "on"]],
      ),
    ).toEqual({ reactivation: { approval: "every" } });
  });

  it("unsetting a path that is not there is harmless", () => {
    expect(
      changeProducts({ reactivation: { on: true } }, [], [["reactivation", "x", "y"]]),
    ).toEqual({ reactivation: { on: true } });
    expect(changeProducts({}, [], [["reactivation", "on"]])).toEqual({ reactivation: null });
  });

  it("a whole block set as JSON is checked", () => {
    expect(() =>
      changeProducts({}, [parseAssignment('reactivation={"approval":"sometimes"}')], []),
    ).toThrow(/approval/);
    expect(() => changeProducts({}, [parseAssignment("reactivation=5")], [])).toThrow();
  });

  it("a duplicate sender set through the CLI is refused", () => {
    expect(() =>
      changeProducts(
        {},
        [
          parseAssignment(
            'reactivation.senders=[{"address":"a@x.example","name":"A"},{"address":"A@X.example","name":"B"}]',
          ),
        ],
        [],
      ),
    ).toThrow(/listed twice/);
  });

  it("a value with = in it keeps everything after the first =", () => {
    expect(parseAssignment("reactivation.senders.0.name=a=b").value).toBe("a=b");
  });
});
