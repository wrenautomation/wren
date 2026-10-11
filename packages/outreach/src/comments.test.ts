import { describe, expect, it } from "vitest";
import { noiseInWords } from "./comments.js";

describe("noiseInWords", () => {
  it.each([
    ["🔥🔥🔥", "Emoji or punctuation only."],
    ["!!!", "Emoji or punctuation only."],
    ["@sam_k @jo.b", "Only tags someone."],
    ["@sam_k 👀", "Only tags someone."],
    ["Great post!", "A short nod: nothing to answer."],
    ["Thanks for sharing 🙏", "A short nod: nothing to answer."],
    ["so true", "A short nod: nothing to answer."],
    ["W", "A short nod: nothing to answer."],
    ["hahaha", "A short nod: nothing to answer."],
    ["Check out my page for more tips", "Spam or a follow ask."],
    ["Message me on WhatsApp for crypto signals", "Spam or a follow ask."],
  ])("%s is noise", (text, why) => {
    expect(noiseInWords(text)).toBe(why);
  });

  it.each([
    "Great post, does it work with QuickBooks?",
    "?",
    "Nice, dm me the template",
    "We tried this last year and it cut our chasing in half",
    "Thanks, this helped me fix our invoice reminders",
    "great",
  ])("%s is kept", (text) => {
    // "great" alone is a nod, but a review is never noise.
    expect(noiseInWords(text, text === "great" ? "review" : "post_reply")).toBeNull();
  });
});
