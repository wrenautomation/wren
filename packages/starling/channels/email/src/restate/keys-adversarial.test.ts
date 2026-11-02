/**
 * Loop keys against the mailboxes they name: a client's key is
 * `<client>/<mailbox>`, Wren's is the bare address. The split must never read
 * one of Wren's inboxes as a client's, or the other way round.
 */
import { clientKey, clientOfKey, unitOfKey } from "@wren/core/restate";
import { describe, expect, it } from "vitest";
import { parseRoster } from "../send/roster.js";

describe("loop keys", () => {
  it("splits at the first slash; the rest is the unit, slashes and all", () => {
    expect(clientOfKey("acme/ann@acme.example")).toEqual({
      client: "acme",
      unit: "ann@acme.example",
    });
    expect(clientOfKey("acme/a/b")).toEqual({ client: "acme", unit: "a/b" });
    expect(unitOfKey(clientKey("acme", "Ann@Acme.example"))).toBe("Ann@Acme.example");
  });

  it("a leading slash or no slash is Wren's own", () => {
    expect(clientOfKey("will@wren.example")).toBeNull();
    expect(clientOfKey("fleet")).toBeNull();
    expect(clientOfKey("/will@wren.example")).toBeNull();
    expect(unitOfKey("/will@wren.example")).toBe("/will@wren.example");
  });

  it("an empty unit still belongs to the client, never to Wren", () => {
    expect(clientOfKey("acme/")).toEqual({ client: "acme", unit: "" });
  });

  // Was a bug: the roster takes any address with an @ and a dotted domain, so
  // "ops/team@wren.example" loads. Its loop key then reads as client "ops":
  // its send loop stops itself and its inbox syncs into wren_client_ops.
  it("the roster refuses an address that would read as a client's key", () => {
    const roster = `
[[senders]]
address = "ops/team@wren.example"
niches = "all"
`;
    expect(() => parseRoster(roster, "roster")).toThrow();
    expect(clientOfKey("ops/team@wren.example")).not.toBeNull();
  });
});
