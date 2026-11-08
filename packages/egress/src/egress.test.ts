import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  aclOf,
  byHost,
  decisionOf,
  mergeSandbox,
  parseWrenfile,
  setupEgress,
  WrenfileError,
} from "./index.js";

const FILE = `
version: 1
secrets: [~/.aws, "@/keys.env"]
roles:
  agents: { port: 4761, mode: report, hosts: [api.example.com] }
  web: { port: 4762, mode: open }
agents:
  default: { role: agents }
  reader: { role: web, run: [reader], hosts: ["*.example.org"] }
`;

describe("Wrenfile", () => {
  it("the repo's own file parses", () => {
    const w = parseWrenfile(readFileSync(join(import.meta.dirname, "../../../Wrenfile"), "utf8"));
    expect(w.agents.default).toBeDefined();
  });

  it("names every problem at once", () => {
    const bad = FILE.replace("port: 4762", "port: 4761")
      .replace("role: web", "role: nope")
      .replace("~/.aws", "/etc/x");
    expect(() => parseWrenfile(bad)).toThrow(WrenfileError);
    try {
      parseWrenfile(bad);
    } catch (e) {
      const m = (e as Error).message;
      expect(m).toContain("share port 4761");
      expect(m).toContain("no role nope");
      expect(m).toContain("starts with ~/ or @/");
    }
  });

  it("refuses a host smokescreen would not take", () => {
    expect(() => parseWrenfile(FILE.replace("api.example.com", "api.*.example.com"))).toThrow(
      /a host like/,
    );
  });
});

describe("compile", () => {
  const w = parseWrenfile(FILE);

  it("a role is one default rule", () => {
    expect(parse(aclOf("agents", w.roles.agents!))).toEqual({
      version: "v1",
      services: [],
      default: { project: "wren-agents", action: "report", allowed_domains: ["api.example.com"] },
    });
  });

  it("a setup gets its role's proxy, its CLIs outside, every secret denied", () => {
    const e = setupEgress(w, "reader", "/root");
    expect(e.role).toBe("web");
    expect(e.env.HTTPS_PROXY).toBe("http://127.0.0.1:4762");
    expect(e.env.NODE_USE_ENV_PROXY).toBe("1");
    expect(e.sandbox).toMatchObject({
      enabled: true,
      allowUnsandboxedCommands: false,
      excludedCommands: ["reader", "reader *"],
      filesystem: { denyRead: ["~/.aws", "//root/keys.env"] },
      network: { allowedDomains: ["*.example.org"] },
    });
    expect(e.deny).toContain("Read(//root/keys.env/**)");
    expect(e.deny).toContain("Read(~/.aws)");
    expect(e.note).toContain("`reader` run outside it only as a plain call");
  });

  it("a setup with no entry gets default", () => {
    const e = setupEgress(w, "other", "/root");
    expect(e.role).toBe("agents");
    expect(e.note).toBeUndefined();
  });

  it("a setup's own sandbox adds, never loosens", () => {
    const policy = setupEgress(w, "other", "/root").sandbox;
    const m = mergeSandbox(policy, {
      enabled: false,
      autoAllowBashIfSandboxed: true,
      excludedCommands: ["git *"],
      filesystem: { denyRead: [], allowWrite: ["/tmp/x"] },
      network: { allowedDomains: ["localhost"], allowLocalBinding: true },
    });
    expect(m).toMatchObject({
      enabled: true,
      autoAllowBashIfSandboxed: true,
      excludedCommands: ["git *"],
      filesystem: { denyRead: ["~/.aws", "//root/keys.env"], allowWrite: ["/tmp/x"] },
      network: { allowedDomains: ["localhost"], allowLocalBinding: true },
    });
  });
});

describe("log", () => {
  const line = (host: string, allow: boolean, miss: boolean, at = "2026-11-08T19:00:00Z") =>
    JSON.stringify({
      msg: "CANONICAL-PROXY-DECISION",
      requested_host: `${host}:443`,
      allow,
      enforce_would_deny: miss,
      decision_reason: "x",
      start_time: at,
    });

  it("reads decisions only, grouped by host", () => {
    const ds = [
      line("a.example.com", true, false),
      line("b.example.com", true, true, "2026-11-08T20:00:00Z"),
      line("b.example.com", false, true),
      '{"msg":"CANONICAL-PROXY-CN-CLOSE"}',
      "not json",
    ].flatMap((l) => decisionOf(l) ?? []);
    expect(byHost(ds)).toEqual([
      { host: "b.example.com", n: 2, denied: 1, misses: 2, last: "2026-11-08T20:00:00Z" },
      { host: "a.example.com", n: 1, denied: 0, misses: 0, last: "2026-11-08T19:00:00Z" },
    ]);
  });
});
