import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button } from "./controls.js";

describe("Button", () => {
  it("is turned off while busy, so Enter can't press it again, and stays solid", () => {
    const html = renderToStaticMarkup(<Button busy>Approve</Button>);
    expect(html).toMatch(/\sdisabled(=""|\s|>)/);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("disabled:opacity-100");
  });

  it("is on when not busy and not disabled", () => {
    const html = renderToStaticMarkup(<Button>Approve</Button>);
    expect(html).not.toMatch(/\sdisabled(=""|\s|>)/);
    expect(html).not.toContain("aria-busy");
  });
});
