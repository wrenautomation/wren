import { describe, expect, it } from "vitest";
import { draftAnswerOf, type QuestionRequest, questionOf } from "./ask.js";

const req = (o: Partial<QuestionRequest>) =>
  ({ viewer: { email: "ops@example.com", operator: true }, ...o }) as QuestionRequest;

describe("questionOf", () => {
  it("keeps who, the trimmed question and a console page", () => {
    expect(questionOf(req({ question: "  how many replies?  ", page: "/inbox/waiting" }))).toEqual({
      by: "ops@example.com",
      question: "how many replies?",
      page: "/inbox/waiting",
    });
  });

  it("drops a page that isn't a console path, refuses empty and long questions", () => {
    expect(questionOf(req({ question: "q", page: "https://evil.example" })).page).toBeNull();
    expect(() => questionOf(req({ question: "   " }))).toThrow(/ask something/);
    expect(() => questionOf(req({ question: 5 }))).toThrow(/ask something/);
    expect(() => questionOf(req({ question: "x".repeat(4001) }))).toThrow(/under 4000/);
  });
});

describe("draftAnswerOf", () => {
  it("reads the JSON object, fenced or not, and trims an empty draft to null", () => {
    expect(draftAnswerOf('```json\n{"reply": " Shorter. ", "draft": " New. "}\n```')).toEqual({
      reply: "Shorter.",
      draft: "New.",
    });
    expect(draftAnswerOf('{"reply": "Fine as is.", "draft": "  "}').draft).toBeNull();
    expect(draftAnswerOf('{"reply": "Fine as is.", "draft": null}').draft).toBeNull();
  });

  it("takes anything else as a reply that writes nothing", () => {
    expect(draftAnswerOf("It reads well.")).toEqual({ reply: "It reads well.", draft: null });
    expect(draftAnswerOf('{"answer": "x"}').draft).toBeNull();
    expect(draftAnswerOf("{not json}").reply).toBe("{not json}");
  });
});
