import { describe, expect, it } from "vitest";
import { loadSettings } from "./index.js";

describe("loadSettings", () => {
  it("reads WREN_* keys and applies defaults", () => {
    const s = loadSettings({ WREN_DATABASE_URL: "postgresql://u:p@h:1/d" });
    expect(s.databaseUrl).toBe("postgresql://u:p@h:1/d");
    expect(s.inboxDir).toMatch(/\/inbox$/);
    expect(s.logLevel).toBe("info");
    expect(s.llm).toBe("fake");
    expect(s.robotsMode).toBe("warn");
    expect(s.fetchContact).toBeUndefined();
  });
  it("reads the enrichment settings", () => {
    const s = loadSettings({
      WREN_DATABASE_URL: "postgresql://u:p@h:1/d",
      WREN_FETCH_CONTACT: "ops@example.com",
      WREN_ROBOTS_MODE: "enforce",
      WREN_LLM: "groq:llama",
    });
    expect(s.fetchContact).toBe("ops@example.com");
    expect(s.robotsMode).toBe("enforce");
    expect(s.llm).toBe("groq:llama");
    expect(() =>
      loadSettings({ WREN_DATABASE_URL: "postgresql://u:p@h:1/d", WREN_ROBOTS_MODE: "maybe" }),
    ).toThrow(/WREN_ROBOTS_MODE/);
  });
  it("names the env var when a value is missing or invalid", () => {
    expect(() => loadSettings({})).toThrow(/WREN_DATABASE_URL/);
    expect(() =>
      loadSettings({ WREN_DATABASE_URL: "postgresql://u:p@h:1/d", WREN_LOG_LEVEL: "loud" }),
    ).toThrow(/WREN_LOG_LEVEL/);
  });
  it("resolves directories against rootDir", () => {
    const s = loadSettings(
      { WREN_DATABASE_URL: "postgresql://u:p@h:1/d" },
      { rootDir: "/srv/wren" },
    );
    expect(s.inboxDir).toBe("/srv/wren/inbox");
    expect(s.draftsDir).toBe("/srv/wren/drafts");
  });
  it("reads the inbox-side settings and leaves the secrets unset by default", () => {
    const s = loadSettings({
      WREN_DATABASE_URL: "postgresql://u:p@h:1/d",
      WREN_POSTMASTER_USER: "will@example.com",
      WREN_PIXEL_EXPORT_TOKEN: "s3cret",
    });
    expect(s.postmasterUser).toBe("will@example.com");
    expect(s.pixelExportToken).toBe("s3cret");
    const bare = loadSettings({ WREN_DATABASE_URL: "postgresql://u:p@h:1/d" });
    expect(bare.postmasterUser).toBeUndefined();
    expect(bare.pixelExportToken).toBeUndefined();
    expect(bare.daemonSyncSeconds).toBe(300);
  });
  it("keeps new mail pixel-free unless WREN_OPEN_TRACKING is on", () => {
    const base = { WREN_DATABASE_URL: "postgresql://u:p@h:1/d", WREN_PIXEL_BASE_URL: "https://t" };
    expect(loadSettings(base).openTracking).toBe(false);
    expect(loadSettings({ ...base, WREN_OPEN_TRACKING: "true" }).openTracking).toBe(true);
    expect(loadSettings({ ...base, WREN_OPEN_TRACKING: "0" }).openTracking).toBe(false);
    expect(() => loadSettings({ ...base, WREN_OPEN_TRACKING: "yes" })).toThrow(/WREN_OPEN_TRACKING/);
  });

  it("treats empty strings as unset", () => {
    const s = loadSettings({ WREN_DATABASE_URL: "postgresql://u:p@h:1/d", WREN_INBOX_DIR: "" });
    expect(s.inboxDir).toMatch(/\/inbox$/);
  });
});
