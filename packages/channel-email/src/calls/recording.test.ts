import type { CompleteOptions, LlmClient, LlmResponse } from "@wren/llm";
import { describe, expect, it } from "vitest";
import { CALL_NOTES, clock, recordingLine, transcriptOf, writeNotes } from "./recording.js";

const NOTES = {
  summary: "They run a small shop and want more booked jobs.",
  needs: ["More calls in winter"],
  objections: ["Tried an agency before"],
  next: ["Send the plan by Friday"],
};

function fakeLlm(text: string): LlmClient {
  return {
    name: "fake:model",
    complete: async (_p: string, _o: CompleteOptions): Promise<LlmResponse> =>
      ({ text, inputTokens: 1, outputTokens: 1 }) as unknown as LlmResponse,
  } as unknown as LlmClient;
}

describe("call recordings", () => {
  it("reads seconds as a clock", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(83.6)).toBe("1:23");
    expect(clock(3723)).toBe("1:02:03");
  });

  it("writes one timed line per spoken segment", () => {
    expect(
      transcriptOf([
        { start: 0, end: 2, text: " Hi there. " },
        { start: 2, end: 3, text: "  " },
        { start: 65, end: 70, text: "Let's start." },
      ]),
    ).toBe("[0:00] Hi there.\n[1:05] Let's start.");
  });

  it("puts the summary on the timeline and the notes under it", () => {
    const line = recordingLine(7, {
      startedAt: new Date("2026-10-16T15:00:00Z"),
      durationS: 1800,
      notes: CALL_NOTES.parse(NOTES),
    });
    expect(line).toMatchObject({
      kind: "call",
      channel: "calendar",
      source: "call_recordings",
      sourceId: "7",
      link: "/calendar/recordings/7",
    });
    expect(line.summary).toBe(`Call recorded, 30 min: ${NOTES.summary}`);
    expect(line.body).toContain("Needs\n- More calls in winter");
    expect(line.body).toContain("Next\n- Send the plan by Friday");
  });

  it("says only the length when there are no notes", () => {
    const line = recordingLine(1, { startedAt: new Date(), durationS: 20, notes: null });
    expect(line.summary).toBe("Call recorded, 1 min");
    expect(line.body).toBeNull();
  });

  it("keeps notes the model shapes right and drops the rest", async () => {
    const ok = await writeNotes(fakeLlm(JSON.stringify(NOTES)), "[0:00] hello", "Sam");
    expect(ok).toEqual({ notes: NOTES, model: "fake:model" });
    expect(await writeNotes(fakeLlm("not json"), "[0:00] hello", null)).toBeNull();
    expect(await writeNotes(fakeLlm(JSON.stringify(NOTES)), "  ", null)).toBeNull();
  });
});
