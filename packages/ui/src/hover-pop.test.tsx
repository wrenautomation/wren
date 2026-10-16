import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { type HoverPop, useHoverPop, useSubmenus } from "./hover-pop.js";

describe("useHoverPop", () => {
  it("starts shut, and a screen it can't tell hovers opens on tap only", () => {
    let got: HoverPop | null = null;
    function Probe() {
      got = useHoverPop();
      return null;
    }
    renderToStaticMarkup(<Probe />);
    expect(got).toMatchObject({ open: false, byHover: false, trigger: {} });
  });

  it("gives each submenu its own root, none open at first", () => {
    let roots: { open: boolean }[] = [];
    function Probe() {
      const subs = useSubmenus();
      roots = ["a", "b"].map((k) => subs.rootOf(k));
      return null;
    }
    renderToStaticMarkup(<Probe />);
    expect(roots.map((r) => r.open)).toEqual([false, false]);
  });
});
