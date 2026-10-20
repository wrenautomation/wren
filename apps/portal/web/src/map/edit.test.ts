import { checkShape, type ShapeBody, STAGE_KEY } from "@wren/pipeline/model";
import { describe, expect, it } from "vitest";
import {
  addNode,
  changesOf,
  cleanMoves,
  connect,
  draftOf,
  idFrom,
  kindReason,
  labelEdge,
  offerBefore,
  peopleOn,
  problemsOf,
  reasonFor,
  removeEdge,
  removeNode,
  renameNode,
  serverText,
  setField,
  setKind,
  textOf,
} from "./edit.js";
import type { Person } from "./model.js";

const body: ShapeBody = {
  name: "Sample",
  nodes: [
    { id: "mail", kind: "source", name: "Spring list", via: "outbound", channel: "email" },
    { id: "engaged", kind: "step", name: "Engaged", action: "reply", advance: [] },
    { id: "signed", kind: "offer", name: "Signed", offer: "starter", advance: [] },
    { id: "standard", kind: "plan", name: "Standard plan", terms: "standard", advance: [] },
  ],
  edges: [
    { id: "mail_to_engaged", from: "mail", to: "engaged", kind: "flow" },
    { id: "engaged_to_signed", from: "engaged", to: "signed", kind: "flow" },
    { id: "signed_to_standard", from: "signed", to: "standard", kind: "flow" },
  ],
};

describe("idFrom", () => {
  it("makes a node id from a name", () => {
    expect(idFrom("Booked call", new Set())).toBe("booked_call");
    expect(idFrom("  Café & Co.  ", new Set())).toBe("cafe_co");
  });
  it("starts with a letter", () => {
    expect(idFrom("2nd call", new Set())).toBe("n_2nd_call");
    expect(idFrom("???", new Set())).toBe("node");
  });
  it("takes the next free number when the id is taken", () => {
    expect(idFrom("Step", new Set(["step"]))).toBe("step_2");
    expect(idFrom("Step", new Set(["step", "step_2"]))).toBe("step_3");
  });
  it("never gives the dropped key", () => {
    expect(idFrom("Dropped", new Set())).toBe("dropped_2");
  });
  it("stays within 40 characters, numbers too", () => {
    const long = "a".repeat(60);
    const first = idFrom(long, new Set());
    expect(first).toHaveLength(40);
    const second = idFrom(long, new Set([first]));
    expect(second).toHaveLength(40);
    expect(second.endsWith("_2")).toBe(true);
    expect(STAGE_KEY.test(second)).toBe(true);
  });
});

describe("addNode", () => {
  it("adds a node of each kind with a free id and name", () => {
    let b = body;
    for (const kind of ["source", "step", "offer", "plan"] as const) {
      const got = addNode(b, kind);
      expect(got.body.nodes).toHaveLength(b.nodes.length + 1);
      expect(got.body.nodes.at(-1)?.kind).toBe(kind);
      b = got.body;
    }
    expect(new Set(b.nodes.map((n) => n.id)).size).toBe(b.nodes.length);
    expect(new Set(b.nodes.map((n) => n.name)).size).toBe(b.nodes.length);
  });
  it("names a second step so the two differ", () => {
    const one = addNode(body, "step");
    const two = addNode(one.body, "step");
    expect(one.body.nodes.at(-1)?.name).toBe("Step");
    expect(two.body.nodes.at(-1)?.name).toBe("Step 2");
    expect(two.id).toBe("step_2");
  });
});

describe("reasonFor", () => {
  it("lets a fresh flow line through", () => {
    expect(reasonFor(body, "engaged", "standard", "flow")).toBe(
      "A plan follows exactly one offer.",
    );
    expect(reasonFor(body, "mail", "signed", "flow")).toBeNull();
  });
  it("refuses a line into a source", () => {
    expect(reasonFor(body, "engaged", "mail", "flow")).toBe("Nothing enters a source.");
    expect(reasonFor(body, "engaged", "mail", "loop")).toBe("Nothing enters a source.");
  });
  it("refuses a line from a node to itself", () => {
    expect(reasonFor(body, "engaged", "engaged", "flow")).toBe("A node cannot join itself.");
  });
  it("refuses a second line between the same two nodes in the same direction", () => {
    expect(reasonFor(body, "mail", "engaged", "loop")).toBe("These two are already joined.");
  });
  it("refuses a flow line that closes a circle, and lets a loop line through", () => {
    expect(reasonFor(body, "signed", "engaged", "flow")).toMatch(/circle/);
    expect(reasonFor(body, "signed", "engaged", "loop")).toBeNull();
  });
  it("refuses a plan that follows two offers, or a step", () => {
    const two = addNode(body, "offer");
    expect(reasonFor(two.body, two.id, "standard", "flow")).toBe(
      "A plan follows exactly one offer.",
    );
    expect(reasonFor(body, "engaged", "standard", "flow")).toBe(
      "A plan follows exactly one offer.",
    );
    const fresh = addNode(body, "plan");
    expect(reasonFor(fresh.body, "signed", fresh.id, "flow")).toBeNull();
    // A loop line into a plan is no flow edge: checkShape lets it be.
    expect(reasonFor(body, "engaged", "standard", "loop")).toBeNull();
  });
  it("lets through only lines checkShape accepts, and refuses every other", () => {
    const ctx = {
      triggers: new Set<string>(),
      group: () => ({ active: true }),
      source: () => ({ exists: true as const }),
    };
    const ids = body.nodes.map((n) => n.id);
    for (const from of ids)
      for (const to of ids)
        for (const kind of ["flow", "loop"] as const) {
          const reason = reasonFor(body, from, to, kind);
          const probe = { ...body, edges: [...body.edges, { id: "probe", from, to, kind }] };
          const errors = checkShape(probe, ctx);
          if (reason === null) expect(errors, `${from} ${kind} ${to}`).toEqual([]);
          else if (reason !== "These two are already joined.")
            expect(errors.length, `${from} ${kind} ${to}`).toBeGreaterThan(0);
        }
  });
});

describe("connect", () => {
  it("adds an edge with the default id", () => {
    const next = connect(body, "mail", "signed", "flow");
    expect(next.edges.at(-1)).toEqual({
      id: "mail_to_signed",
      from: "mail",
      to: "signed",
      kind: "flow",
    });
  });
  it("adds a loop edge", () => {
    expect(connect(body, "signed", "engaged", "loop").edges.at(-1)?.kind).toBe("loop");
  });
  it("leaves the body alone when the line is refused", () => {
    expect(connect(body, "engaged", "mail", "flow")).toBe(body);
  });
  it("gives a free id when another edge has taken the default", () => {
    const odd: ShapeBody = {
      ...body,
      edges: [...body.edges, { id: "mail_to_signed", from: "mail", to: "engaged", kind: "loop" }],
    };
    expect(connect(odd, "mail", "signed", "flow").edges.at(-1)?.id).toBe("mail_to_signed_2");
  });
});

describe("edges", () => {
  it("labels a line and takes the label off", () => {
    const one = labelEdge(body, "mail_to_engaged", "Replies");
    expect(one.edges[0]?.label).toBe("Replies");
    expect(labelEdge(one, "mail_to_engaged", "  ").edges[0]).not.toHaveProperty("label");
  });
  it("turns a flow line into a loop line, and refuses the way back when it would close a circle", () => {
    const looped = connect(body, "signed", "engaged", "loop");
    const id = looped.edges.at(-1)?.id ?? "";
    expect(kindReason(looped, id, "flow")).toMatch(/circle/);
    expect(kindReason(looped, id, "loop")).toBeNull();
    expect(kindReason(body, "engaged_to_signed", "loop")).toBeNull();
    expect(setKind(body, "engaged_to_signed", "loop").edges[1]?.kind).toBe("loop");
  });
  it("removes a line", () => {
    expect(removeEdge(body, "mail_to_engaged").edges.map((e) => e.id)).not.toContain(
      "mail_to_engaged",
    );
  });
});

describe("nodes", () => {
  it("renames without touching the id", () => {
    const got = renameNode(body, "engaged", "Replied");
    expect(got.nodes[1]).toMatchObject({ id: "engaged", name: "Replied" });
  });
  it("sets a field and takes it off when empty", () => {
    const one = setField(body, "mail", "campaign", "spring");
    expect(one.nodes[0]).toMatchObject({ campaign: "spring" });
    expect(setField(one, "mail", "campaign", "").nodes[0]).not.toHaveProperty("campaign");
    expect(setField(one, "mail", "parked", true).nodes[0]).toMatchObject({ parked: true });
  });
  it("removes a node with the lines on it", () => {
    const got = removeNode(body, "engaged");
    expect(got.nodes.map((n) => n.id)).not.toContain("engaged");
    expect(got.edges.map((e) => e.id)).toEqual(["signed_to_standard"]);
  });
  it("names the offer a plan follows", () => {
    expect(offerBefore(body, "standard")).toBe("starter");
    expect(offerBefore(body, "engaged")).toBeNull();
  });
});

describe("people and moves", () => {
  const person = (id: string, node: string): Person => ({
    id,
    name: `Person ${id}`,
    node,
    nodeName: node,
    movedAt: null,
    daysAtNode: 1,
  });
  it("counts who sits on a node", () => {
    const people = [person("1", "engaged"), person("2", "engaged"), person("3", "signed")];
    expect(peopleOn(people, "engaged")).toHaveLength(2);
    expect(peopleOn(people, "mail")).toHaveLength(0);
  });
  it("keeps only moves from a node the body lacks to a node it has", () => {
    const next = removeNode(body, "engaged");
    expect(
      cleanMoves(next, { engaged: "signed", signed: "standard", gone: "nowhere", other: "mail" }),
    ).toEqual({ engaged: "signed", other: "mail" });
  });
});

describe("the draft", () => {
  it("counts a node once however much changed on it", () => {
    let b = renameNode(body, "engaged", "Replied");
    b = setField(b, "engaged", "action", "dm");
    expect(changesOf(body, b)).toBe(1);
    expect(changesOf(body, connect(b, "mail", "signed", "flow"))).toBe(2);
    expect(changesOf(body, body)).toBe(0);
    expect(changesOf(body, removeNode(body, "engaged"))).toBe(3);
  });
  it("matches the server's text when nothing changed, whatever the key order", () => {
    const shuffled: ShapeBody = JSON.parse(
      JSON.stringify({ edges: body.edges, nodes: body.nodes, name: body.name }),
    );
    expect(textOf({ body: shuffled, moves: {} })).toBe(serverText(body));
  });
  it("round-trips through its text, and falls back to the newest body", () => {
    const d = { body: renameNode(body, "engaged", "Replied"), moves: { engaged: "signed" } };
    expect(draftOf(textOf(d), body)).toEqual(d);
    expect(draftOf("not json", body)).toEqual({ body, moves: {} });
    expect(draftOf('{"body":{"name":1}}', body)).toEqual({ body, moves: {} });
  });
  it("lists the problems once each", () => {
    expect(problemsOf(body)).toEqual([]);
    const lone = addNode(body, "step");
    expect(problemsOf(lone.body)).toEqual([
      `Node "${lone.id}" has no flow edge into it. Nothing can reach it.`,
    ]);
    const empty = addNode(body, "offer");
    expect(problemsOf(empty.body)).toContain(`Offer node "${empty.id}" names no offer.`);
  });
});
