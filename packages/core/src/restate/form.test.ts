import { describe, expect, it } from "vitest";
import { z } from "zod";
import { formOptions, NO_INPUT } from "./form.js";

const bytes = (s: string) => new TextEncoder().encode(s);
const serdeOf = (input: z.ZodType) => {
  const o = formOptions({ input });
  if (!("input" in o) || !o.input) throw new Error("no serde");
  return { ...o, input: o.input };
};

describe("formOptions", () => {
  it("NO_INPUT takes no body, null and {}", () => {
    const { input } = serdeOf(NO_INPUT);
    expect(input.deserialize(new Uint8Array())).toBeUndefined();
    expect(input.deserialize(bytes("null"))).toBeUndefined();
    expect(input.deserialize(bytes("{}"))).toEqual({});
  });

  it("keeps the JSON content type an optional input loses", () => {
    expect(serdeOf(NO_INPUT).accept).toBe("application/json");
  });

  it("a loose object passes fields it does not name, and refuses a wrong type", () => {
    const { input } = serdeOf(z.looseObject({ id: z.number() }));
    expect(input.deserialize(bytes('{"id":1,"extra":"x"}'))).toEqual({ id: 1, extra: "x" });
    expect(() => input.deserialize(bytes('{"id":"1"}'))).toThrow();
  });

  it("marks the effect and the ingress", () => {
    expect(formOptions({ effect: "sends", ingressPrivate: true })).toEqual({
      metadata: { effect: "sends" },
      ingressPrivate: true,
    });
  });
});
