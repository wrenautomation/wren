/** The web's `isWrite` is the Worker's: each route a service lists as a write, and nothing else. */
import { describe, expect, it } from "vitest";
import { isSend, isWrite, SENDS, SERVICES } from "../src/services.js";

describe("isWrite", () => {
  it("names every write route and no read", () => {
    let writes = 0;
    for (const [name, svc] of Object.entries(SERVICES))
      for (const route of svc.routes) {
        expect(isWrite(`${name}/${route}`)).toBe(svc.writes.has(route));
        if (svc.writes.has(route)) writes += 1;
      }
    expect(writes).toBeGreaterThan(50);
  });

  it("refuses what isn't a route", () => {
    for (const p of ["", "notes", "notes/delete/x", "nope/delete", "constructor/x", "__proto__/a"])
      expect(isWrite(p)).toBe(false);
  });

  it("every send is a write; console/call is one by the handler it names", () => {
    for (const p of SENDS) expect(isSend(p), p).toBe(true);
    const call = (service: string, handler: string, more = {}) => ({ service, handler, ...more });
    expect(isSend("console/call", call("InboxDesk", "reply"))).toBe(true);
    expect(isSend("console/call", call("ReachDesk", "answerComment"))).toBe(true);
    expect(isSend("console/call", call("ReachDesk", "markRead"))).toBe(false);
    expect(isSend("console/call", call("InboxDesk", "reply", { send: true }))).toBe(false);
    expect(isSend("console/call")).toBe(false);
  });
});
