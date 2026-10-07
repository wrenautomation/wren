import { describe, expect, it } from "vitest";
import { pollOutput } from "./poll.js";

const answers = (...rs: [number, string][]) => {
  const asked: { url: string; headers: unknown }[] = [];
  const fake = (async (url: string, init?: RequestInit) => {
    asked.push({ url, headers: init?.headers });
    const [status, body] = rs.shift() ?? [500, "no more answers"];
    return new Response(body, { status });
  }) as unknown as typeof fetch;
  return { fake, asked };
};
const noWait = async () => {};

describe("pollOutput", () => {
  it("asks until the output is there, with the ingress's headers", async () => {
    const { fake, asked } = answers([470, "not ready"], [470, "not ready"], [200, '{"queued":2}']);
    const out = await pollOutput<{ queued: number }>("inv_1", {
      url: "https://ingress.example/",
      headers: { Authorization: "Bearer t" },
      fetch: fake,
      sleep: noWait,
    });
    expect(out).toEqual({ queued: 2 });
    expect(asked).toHaveLength(3);
    expect(asked[0]?.url).toBe("https://ingress.example/restate/invocation/inv_1/output");
    expect(asked[0]?.headers).toEqual({ Authorization: "Bearer t" });
  });

  it("throws the handler's failure", async () => {
    const { fake } = answers([500, '{"message":"no model is set"}']);
    await expect(
      pollOutput("inv_2", { url: "http://x", fetch: fake, sleep: noWait }),
    ).rejects.toThrow(/inv_2 failed \(500\).*no model is set/);
  });

  it("gives up after the max wait; the call keeps going", async () => {
    const { fake, asked } = answers(
      ...Array.from({ length: 10 }, () => [470, ""] as [number, string]),
    );
    await expect(
      pollOutput("inv_3", { url: "http://x", fetch: fake, sleep: noWait, everyMs: 10, maxMs: 30 }),
    ).rejects.toThrow(/still running.*inv_3/);
    expect(asked).toHaveLength(4);
  });
});
