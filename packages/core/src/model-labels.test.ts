import { describe, expect, it } from "vitest";
import { modelLabel, modelVia } from "./model-labels.js";

describe("modelLabel", () => {
  it.each([
    ["cohere:command-a-03-2025", "Command A"],
    ["claude-haiku-4-5:agent", "Claude Haiku 4.5"],
    ["gateway:free", "Free models"],
    ["gateway:free-bulk", "Free models, bulk"],
    ["claude-code:sonnet", "Claude Sonnet"],
    ["gemini:gemini-2.5-flash", "Gemini 2.5 Flash"],
    ["cerebras:gpt-oss-120b", "GPT OSS 120B"],
    ["openrouter:google/gemma-4-31b-it:free", "Gemma 4 31B"],
    ["deterministic", "Rules, no model"],
    ["smtp", "Mail server check"],
  ])("%s reads %s", (id, label) => expect(modelLabel(id)).toBe(label));

  it("says where it ran when the id does", () => {
    expect(modelVia("cohere:command-a-03-2025")).toBe("Cohere");
    expect(modelVia("deterministic")).toBeNull();
  });
});
