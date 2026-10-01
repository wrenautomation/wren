import { describe, expect, it } from "vitest";
import { classifyInbound } from "./events.js";

describe("classifyInbound", () => {
  it("reads carrier stop words on the whole message", () => {
    for (const t of ["STOP", "stop.", " Unsubscribe ", "STOP ALL", "quit!"])
      expect(classifyInbound(t).kind).toBe("stop");
  });
  it("reads plain-language revocation", () => {
    expect(classifyInbound("please stop texting me").kind).toBe("stop");
    expect(classifyInbound("Wrong number buddy").kind).toBe("stop");
    expect(classifyInbound("don't message this number").kind).toBe("stop");
  });
  it("reads start, and leaves real replies alone", () => {
    expect(classifyInbound("START").kind).toBe("start");
    expect(classifyInbound("Yes!").kind).toBe("yes");
    expect(classifyInbound("yes, tuesday works").kind).toBe("reply");
    expect(classifyInbound("sure, what's the price?").kind).toBe("reply");
    expect(classifyInbound("we can't stop now, send details").kind).toBe("reply");
    expect(classifyInbound("the end of the month works").kind).toBe("reply");
  });
});
