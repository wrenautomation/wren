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
  it("treats empty strings as unset", () => {
    const s = loadSettings({ WREN_DATABASE_URL: "postgresql://u:p@h:1/d", WREN_INBOX_DIR: "" });
    expect(s.inboxDir).toMatch(/\/inbox$/);
  });
});
