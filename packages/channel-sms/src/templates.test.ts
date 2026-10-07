import { parseBody } from "@wren/core/slots";
import { describe, expect, it } from "vitest";
import {
  checkBody,
  checkSequence,
  firstName,
  KEYWORD_SLOTS,
  keywordOf,
  type RenderFields,
  render,
  segments,
  sequenceSlots,
} from "./templates.js";

const fields: RenderFields = {
  first_name: "Dana",
  company: "Acme Studio",
  sender: "William",
  time: null,
  booking_link: null,
};

const text = (body: string, f = fields) => render(parseBody("t", body), f, "sms:1").body;

describe("render", () => {
  it("fills fields and falls back when empty", () => {
    expect(text("hi {first_name|there}, {sender} here re {company}")).toBe(
      "hi Dana, William here re Acme Studio",
    );
    expect(text("hi {first_name|there}", { ...fields, first_name: null })).toBe("hi there");
  });
  it("throws on an empty field with no fallback", () => {
    expect(() => text("{company}", { ...fields, company: " " })).toThrow(/no value/);
  });
  it("keeps the version and picks it rendered", () => {
    const tpl = parseBody("t", "[[Hi | Hey]] {first_name}. STOP to opt out");
    const out = render(tpl, fields, "sms:7");
    expect(out.provenance.version).toBe(tpl.version);
    expect(out).toEqual(render(tpl, fields, "sms:7"));
    expect(Object.keys(out.provenance.picks)).toEqual(["v1"]);
  });
});

describe("checkSequence", () => {
  const ok = { name: "s", steps: [{ step: 1, afterDays: 0 }] };
  it("accepts a good one", () => expect(checkSequence(ok)).toBe(ok));
  it("rejects no steps, bad order, and an opener that waits", () => {
    expect(() => checkSequence({ name: "s", steps: [] })).toThrow(/no steps/);
    expect(() =>
      checkSequence({
        name: "s",
        steps: [
          { step: 1, afterDays: 0 },
          { step: 3, afterDays: 2 },
        ],
      }),
    ).toThrow(/order/);
    expect(() => checkSequence({ name: "s", steps: [{ step: 1, afterDays: 2 }] })).toThrow(
      /afterDays/,
    );
  });
});

describe("checkBody", () => {
  const [opener, second] = sequenceSlots({
    name: "s",
    steps: [
      { step: 1, afterDays: 0 },
      { step: 2, afterDays: 3 },
    ],
  });
  const help = KEYWORD_SLOTS[0];
  it("keys slots the way messages record them", () => {
    expect([opener?.key, second?.key, help?.key]).toEqual(["s#1", "s#2", "keyword.help"]);
    expect([keywordOf("keyword.stop"), keywordOf("s#1"), keywordOf("keyword.x")]).toEqual([
      "stop",
      null,
      null,
    ]);
  });
  it("trims, and treats blank as empty", () => {
    expect(checkBody(second as never, "  hi {first_name|there}  ")).toBe("hi {first_name|there}");
    expect(checkBody(opener as never, "   ")).toBe("");
  });
  it("needs STOP in the opener only", () => {
    expect(() => checkBody(opener as never, "hi")).toThrow(/STOP/);
    expect(checkBody(opener as never, "hi. Reply stop to opt out")).toBe(
      "hi. Reply stop to opt out",
    );
    expect(checkBody(second as never, "hi")).toBe("hi");
  });
  it("refuses a field the slot does not fill", () => {
    expect(() => checkBody(second as never, "{nick} hi")).toThrow(/unknown field \{nick\}/);
    expect(() => checkBody(help as never, "hi {first_name}, write to us at x")).toThrow(
      /takes no fields/,
    );
  });
  it("holds keyword replies to Telnyx's 20 characters", () => {
    expect(() => checkBody(help as never, "too short")).toThrow(/20 characters/);
  });
});

describe("segments", () => {
  it("counts GSM-7 and UCS-2 parts", () => {
    expect(segments("a".repeat(160))).toEqual({ encoding: "GSM-7", units: 160, parts: 1 });
    expect(segments("a".repeat(161)).parts).toBe(2);
    expect(segments("[".repeat(80)).units).toBe(160);
    expect(segments("hi 👋").encoding).toBe("UCS-2");
    expect(segments("’".repeat(71)).parts).toBe(2);
  });
});

describe("firstName", () => {
  it("takes a first word that reads as a name", () => {
    expect(firstName("dana smith")).toBe("Dana");
    expect(firstName("J. Smith")).toBeNull();
    expect(firstName(null)).toBeNull();
  });
});
