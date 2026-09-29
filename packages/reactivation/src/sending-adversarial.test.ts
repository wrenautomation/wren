/**
 * A client mailbox's send rules and loop list at their edges: caps at 0, ramps
 * above the ceiling, every sender suspended, and dates only the regex liked.
 */
import { SendPolicy } from "@wren/channel-email";
import { loadSettings } from "@wren/config";
import { describe, expect, it } from "vitest";
import { mailboxLoops } from "./loop.js";
import { senderFleet, sendingOff, sendPolicyFor, settingsOrNull } from "./sending.js";
import { reactivationSettingsOf } from "./settings.js";

const BASE = SendPolicy.fromSettings(
  loadSettings({
    WREN_DATABASE_URL: "postgresql://x",
    WREN_SEND_TIMEZONE: "UTC",
    WREN_SEND_DAYS: "mon,tue,wed,thu,fri,sat,sun",
    WREN_COLD_SENDS_PER_INBOX_PER_DAY: "30",
    WREN_COLD_SENDS_RAMP_START: "2026-01-05",
    WREN_COLD_SENDS_RAMP_FROM: "10",
    WREN_NEW_OPENERS_PER_DAY: "0",
  }),
);
const ANN = { address: "ann@acme.example", name: "Ann" };
const BO = { address: "bo@acme.example", name: "Bo" };
const settings = (block: Record<string, unknown>) =>
  reactivationSettingsOf({ reactivation: block });
const policy = (sending: Record<string, unknown>) => sendPolicyFor(settings({ sending }), BASE);

describe("sendPolicyFor", () => {
  it("a ceiling under Wren's ramp start starts the ramp at the ceiling", () => {
    const p = policy({ perInboxPerDay: 3, rampStart: "2026-09-01" });
    expect(p.rampFrom).toBe(3);
    expect(p.perInboxCap(new Date("2026-09-01T12:00:00Z"))).toBe(3);
    expect(p.perInboxCap(new Date("2026-12-01T12:00:00Z"))).toBe(3);
  });

  it("openersPerDay 0 means no openers, not no cap", () => {
    expect(policy({ openersPerDay: 0 }).newOpenersPerDay).toBe(0);
  });

  it("Wren's own ramp never throttles a client: no rampStart is the full ceiling from day one", () => {
    const p = policy({ perInboxPerDay: 25 });
    expect(p.rampStart).toBeNull();
    expect(p.perInboxCap(new Date("2026-01-05T12:00:00Z"))).toBe(25);
  });

  it("a ramp climbs from Wren's start to the client's ceiling and stops there", () => {
    const p = policy({ perInboxPerDay: 12, rampStart: "2026-09-01" });
    const start = p.perInboxCap(new Date("2026-09-01T12:00:00Z"));
    expect(start).toBe(10);
    expect(p.perInboxCap(new Date("2027-09-01T12:00:00Z"))).toBe(12);
  });

  it("Wren's window, days and gaps carry over", () => {
    const p = policy({});
    expect(p.timezone).toBe(BASE.timezone);
    expect([...p.days]).toEqual([...BASE.days]);
    expect(p.gapMinMs).toBe(BASE.gapMinMs);
    expect(p.resendCooldownDays).toBe(BASE.resendCooldownDays);
  });
});

describe("senderFleet and mailboxLoops", () => {
  it("every sender suspended: none sends, all are still measured, all inboxes still sync", () => {
    const s = settings({
      on: true,
      stages: { send: true },
      senders: [
        { ...ANN, suspended: true },
        { ...BO, suspended: true },
      ],
    });
    expect(senderFleet(s)).toMatchObject({
      senders: [],
      domainFleet: [ANN.address, BO.address],
      fromNames: {},
    });
    expect(mailboxLoops("acme", { demo: false }, s)).toEqual({
      send: [],
      inbox: [`acme/${ANN.address}`, `acme/${BO.address}`],
    });
  });

  it("an address listed in capitals is keyed lowercase", () => {
    const s = settings({
      on: true,
      stages: { send: true },
      senders: [{ ...ANN, address: "ANN@Acme.Example" }],
    });
    expect(mailboxLoops("acme", { demo: false }, s).send).toEqual([`acme/${ANN.address}`]);
  });

  it("the same sender twice in different case is refused, so it never runs two loops", () => {
    expect(
      settingsOrNull({ reactivation: { senders: [ANN, { ...ANN, address: "Ann@Acme.example" }] } }),
    ).toBeNull();
  });

  it("the demo runs no loop, even with everything on", () => {
    const s = settings({ on: true, stages: { send: true }, senders: [ANN] });
    expect(mailboxLoops("demo", { demo: true }, s)).toEqual({ send: [], inbox: [] });
    expect(sendingOff({ demo: true }, s)).toBe("the demo never sends");
  });
});
