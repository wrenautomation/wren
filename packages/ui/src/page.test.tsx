import { prerender } from "react-dom/static";
import { describe, expect, it } from "vitest";
import type { Viewer } from "./access.js";
import { type Node, PageTree, type Source, type Widget } from "./page.js";

const count = (id: string, view: string, extra: Partial<Widget<number>> = {}): Widget<number> => ({
  kind: "widget",
  id,
  title: id,
  source: { view },
  View: ({ data }) => <b>{`${id}=${data}`}</b>,
  ...extra,
});

const tree: Node = {
  kind: "group",
  title: "Funnel",
  layout: "grid",
  children: [
    count("found", "a"),
    count("twice", "a"),
    {
      kind: "group",
      layout: "stack",
      requires: { audience: "team" },
      children: [count("ours", "b")],
    },
    count("broken", "c"),
  ],
};

const team: Viewer = { team: true, demo: false };
const client: Viewer = { team: false, demo: false };

async function draw(viewer: Viewer) {
  const asked: Source[] = [];
  const load = async (s: Source) => {
    asked.push(s);
    if ("view" in s && s.view === "c") throw new Error("view c is down");
    return "view" in s && s.view === "a" ? 7 : 3;
  };
  const { prelude } = await prerender(<PageTree node={tree} viewer={viewer} load={load} />);
  return { html: await new Response(prelude).text(), asked };
}

describe("PageTree", () => {
  it("draws each widget with what its source answered, in order", async () => {
    const { html } = await draw(team);
    expect(html).toContain("Funnel");
    expect(html.indexOf("found=7")).toBeLessThan(html.indexOf("twice=7"));
    expect(html.indexOf("twice=7")).toBeLessThan(html.indexOf("ours=3"));
    expect(html).toContain("view c is down");
  });

  it("leaves out what the viewer can't see, and never reads its source", async () => {
    const { html, asked } = await draw(client);
    expect(html).not.toContain("ours=");
    expect(asked.map((s) => ("view" in s ? s.view : ""))).toEqual(["a", "c"]);
  });

  it("reads a source once however many widgets share it", async () => {
    const { asked } = await draw(team);
    expect(asked).toHaveLength(3);
  });
});
