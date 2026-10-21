import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Sweep, sweepPath } from "./sweep.js";

describe("sweepPath", () => {
  it("runs along the top and down the right side for the top right tip", () => {
    expect(sweepPath({ corner: "tr", width: 170, height: 58 })).toBe(
      "M0 1H145A24 24 0 0 1 169 25V58",
    );
  });

  it("runs the other way for the bottom left tip", () => {
    expect(sweepPath({ corner: "bl", width: 120, height: 44 })).toBe(
      "M120 43H25A24 24 0 0 1 1 19V0",
    );
  });

  it("pulls the arc in by the inset", () => {
    expect(sweepPath({ corner: "tr", width: 120, height: 46, inset: 5 })).toContain("A19 19");
  });
});

describe("Sweep", () => {
  it("draws two tips on a panel and four on an open band", () => {
    expect(renderToStaticMarkup(<Sweep />).match(/<svg/g)).toHaveLength(2);
    const band = renderToStaticMarkup(<Sweep band open />);
    expect(band.match(/<svg/g)).toHaveLength(4);
    expect(band).toContain("data-open");
  });

  it("is hidden from the page and reads the accent token", () => {
    const html = renderToStaticMarkup(<Sweep />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("var(--ui-active)");
  });

  it("gives every sweep its own gradient ids", () => {
    const html = renderToStaticMarkup(
      <>
        <Sweep />
        <Sweep />
      </>,
    );
    const ids = [...html.matchAll(/<linearGradient id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
