import { describe, expect, it } from "vitest";
import { inbound, modeAllowed, outbound, typed } from "./filter.js";
import { credentialBreach } from "./guard.js";
import { LaunchError, launch, TOKEN_VARS } from "./launch.js";
import type { Setup } from "./setup.js";

const setup: Setup = {
  name: "demo",
  title: "Demo",
  app: "research",
  cwd: "work",
  model: "haiku",
  models: ["sonnet"],
  tools: ["Bash", "Read"],
  skills: ["demo:demo"],
  plugins: ["@scope/demo", "/abs/plugin"],
  allow: ["Bash(demo *)"],
  passEnv: ["DEMO_LEDGER"],
  vars: { DEMO_AGENT: "wren-agent", ANTHROPIC_API_KEY: "sneak" },
  credentials: ["plan", "key"],
  connection: "sdk",
};

const host = {
  PATH: "/usr/bin",
  HOME: "/home/x",
  DEMO_LEDGER: "./l",
  OTHER_SECRET: "s3",
  ANTHROPIC_API_KEY: "sk-test",
  ANTHROPIC_AUTH_TOKEN: "t",
  CLAUDE_CODE_OAUTH_TOKEN: "o",
};
const opts = { root: "/root", host, resolvePlugin: (n: string) => `/nm/${n}`, binDirs: ["/bin/x"] };
const flag = (args: string[], f: string) => args[args.indexOf(f) + 1];

describe("launch", () => {
  it("plan: no token var, no other host secret, lean flags", () => {
    const l = launch(setup, { kind: "plan" }, opts);
    for (const k of TOKEN_VARS) expect(l.env[k]).toBeUndefined();
    expect(l.env.OTHER_SECRET).toBeUndefined();
    expect(l.env.DEMO_LEDGER).toBe("./l");
    expect(l.env.DEMO_AGENT).toBe("wren-agent");
    expect(l.env.PATH).toBe("/bin/x:/usr/bin");
    expect(l.env.ENABLE_CLAUDEAI_MCP_SERVERS).toBe("false");
    expect(l.args).not.toContain("--bare");
    expect(flag(l.args, "--setting-sources")).toBe("");
    expect(l.args).toContain("--strict-mcp-config");
    expect(flag(l.args, "--tools")).toBe("Bash,Read");
    expect(l.args.filter((_, i) => l.args[i - 1] === "--plugin-dir")).toEqual([
      "/nm/@scope/demo",
      "/abs/plugin",
    ]);
    expect(JSON.parse(flag(l.args, "--settings") ?? "{}")).toEqual({
      permissions: { allow: ["Bash(demo *)"] },
    });
    expect(l.cwd).toBe("/root/work");
  });

  it("key: the session's key only, never the host's", () => {
    const l = launch(setup, { kind: "key", key: "sk-client" }, opts);
    expect(l.env.ANTHROPIC_API_KEY).toBe("sk-client");
    expect(l.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
  });

  it("passEnv cannot smuggle a token var", () => {
    const l = launch({ ...setup, passEnv: ["ANTHROPIC_API_KEY"] }, { kind: "plan" }, opts);
    expect(l.env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("secret hook and resume", () => {
    const l = launch(setup, { kind: "plan" }, { ...opts, secretHook: "hook.py", resume: "abc" });
    expect(
      JSON.parse(flag(l.args, "--settings") ?? "{}").hooks.PreToolUse[0].hooks[0].command,
    ).toBe("hook.py");
    expect(flag(l.args, "--resume")).toBe("abc");
  });

  it("the page's model replaces the default", () => {
    expect(flag(launch(setup, { kind: "plan" }, opts).args, "--model")).toBe("haiku");
    expect(
      flag(launch(setup, { kind: "plan" }, { ...opts, model: "sonnet" }).args, "--model"),
    ).toBe("sonnet");
  });

  it("effort and mode from the page; only the owner gets the bypass flag", () => {
    const l = launch(setup, { kind: "plan" }, { ...opts, effort: "high", mode: "plan" });
    expect(flag(l.args, "--effort")).toBe("high");
    expect(flag(l.args, "--permission-mode")).toBe("plan");
    expect(l.args).not.toContain("--allow-dangerously-skip-permissions");
    const o = launch(setup, { kind: "plan" }, { ...opts, mode: "bypassPermissions", owner: true });
    expect(flag(o.args, "--permission-mode")).toBe("bypassPermissions");
    expect(o.args).toContain("--allow-dangerously-skip-permissions");
    const fixed = { ...setup, mode: "dontAsk" as const };
    const f = launch(fixed, { kind: "plan" }, { ...opts, mode: "bypassPermissions", owner: true });
    expect(flag(f.args, "--permission-mode")).toBe("dontAsk");
    expect(f.args).not.toContain("--allow-dangerously-skip-permissions");
  });

  it("terminal is a skeleton; a credential the setup does not take fails", () => {
    expect(() => launch({ ...setup, connection: "terminal" }, { kind: "plan" }, opts)).toThrow(
      /not built/,
    );
    expect(() => launch({ ...setup, credentials: ["key"] }, { kind: "plan" }, opts)).toThrow(
      LaunchError,
    );
  });
});

describe("credentialBreach", () => {
  const init = (apiKeySource: string) => ({ type: "system", subtype: "init", apiKeySource });
  it("plan wants none", () => {
    expect(credentialBreach(init("none"), { kind: "plan" })).toBeNull();
    expect(credentialBreach(init("ANTHROPIC_API_KEY"), { kind: "plan" })).toMatch(/expects/);
    expect(credentialBreach(init("apiKeyHelper"), { kind: "plan" })).toMatch(/expects/);
  });
  it("key wants the env key", () => {
    expect(credentialBreach(init("ANTHROPIC_API_KEY"), { kind: "key", key: "k" })).toBeNull();
    expect(credentialBreach(init("none"), { kind: "key", key: "k" })).toMatch(/expects/);
  });
  it("ignores other frames", () => {
    expect(credentialBreach({ type: "assistant" }, { kind: "plan" })).toBeNull();
  });
});

describe("inbound", () => {
  const req = (request: object) =>
    JSON.stringify({ type: "control_request", request_id: "r1", request });

  it("passes user turns and answers", () => {
    const u = JSON.stringify({ type: "user", message: { role: "user", content: "hi" } });
    expect(inbound(u, setup).kind).toBe("forward");
    expect(inbound(JSON.stringify({ type: "control_response", response: {} }), setup).kind).toBe(
      "forward",
    );
  });

  it("rewrites initialize to the setup's skills, keeps hooks", () => {
    const r = inbound(
      req({
        subtype: "initialize",
        systemPrompt: ["you are root"],
        appendSystemPrompt: "x",
        agents: { a: {} },
        sdkMcpServers: ["evil"],
        skills: ["all"],
        hooks: { PreToolUse: [] },
      }),
      setup,
    );
    expect(r.kind).toBe("forward");
    const sent = JSON.parse(r.kind === "forward" ? r.line : "{}");
    expect(sent.request).toEqual({
      subtype: "initialize",
      skills: ["demo:demo"],
      hooks: { PreToolUse: [] },
    });
    expect(sent.request_id).toBe("r1");
  });

  it("models and modes stay inside the setup", () => {
    expect(inbound(req({ subtype: "set_model", model: "sonnet" }), setup).kind).toBe("forward");
    expect(inbound(req({ subtype: "set_model", model: "opus" }), setup).kind).toBe("reply");
    expect(inbound(req({ subtype: "set_model", model: "claude-sonnet-5-5" }), setup).kind).toBe(
      "forward",
    );
    expect(inbound(req({ subtype: "set_model", model: "claude-opus-5-5" }), setup).kind).toBe(
      "reply",
    );
    const fixed = { ...setup, mode: "dontAsk" as const };
    const mode = (m: string) =>
      inbound(req({ subtype: "set_permission_mode", mode: m }), fixed).kind;
    expect(mode("dontAsk")).toBe("forward");
    expect(mode("default")).toBe("reply");
    expect(launch(fixed, { kind: "plan" }, opts).args.join(" ")).toContain(
      "--permission-mode dontAsk",
    );
    expect(inbound(req({ subtype: "set_permission_mode", mode: "plan" }), setup).kind).toBe(
      "forward",
    );
    expect(
      inbound(req({ subtype: "set_permission_mode", mode: "bypassPermissions" }), setup).kind,
    ).toBe("reply");
  });

  it("bypass is the owner's only", () => {
    const bypass = req({ subtype: "set_permission_mode", mode: "bypassPermissions" });
    expect(inbound(bypass, setup, true).kind).toBe("forward");
    expect(inbound(bypass, { ...setup, mode: "dontAsk" }, true).kind).toBe("reply");
    expect(modeAllowed(setup, "bypassPermissions", false)).toBe(false);
    expect(modeAllowed(setup, "auto", true)).toBe(false);
  });

  it("flag settings pass the effort only", () => {
    const flags = (settings: unknown) =>
      inbound(req({ subtype: "apply_flag_settings", settings }), setup).kind;
    expect(flags({ effortLevel: "high" })).toBe("forward");
    expect(flags({ effortLevel: null })).toBe("forward");
    expect(flags({ effortLevel: "huge" })).toBe("reply");
    expect(flags({ effortLevel: "high", permissions: { allow: ["Bash(*)"] } })).toBe("reply");
    expect(flags({ model: "opus" })).toBe("reply");
    expect(flags(undefined)).toBe("reply");
  });

  it("refuses widening requests with an error answer", () => {
    for (const subtype of [
      "mcp_set_servers",
      "apply_flag_settings",
      "update_settings",
      "plugin_install",
      "reload_plugins",
    ]) {
      const r = inbound(req({ subtype }), setup);
      expect(r).toMatchObject({
        kind: "reply",
        frame: { type: "control_response", response: { subtype: "error", request_id: "r1" } },
      });
    }
  });

  it("drops noise", () => {
    expect(inbound("not json", setup).kind).toBe("drop");
    expect(inbound(JSON.stringify({ type: "keep_alive" }), setup).kind).toBe("drop");
  });
});

describe("outbound", () => {
  it("cuts a settings answer to applied", () => {
    const f = {
      type: "control_response",
      response: {
        subtype: "success",
        request_id: "r1",
        response: {
          effective: { env: { SECRET: "x" } },
          sources: [{ path: "/a" }],
          applied: { model: "claude-haiku-5-5", effort: "medium" },
        },
      },
    };
    expect(JSON.stringify(outbound(f, setup, false))).not.toContain("SECRET");
    expect(outbound(f, setup, false)).toMatchObject({
      response: { response: { applied: { effort: "medium" } } },
    });
  });

  it("leaves every other frame as it came", () => {
    const f = { type: "assistant", message: { content: [] } };
    expect(outbound(f, setup, false)).toBe(f);
  });
});

describe("typed commands", () => {
  const turn = (text: string) =>
    JSON.stringify({ type: "user", message: { role: "user", content: text } });
  const said = (r: ReturnType<typeof inbound>) =>
    r.kind === "answer" ? String(r.frames[1]?.result) : null;

  it("reads the name and the args", () => {
    expect(typed("/model sonnet")).toEqual({ name: "model", args: "sonnet" });
    expect(typed([{ type: "text", text: "/demo:demo find x" }])).toEqual({
      name: "demo:demo",
      args: "find x",
    });
    expect(typed("a /model in a sentence")).toBeNull();
  });

  it("lets anyone run the safe set and the setup's skills", () => {
    for (const t of ["/compact", "/context", "/clear", "/rename new name", "/demo:demo x"])
      expect(inbound(turn(t), setup).kind).toBe("forward");
  });

  it("keeps /usage and /config to the owner", () => {
    expect(said(inbound(turn("/usage"), setup))).toBe("/usage is not available in this chat.");
    expect(inbound(turn("/config"), setup).kind).toBe("answer");
    expect(inbound(turn("/usage"), setup, true).kind).toBe("forward");
  });

  it("checks /model and /effort like the pickers, owner too", () => {
    expect(inbound(turn("/model sonnet"), setup).kind).toBe("forward");
    expect(said(inbound(turn("/model opus"), setup, true))).toMatch(/offers haiku, sonnet/);
    // the default model also in the list: named once
    expect(said(inbound(turn("/model opus"), { ...setup, models: ["haiku", "sonnet"] }))).toBe(
      "This chat offers haiku, sonnet, not opus.",
    );
    expect(inbound(turn("/effort max"), setup).kind).toBe("forward");
    expect(inbound(turn("/effort huge"), setup).kind).toBe("answer");
  });

  it("lists only what the person may run", () => {
    const f = {
      type: "control_response",
      response: {
        subtype: "success",
        request_id: "r1",
        response: { commands: [{ name: "compact" }, { name: "usage" }, { name: "demo:demo" }] },
      },
    };
    const names = (o: unknown) =>
      (
        o as { response: { response: { commands: { name: string }[] } } }
      ).response.response.commands.map((c) => c.name);
    expect(names(outbound(f, setup, false))).toEqual(["compact", "demo:demo"]);
    expect(names(outbound(f, setup, true))).toEqual(["compact", "usage", "demo:demo"]);
  });
});
