/** Email-pick graph: routing, auto-accept, grounding, parsing. Pure state, FakeLlm, no DB. */
import { FakeLlm, RecordingTracer } from "@wren/llm";
import { describe, expect, it } from "vitest";
import type { EmailSignal, SignalSource } from "../email-scan.js";
import {
  buildPickPrompt,
  byRules,
  type PickState,
  parsePick,
  route,
  runPickGraph,
} from "./graph.js";

function signal(
  email: string,
  opts: { onDomain?: boolean; source?: SignalSource; context?: string } = {},
): EmailSignal {
  return {
    email,
    source: opts.source ?? "text",
    context: opts.context ?? "",
    page_url: "https://x.com/contact",
    on_domain: opts.onDomain ?? true,
  };
}

const COMPANY = {
  name: "X Studio",
  domain: "x.com",
  pages: ["https://x.com"],
  snippet: "We build.",
};
const state = (partial: Partial<PickState>): PickState => ({
  company: COMPANY,
  signals: [],
  people: [],
  no_scannable: false,
  ...partial,
});

describe("route", () => {
  it("no signals is free", () => {
    expect(route(state({}))).toBe("empty_verdict");
  });
  it("single on-domain without people auto-accepts", () => {
    expect(route(state({ signals: [signal("hello@x.com")] }))).toBe("auto_accept");
  });
  it("ambiguity goes to the llm", () => {
    expect(route(state({ signals: [signal("a@x.com"), signal("b@x.com")] }))).toBe("classify");
    expect(route(state({ signals: [signal("a@gmail.com", { onDomain: false })] }))).toBe(
      "classify",
    );
    expect(
      route(
        state({ signals: [signal("a@x.com")], people: [{ full_name: "Jane Roe", title: null }] }),
      ),
    ).toBe("classify");
  });
  it("no scannable content short-circuits", async () => {
    const result = await runPickGraph(new FakeLlm(), state({ no_scannable: true }));
    expect(result.pick.method).toBe("no_scannable_content");
    expect(result.pick.best_send_to).toBeNull();
  });
});

describe("runPickGraph", () => {
  it("auto accept classifies role localparts without an llm", async () => {
    const calls: string[] = [];
    const llm = new FakeLlm({
      respond: (p) => {
        calls.push(p);
        return "{}";
      },
    });
    const result = await runPickGraph(llm, state({ signals: [signal("hello@x.com")] }));
    expect(calls).toEqual([]);
    expect(result.pick.method).toBe("auto_accept");
    expect(result.pick.best_send_to).toBe("hello@x.com");
    expect(result.pick.emails[0]?.classification).toBe("role");
  });

  it("grounding kills fabricated addresses and people", async () => {
    const response = JSON.stringify({
      emails: [
        { email: "jane@x.com", classification: "person", person_name: "Jane Roe" },
        { email: "invented@x.com", classification: "person", person_name: "Nobody" },
      ],
      best_send_to: "invented@x.com",
    });
    const result = await runPickGraph(
      new FakeLlm({ default: response }),
      state({
        signals: [signal("jane@x.com"), signal("info@x.com", { source: "mailto" })],
        people: [{ full_name: "Jane Roe", title: "Founder" }],
      }),
    );
    expect(result.pick.emails.map((e) => e.email)).toEqual(["jane@x.com"]);
    expect(result.pick.emails[0]?.person_name).toBe("Jane Roe");
    expect(result.pick.best_send_to).toBeNull();
    expect(result.pick.ungrounded).toContain("invented@x.com");
  });

  it("unknown person names are nulled and recorded, not trusted", async () => {
    const response = JSON.stringify({
      emails: [{ email: "info@x.com", classification: "person", person_name: "Dr. Fake" }],
      best_send_to: "info@x.com",
    });
    const result = await runPickGraph(
      new FakeLlm({ default: response }),
      state({ signals: [signal("info@x.com"), signal("x@gmail.com", { onDomain: false })] }),
    );
    expect(result.pick.emails[0]?.person_name).toBeNull();
    expect(result.pick.best_send_to).toBe("info@x.com");
    expect(result.pick.ungrounded_names).toEqual(["Dr. Fake"]);
  });

  it("parse failure is recorded not raised", async () => {
    const result = await runPickGraph(
      new FakeLlm({ default: "I refuse to answer in JSON." }),
      state({ signals: [signal("a@x.com"), signal("b@x.com")] }),
    );
    expect(result.parse_error).toBe("no JSON object in response");
    expect(result.pick.emails).toEqual([]);
  });

  it("classify route stores the stage envelope and free routes do not", async () => {
    const llm = new FakeLlm({ default: '{"emails": [], "best_send_to": null}' });
    const classified = await runPickGraph(
      llm,
      state({ signals: [signal("a@x.com"), signal("b@x.com")] }),
    );
    expect(Object.keys(classified.llm ?? {}).sort()).toEqual([
      "api",
      "call",
      "parse_error",
      "provider_rejected",
      "raw_text",
    ]);
    expect(classified.llm?.call?.provider).toBe("fake");
    const free = await runPickGraph(llm, state({ signals: [signal("hello@x.com")] }));
    expect(free.llm).toBeNull();
  });

  it("the classify step traces the call it pays for", async () => {
    const tracer = new RecordingTracer();
    const llm = new FakeLlm({ default: '{"emails": [], "best_send_to": null}' });
    await runPickGraph(llm, state({ signals: [signal("a@x.com"), signal("b@x.com")] }), { tracer });
    expect(tracer.spans).toHaveLength(1);
    const span = tracer.spans[0];
    expect(span?.name).toBe("email_pick");
    expect(span?.metadata).toEqual({ company: "X Studio", domain: "x.com" });
    expect(span?.outcome).not.toBeNull();
    expect(span?.error).toBeNull();
    await runPickGraph(llm, state({ signals: [signal("hello@x.com")] }), { tracer });
    expect(tracer.spans).toHaveLength(1);
  });
});

describe("parsePick", () => {
  it("tolerates code fences", () => {
    expect(typeof parsePick('```json\n{"emails": [], "best_send_to": null}\n```')).not.toBe(
      "string",
    );
  });
});

describe("buildPickPrompt", () => {
  it("carries signals, people and caps volume", () => {
    const prompt = buildPickPrompt(
      state({
        signals: Array.from({ length: 60 }, (_, i) => signal(`user${i}@x.com`)),
        people: [{ full_name: "Jane Roe", title: "Founder" }],
      }),
    );
    expect(prompt).toContain("Jane Roe (Founder)");
    expect(prompt).toContain("user0@x.com");
    expect(prompt).toContain("user39@x.com");
    expect(prompt).not.toContain("user40@x.com");
  });

  it("cap keeps strongest evidence first", () => {
    const prompt = buildPickPrompt(
      state({
        signals: [
          ...Array.from({ length: 50 }, (_, i) =>
            signal(`noise${i}@other.com`, { onDomain: false }),
          ),
          signal("jane@x.com", { source: "mailto" }),
        ],
      }),
    );
    expect(prompt).toContain("jane@x.com");
    expect(prompt).not.toContain("noise49@other.com");
  });
});

describe("byRules", () => {
  it("names a known person by pattern, keeps role and outside addresses apart, best is the named person", () => {
    const pick = byRules(
      state({
        signals: [
          signal("info@x.com"),
          signal("jroe@x.com"),
          signal("pat@x.com"),
          signal("billing@vendor.com", { onDomain: false }),
        ],
        people: [{ full_name: "Jane Roe", title: "Owner", first_name: "Jane", last_name: "Roe" }],
      }),
    );
    expect(pick.method).toBe("rules");
    expect(pick.emails.map((e) => [e.email, e.classification, e.person_name])).toEqual([
      ["info@x.com", "role", null],
      ["jroe@x.com", "person", "Jane Roe"],
      ["pat@x.com", "person", null],
      ["billing@vendor.com", "other_company", null],
    ]);
    expect(pick.emails[1]?.page_url).toBe("https://x.com/contact");
    expect(pick.best_send_to).toBe("jroe@x.com");
  });

  it("two people one pattern fits names nobody", () => {
    const pick = byRules(
      state({
        signals: [signal("jane@x.com"), signal("info@x.com")],
        people: [
          { full_name: "Jane Roe", title: null, first_name: "Jane", last_name: "Roe" },
          { full_name: "Jane Poe", title: null, first_name: "Jane", last_name: "Poe" },
        ],
      }),
    );
    expect(pick.emails[0]?.person_name).toBeNull();
  });

  it("runs in place of the model when there is none", async () => {
    const result = await runPickGraph(
      null,
      state({ signals: [signal("a@x.com"), signal("info@x.com")] }),
    );
    expect(result.llm).toBeNull();
    expect(result.pick.method).toBe("rules");
    expect(result.pick.best_send_to).toBe("a@x.com");
  });
});
