import { describe, expect, it } from "vitest";
import { replyGate, sendOn } from "./send.js";
import { statusOf } from "./threads.js";

const now = new Date("2026-10-07T12:00:00Z");
const before = new Date("2026-10-07T10:00:00Z");
const later = new Date("2026-10-07T11:00:00Z");

describe("statusOf", () => {
  it("follows the channel with nothing kept", () => {
    expect(statusOf({ state: "waiting", at: before }, undefined, now)).toBe("open");
    expect(statusOf({ state: "answered", at: before }, undefined, now)).toBe("waiting");
    expect(statusOf({ state: "dropped", at: before }, undefined, now)).toBe("closed");
  });

  it("keeps a close until they write again", () => {
    const kept = { status: "closed" as const, statusAt: later, snoozeUntil: null };
    expect(statusOf({ state: "waiting", at: before }, kept, now)).toBe("closed");
    expect(statusOf({ state: "waiting", at: new Date("2026-10-07T11:30:00Z") }, kept, now)).toBe(
      "open",
    );
  });

  it("snoozes until the time passes", () => {
    const kept = {
      status: null,
      statusAt: later,
      snoozeUntil: new Date("2026-10-07T13:00:00Z"),
    };
    expect(statusOf({ state: "waiting", at: before }, kept, now)).toBe("snoozed");
    expect(statusOf({ state: "waiting", at: before }, kept, new Date("2026-10-07T14:00:00Z"))).toBe(
      "open",
    );
  });
});

describe("replyGate", () => {
  const admin = { team: "admin" as const, clients: null };
  const operator = { team: "operator" as const, clients: null };
  const client = { id: "acme", sends: ["follow_up"], approver: "wren" as const };

  it("sends for an admin on Wren's own threads, asks for an operator", () => {
    expect(replyGate({ channel: "text", client: null, who: admin }).mode).toBe("send");
    expect(replyGate({ channel: "text", client: null, who: operator })).toMatchObject({
      mode: "ask",
    });
  });

  it("asks when the client's sends are off for that channel", () => {
    expect(replyGate({ channel: "text", client, who: admin }).mode).toBe("send");
    expect(replyGate({ channel: "dm", client, who: admin })).toEqual({
      mode: "ask",
      why: "Sends are off for this client.",
    });
  });

  it("asks when the client approves its own", () => {
    expect(
      replyGate({ channel: "email", client: { ...client, approver: "client" }, who: admin }).mode,
    ).toBe("ask");
  });
});

describe("sendOn", () => {
  it("routes an email to its invite or its thread", async () => {
    const calls: string[] = [];
    const rec = (k: string) => async (id: number) => void calls.push(`${k}:${id}`);
    const sender = {
      dm: rec("dm"),
      text: rec("text"),
      comment: rec("comment"),
      invite: rec("invite"),
      email: rec("email"),
    };
    const o = { label: "", platform: null, own: true, off: null };
    await sendOn(sender, { ...o, channel: "email", target: "invite:4" }, "hi");
    await sendOn(sender, { ...o, channel: "email", target: "reply:9" }, "hi");
    await sendOn(sender, { ...o, channel: "text", target: "3" }, "hi");
    expect(calls).toEqual(["invite:4", "email:9", "text:3"]);
    await expect(sendOn(sender, { ...o, channel: "dm", target: "x" }, "hi")).rejects.toThrow(
      /bad target/,
    );
  });
});
