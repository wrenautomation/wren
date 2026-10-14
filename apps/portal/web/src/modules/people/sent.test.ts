// The sent page: its declaration matches the record it reads, and each channel previews as itself.

import { sentRecord } from "@wren/core/sent/records";
import { describe, expect, it } from "vitest";
import { looksOf, sentExtras, sentPage } from "./sent.js";

const sent = {
  site: null,
  from: null,
  to: "ann@example.test",
  subject: null,
  body: "Hello",
};

describe("sent page", () => {
  it("reads only fields and views the record declares", () => {
    const fields = Object.keys(sentRecord.fields);
    for (const c of sentPage.columns ?? []) expect(fields, c).toContain(c);
    const views = (sentRecord.views ?? []).map((v) => v.id);
    expect(Object.keys(sentPage.empty as object).sort()).toEqual([...views].sort());
    expect(sentPage.record).toBe(sentRecord.id);
  });

  it("previews each channel in its own look", () => {
    expect(looksOf({ ...sent, as: "email", from: "me@example.test", subject: "Hi" })).toEqual({
      kind: "email",
      from: "me@example.test",
      subject: "Hi",
    });
    expect(looksOf({ ...sent, as: "sms" })).toEqual({ kind: "sms" });
    expect(looksOf({ ...sent, as: "dm", site: "Reddit", subject: "Hi" })).toEqual({
      kind: "dm",
      site: "Reddit",
      subject: "Hi",
    });
    expect(looksOf({ ...sent, as: "post", site: "LinkedIn", from: "acct" })).toMatchObject({
      kind: "post",
      site: "LinkedIn",
      from: "acct",
    });
  });

  it("adds the message when it has words, and nothing when it is gone", () => {
    const at = { row: {} } as Parameters<typeof sentExtras>[1];
    expect(sentExtras(null, at)).toEqual({});
    expect(sentExtras({ ...sent, as: "sms", body: "" }, at)).toEqual({});
    expect(sentExtras({ ...sent, as: "sms" }, at).sections?.map(([title]) => title)).toEqual([
      "As it went out",
    ]);
  });
});
