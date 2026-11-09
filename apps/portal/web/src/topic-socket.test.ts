/** The tab's topic socket: a frame reads its listeners again; a reopen after a drop reads all. */
import { describe, expect, it } from "vitest";
import { onTopic, topicHandlers, topicsOf } from "./topic-socket.js";

describe("topic socket", () => {
  it("calls only the named topics' listeners, once each; unsubscribe stops it", () => {
    const heard: string[] = [];
    const offA = onTopic("variants", () => heard.push("a"));
    const offB = onTopic("other", () => heard.push("b"));
    const h = topicHandlers();
    h.frame(JSON.stringify({ type: "changed", topics: ["variants", "variants"] }));
    expect(heard).toEqual(["a"]);
    h.frame("pong");
    h.frame(JSON.stringify({ type: "write", topics: ["variants"] }));
    expect(heard).toEqual(["a"]);
    offA();
    h.frame(JSON.stringify({ type: "changed", topics: ["variants"] }));
    expect(heard).toEqual(["a"]);
    offB();
  });

  it("reads every listener on a reopen after a drop, not on the first open", () => {
    const heard: string[] = [];
    const off = [onTopic("x", () => heard.push("x")), onTopic("y", () => heard.push("y"))];
    const h = topicHandlers();
    h.up(true);
    expect(heard).toEqual([]);
    h.up(false);
    h.up(true);
    expect(heard).toEqual(["x", "y"]);
    for (const f of off) f();
  });

  it("parses frames", () => {
    expect(topicsOf('{"type":"changed","topics":["a",1]}')).toEqual(["a"]);
    expect(topicsOf("nope")).toBeNull();
    expect(topicsOf(3)).toBeNull();
  });
});
