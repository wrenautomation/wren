import { describe, expect, it } from "vitest";
import { type BoxPort, boxPort, wakeBox } from "./autobrowse-box.js";

function port(state: string) {
  const calls: string[] = [];
  const box: BoxPort = {
    state: async (id) => {
      calls.push(`state ${id}`);
      return state;
    },
    start: async (id, by) => {
      calls.push(`start ${id} by ${by}`);
    },
  };
  return { box, calls };
}

describe("wakeBox", () => {
  it("starts a stopped box tagged as ours; leaves a running or booting one", async () => {
    const stopped = port("stopped");
    expect(await wakeBox(stopped.box, "i-1")()).toBe("started");
    expect(stopped.calls).toEqual(["state i-1", "start i-1 by wren"]);
    for (const s of ["running", "pending"]) {
      const p = port(s);
      expect(await wakeBox(p.box, "i-1")()).toBe("running");
      expect(p.calls).toEqual(["state i-1"]);
    }
  });

  it("throws while the box is stopping, so the durable step retries later", async () => {
    await expect(wakeBox(port("stopping").box, "i-1")()).rejects.toThrow(/still stopping/);
  });

  it("tags before starting", async () => {
    const sent: Array<{ name: string; input: unknown }> = [];
    const client = {
      send: async (cmd: { constructor: { name: string }; input: unknown }) => {
        sent.push({ name: cmd.constructor.name, input: cmd.input });
        return cmd.constructor.name === "DescribeInstancesCommand"
          ? { Reservations: [{ Instances: [{ State: { Name: "stopped" } }] }] }
          : {};
      },
    } as never;
    const box = boxPort(client);
    expect(await box.state("i-1")).toBe("stopped");
    await box.start("i-1", "wren");
    expect(sent.map((s) => s.name)).toEqual([
      "DescribeInstancesCommand",
      "CreateTagsCommand",
      "StartInstancesCommand",
    ]);
    expect(sent[1]?.input).toEqual({
      Resources: ["i-1"],
      Tags: [{ Key: "autobrowse:started-by", Value: "wren" }],
    });
  });
});
