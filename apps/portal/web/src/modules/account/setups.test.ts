// How Accounts and Vendors say a setup run and a vendor: whose turn, the rail, the room.
import { describe, expect, it } from "vitest";
import {
  currentOf,
  dollars,
  mailTag,
  modeTag,
  type RunRow,
  railOf,
  roomText,
  runTag,
  type StepRow,
  whoText,
} from "./setups.js";

const step = (id: string, who: StepRow["who"], state: StepRow["state"]): StepRow =>
  ({ id, label: id, who, state }) as StepRow;
const run = (mode: RunRow["mode"], steps: StepRow[], at: string | null): RunRow =>
  ({ setup: "setup.t", name: "Sending domain", mode, step: at, steps }) as RunRow;

describe("runTag", () => {
  it("says whose turn it is to whoever looks", () => {
    expect(runTag("waiting_client", false).label).toBe("Your turn");
    expect(runTag("waiting_client", true).label).toBe("Waiting on the client");
    expect(runTag("waiting_wren", false).label).toBe("Waiting on Wren's team");
    expect(runTag("waiting_wren", true).label).toBe("Your turn");
    expect(runTag("done", false)).toEqual({ label: "Set up", tone: "green" });
  });

  it("tints a lost or stuck setup as a warning", () => {
    expect(runTag("lost", true)).toEqual({ label: "Lost", tone: "warn" });
    expect(runTag("stuck", false)).toEqual({ label: "Stuck", tone: "warn" });
  });
});

describe("rail", () => {
  const steps = [
    step("buy", "wren", "done"),
    step("dns", "client", "waiting_client"),
    step("warm", "auto", "later"),
  ];
  it("marks the client's step as theirs, the team's view as waiting", () => {
    const self = run("self", steps, "dns");
    expect(railOf(self, false)[0]?.steps.map((s) => [s.state, s.note])).toEqual([
      ["done", "Done"],
      ["yours", "You"],
      ["idle", "A check"],
    ]);
    expect(railOf(self, true)[0]?.steps[1]).toMatchObject({ state: "waiting", note: "The client" });
    expect(currentOf(self)?.id).toBe("dns");
  });
  it("done for you: the client's steps are Wren's", () => {
    const mine = run("for_you", steps, "dns");
    expect(railOf(mine, true)[0]?.steps[1]?.state).toBe("yours");
    expect(whoText({ who: "client" }, "for_you", false)).toBe("Wren");
    expect(currentOf(run("self", steps, null))).toBe(null);
  });
});

describe("vendors", () => {
  it("names a mode, today's room and money", () => {
    expect(modeTag({ mode: null, own: "key" }, false).label).toBe("Not set up");
    expect(modeTag({ mode: "own", own: "login" }, false).label).toBe("Own login");
    expect(modeTag({ mode: "managed", own: "key" }, false).label).toBe("On Wren's key");
    expect(roomText({ room: 7, why: null, units: "searches", quota: null })).toBe(
      "7 searches left today",
    );
    expect(roomText({ room: 0, why: "Needs setup", units: "searches", quota: null })).toBe(
      "Needs setup",
    );
    expect(roomText({ room: null, why: null, units: "searches", quota: null })).toBe(
      "No daily limit",
    );
    expect(dollars(21_000)).toBe("$0.02");
    expect(dollars(12_400_000)).toBe("$12.40");
  });
});

describe("mailTag", () => {
  it("names each mailbox state as Account → Mail shows it", () => {
    expect(mailTag("not_set_up").label).toBe("Not set up");
    expect(mailTag("waiting_admin").label).toBe("Waiting on admin");
    expect(mailTag("send_only").label).toBe("Connected (send only)");
    expect(mailTag("read_send").label).toBe("Connected (read and send)");
    expect(mailTag("broken")).toEqual({ label: "Broken", tone: "warn" });
  });
});
