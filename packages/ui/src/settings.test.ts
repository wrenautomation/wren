import { describe, expect, it } from "vitest";
import { settingRows, settingText, words } from "./settings.js";

describe("settingRows", () => {
  it("reads every leaf in words, labelled by the form, never as JSON", () => {
    const values = {
      on: false,
      stages: { research: true, send: false },
      sending: { perInboxPerDay: null },
      senders: [],
      senderName: null,
      approval: "first",
      days: [1, 3, 7],
    };
    const fields = [
      { field: "on", label: "On" },
      { field: "stages.research", label: "Stages: research" },
    ];
    expect(settingRows(values, fields)).toEqual([
      ["On", "Off"],
      ["Stages: research", "On"],
      ["Stages: send", "Off"],
      ["Sending: per inbox per day", "Not set"],
      ["Senders", "Not set"],
      ["Sender name", "Not set"],
      ["Approval", "first"],
      ["Days", ["1", "3", "7"]],
    ]);
  });

  it("says nothing for no settings, and an object in a list in words", () => {
    expect(settingRows(null)).toEqual([]);
    expect(settingRows({ x: {} })).toEqual([["X", "Not set"]]);
    expect(settingText([{ name: "a", wait: 2 }])).toBe("Name a, Wait 2");
    expect(words("openersPerDay")).toBe("Openers per day");
    expect(words("sender_name")).toBe("Sender name");
  });
});
