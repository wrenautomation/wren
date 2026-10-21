/**
 * Where a Map node opens: the app that manages it, one table (designs/2026-10-19-business-map.md,
 * "Map page"). A source opens Marketing for its channel, Engage for an outbound DM source, Ads for
 * ads; a step and an offer open the Journeys list at that node; an offer also opens Offers; a plan
 * opens the money (Payments in a client's workspace, Deals at Wren). `routes.test.ts` checks each
 * target is a real page of a real app.
 */
import type { ShapeNode } from "@wren/pipeline/model";
import { href } from "../route.js";

/** One page to open. `node` adds the node's id as the page's `?node=` filter. */
export interface Target {
  label: string;
  app: string;
  page: string;
  node?: true;
  /** A param to add: the platform a source posts on. */
  channel?: true;
}

/** Wren's team sees its own apps; a client's person, the client's. */
export type Place = "wren" | "client";

/** The channels whose people are reached by a direct message. */
const DM_CHANNELS = ["dm", "linkedin", "instagram", "x", "facebook", "reddit"];

/** Every target the table can give, by what a node is. The first of each list is the default. */
export const ROUTES = {
  ads: {
    wren: [{ label: "Ads", app: "ads", page: "sets" }],
    client: [{ label: "Ads", app: "marketing", page: "ads" }],
  },
  dm: {
    wren: [{ label: "Engage", app: "engage", page: "dms" }],
    client: [{ label: "Marketing", app: "marketing", page: "content", channel: true }],
  },
  source: {
    wren: [{ label: "Marketing", app: "content", page: "content", channel: true }],
    client: [{ label: "Marketing", app: "marketing", page: "content", channel: true }],
  },
  step: {
    wren: [{ label: "Journeys", app: "pipelines", page: "journeys", node: true }],
    client: [{ label: "Journeys", app: "pipelines", page: "journeys", node: true }],
  },
  offer: {
    wren: [
      { label: "Journeys", app: "pipelines", page: "journeys", node: true },
      { label: "Offers", app: "offers", page: "all" },
    ],
    client: [{ label: "Journeys", app: "pipelines", page: "journeys", node: true }],
  },
  plan: {
    wren: [{ label: "Deals", app: "pipelines", page: "deals" }],
    client: [{ label: "Payments", app: "payments", page: "links" }],
  },
} as const satisfies Record<string, Record<Place, readonly Target[]>>;

/** Which table row a node reads from. */
export function rowOf(n: Pick<ShapeNode, "kind"> & { via?: string; channel?: string }) {
  if (n.kind === "source") {
    if (n.via === "ads") return "ads";
    if (n.via === "outbound" && DM_CHANNELS.includes(n.channel ?? "")) return "dm";
    return "source";
  }
  return n.kind;
}

/** A target as a link: the node's filter, the channel, and the client when it isn't Wren's. */
export function linkOf(
  t: Target,
  n: { id: string; channel?: string },
  client: string | null,
): string {
  return href(`/${t.app}/${t.page}`, {
    // The Journeys list reads a bare id as "has these words" (`nodeLegacy`).
    node: t.node ? n.id : null,
    view: t.node ? "all" : null,
    platform: t.channel ? (n.channel ?? null) : null,
    client,
  });
}

/** What a node opens, default first, as links with their labels. */
export function opensOf(
  n: { id: string; kind: ShapeNode["kind"]; via?: string; channel?: string },
  place: Place,
  client: string | null,
): { label: string; href: string }[] {
  return ROUTES[rowOf(n)][place].map((t) => ({ label: t.label, href: linkOf(t, n, client) }));
}

/** What `appsOnShape` reads of a node. A parked source opens nothing, so it names no app. */
export type NodeRef = Pick<ShapeNode, "id" | "name" | "kind"> & {
  via?: string;
  channel?: string;
  parked?: true | undefined;
};

/**
 * The apps the live nodes open, each with the nodes that open it, in node order. It reads the one
 * table above, so an app's place on the shape never has a second source. A parked node is not live.
 */
export function appsOnShape(
  nodes: readonly NodeRef[],
  place: Place,
): Map<string, { id: string; name: string }[]> {
  const out = new Map<string, { id: string; name: string }[]>();
  for (const n of nodes) {
    if (n.parked) continue;
    for (const t of ROUTES[rowOf(n)][place]) {
      const list = out.get(t.app) ?? [];
      if (!list.some((x) => x.id === n.id)) list.push({ id: n.id, name: n.name });
      out.set(t.app, list);
    }
  }
  return out;
}

/**
 * Admin → Systems: the apps a viewer may open in two groups. "On your shape" holds each app a live
 * node opens, with those nodes. "Not on the shape" holds the rest. A parked app is in neither.
 */
export function systemsOf<A extends { id: string; parked?: true | undefined }>(
  apps: readonly A[],
  nodes: readonly NodeRef[],
  place: Place,
): { onShape: { app: A; nodes: { id: string; name: string }[] }[]; rest: A[] } {
  const on = appsOnShape(nodes, place);
  const shown = apps.filter((m) => !m.parked);
  return {
    onShape: shown.flatMap((app) => {
      const held = on.get(app.id);
      return held ? [{ app, nodes: held }] : [];
    }),
    rest: shown.filter((m) => !on.has(m.id)),
  };
}

/** A station on the Map: the Map's home, with the node open. */
export const mapNodeHref = (nodeId: string, client: string | null): string =>
  href("/", { node: nodeId, client });

/** The node a Map address names (`?node=`), or none. The Map opens it, as a click would. */
export const nodeOfParams = (params: URLSearchParams): string | null => params.get("node") || null;
