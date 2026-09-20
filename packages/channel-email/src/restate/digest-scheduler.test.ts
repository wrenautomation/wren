import { loadSettings } from "@wren/config";
import { describe, expect, it } from "vitest";
import { SendPolicy } from "../send/policy.js";
import { nextDigestAt } from "./digest-scheduler.js";

const NY = SendPolicy.fromSettings(
  loadSettings({ WREN_DATABASE_URL: "postgresql://x", WREN_SEND_TIMEZONE: "America/New_York" }),
);

describe("nextDigestAt", () => {
  it("is 07:00 today when now is before it, tomorrow otherwise (fleet clock)", () => {
    expect(nextDigestAt(NY, new Date("2026-09-21T09:30:00Z")).toISOString()).toBe(
      "2026-09-21T11:00:00.000Z",
    );
    expect(nextDigestAt(NY, new Date("2026-09-21T11:00:00Z")).toISOString()).toBe(
      "2026-09-22T11:00:00.000Z",
    );
  });
});
