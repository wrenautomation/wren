import { describe, expect, it } from "vitest";
import { ConsoleNotifier, DiscordNotifier, makeNotifier, plural } from "./notify.js";

describe("notifiers", () => {
  it("none never sends; console prints", async () => {
    expect(await makeNotifier("none").notify("x")).toBe(false);
    const lines: string[] = [];
    expect(await new ConsoleNotifier((l) => lines.push(l)).notify("t", "b", "warning")).toBe(true);
    expect(lines).toEqual(["[notify:warning] t\nb"]);
  });

  it("discord posts JSON content, marks warnings, and cuts long bodies", async () => {
    const calls: { url: string; body: string }[] = [];
    const http = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: String(init?.body) });
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    const n = new DiscordNotifier("https://hook.example/x", http, () => {});
    expect(await n.notify("3 replies", "a".repeat(5000), "warning")).toBe(true);
    const content = JSON.parse(calls[0]?.body ?? "{}").content as string;
    expect(content.startsWith("⚠️ **3 replies**\naaa")).toBe(true);
    expect(content.length).toBeLessThanOrEqual(1900);
  });

  it("discord failures return false and never throw", async () => {
    const logged: string[] = [];
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    const n = new DiscordNotifier("https://hook.example/secret", down, (l) => logged.push(l));
    expect(await n.notify("x")).toBe(false);
    expect(logged.join()).not.toContain("secret");
    const bad = (async () => new Response("", { status: 400 })) as typeof fetch;
    expect(await new DiscordNotifier("https://h/x", bad, () => {}).notify("x")).toBe(false);
  });

  it("discord without a URL refuses at construction", () => {
    expect(() => makeNotifier("discord")).toThrow(/WREN_DISCORD_WEBHOOK_URL/);
  });

  it("plural", () => {
    expect(plural(1, "reply", "replies")).toBe("1 reply");
    expect(plural(2, "reply", "replies")).toBe("2 replies");
  });
});
