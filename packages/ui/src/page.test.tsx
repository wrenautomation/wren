import { prerender } from "react-dom/static";
import { describe, expect, it } from "vitest";
import type { Viewer } from "./access.js";
import { inputOf } from "./action.js";
import { type Action, type Node, PageTree, type Source, type Widget } from "./page.js";

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

const PAUSE: Action = {
  id: "pause",
  label: "Pause",
  handler: "email/pause",
  ask: { field: "reason", label: "Why?" },
};
const STOP: Action = {
  id: "stop",
  label: "Stop",
  handler: "console/setLoop",
  requires: { audience: "team" },
};
const rows: Widget<string[]> = {
  kind: "widget",
  id: "inboxes",
  title: "Inboxes",
  source: { view: "send_health" },
  View: ({ data, act }) => (
    <ul>
      {data.map((sender) => (
        <li key={sender}>
          {sender} {act(PAUSE, { target: sender })} {act(STOP, { key: sender })}
        </li>
      ))}
    </ul>
  ),
};

async function drawRows(viewer: Viewer, call?: () => Promise<unknown>) {
  const load = async () => ["a@x.test"];
  const { prelude } = await prerender(
    <PageTree node={rows} viewer={viewer} load={load} {...(call ? { call } : {})} />,
  );
  return new Response(prelude).text();
}

describe("act", () => {
  it("draws a View's buttons when the page can call, each only for who may", async () => {
    const call = async () => null;
    const html = await drawRows(team, call);
    expect(html).toContain(">Pause<");
    expect(html).toContain(">Stop<");
    expect(await drawRows(client, call)).not.toContain(">Stop<");
    expect(await drawRows(team)).not.toContain(">Pause<");
  });

  it("sends the asked text only when it changed", () => {
    const APPROVE: Action = { ...PAUSE, ask: { field: "body", label: "Reply" } };
    expect(inputOf(PAUSE, { target: "a@x.test" }, "  bounced  ")).toEqual({
      target: "a@x.test",
      reason: "bounced",
    });
    expect(inputOf(PAUSE, { target: "a@x.test" }, " ")).toEqual({ target: "a@x.test" });
    expect(inputOf(APPROVE, { id: 4, body: "Tuesday works." }, "Tuesday works.\n")).toEqual({
      id: 4,
    });
    expect(inputOf(APPROVE, { id: 4, body: "Tuesday works." }, "Wednesday?")).toEqual({
      id: 4,
      body: "Wednesday?",
    });
    expect(inputOf(STOP, { key: "k" }, "")).toEqual({ key: "k" });
  });
});
