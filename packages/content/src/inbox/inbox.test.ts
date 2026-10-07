import { describe, expect, it } from "vitest";
import { mayWork, replyGate, sendOn } from "./send.js";
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

describe("replyGate for a client's own login", () => {
  const acme = { id: "acme", sends: ["follow_up", "dm"], approver: "client" as const };
  const owner = { member: "owner", client: "acme" };
  const effect = (channels?: string[]) => ({
    verbs: ["effect" as const],
    scope: { client: "acme", ...(channels ? { channels } : {}) },
  });

  it("asks for an owner without send rights", () => {
    expect(replyGate({ channel: "text", client: acme, who: owner })).toEqual({
      mode: "ask",
      why: "You can't send. Someone who can says yes.",
    });
  });

  it("sends for a member with an effect grant when the client approves its own", () => {
    const who = { member: "member", client: "acme", grants: [effect()] };
    expect(replyGate({ channel: "email", client: acme, who }).mode).toBe("send");
    expect(replyGate({ channel: "email", client: { ...acme, approver: "wren" }, who })).toEqual({
      mode: "ask",
      why: "Wren approves these sends.",
    });
    expect(replyGate({ channel: "email", client: { ...acme, approver: "either" }, who }).mode).toBe(
      "send",
    );
  });

  it("holds a channel-scoped grant to its channel", () => {
    const who = { member: "member", client: "acme", grants: [effect(["sms"])] };
    expect(replyGate({ channel: "text", client: acme, who }).mode).toBe("send");
    expect(replyGate({ channel: "email", client: acme, who }).mode).toBe("ask");
    expect(replyGate({ channel: "dm", platform: "x", client: acme, who }).mode).toBe("ask");
  });

  it("never sends for another client's login", () => {
    const who = { member: "owner", client: "other", grants: [effect()] };
    expect(replyGate({ channel: "text", client: acme, who }).mode).toBe("ask");
  });
});

describe("mayWork", () => {
  it("needs act on the thread's channel at that client", () => {
    expect(mayWork({ member: "member", client: "acme" }, "acme", "sms")).toBe(true);
    expect(mayWork({ member: "viewer", client: "acme" }, "acme", "sms")).toBe(false);
    expect(mayWork({ member: "member", client: "other" }, "acme", "sms")).toBe(false);
    const texts = {
      member: "texter",
      client: "acme",
      grants: [{ verbs: ["act" as const], scope: { client: "acme", channels: ["sms"] } }],
    };
    expect(mayWork(texts, "acme", "sms")).toBe(true);
    expect(mayWork(texts, "acme", "email")).toBe(false);
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
