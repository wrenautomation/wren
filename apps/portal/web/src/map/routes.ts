/**
 * Where a Map node opens: the app that manages it, one table (designs/2026-10-19-business-map.md,
 * "Map page"). A source opens Campaigns › Content for its channel, Today › DMs for an outbound DM
 * source, Ads for ads (none while ads are cut); a step and an offer open the people at that
 * node (People, "In a journey", kept to the step); a plan opens the
 * money (Pay links in a client's workspace, Money at Wren). A content line's stations open Campaigns › Content. `routes.test.ts` checks each
 * target is a real page of a real app.
 */
import type { ShapeNode } from "@wren/pipeline/model";
import { href, type Params } from "../route.js";

/** One page to open. `node` keeps the page to the people at the node (`?stepNode==<id>`). */
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
  // Ads cut 11-04 (WA-1067): an ads node opens nothing until ads come back.
  ads: { wren: [], client: [] },
  dm: {
    wren: [{ label: "DMs", app: "today", page: "dms" }],
    client: [{ label: "Content", app: "campaigns", page: "content", channel: true }],
  },
  source: {
    wren: [{ label: "Content", app: "campaigns", page: "content", channel: true }],
    client: [{ label: "Content", app: "campaigns", page: "content", channel: true }],
  },
  step: {
    wren: [{ label: "People", app: "people", page: "people", node: true }],
    client: [{ label: "People", app: "people", page: "people", node: true }],
  },
  offer: {
    wren: [{ label: "People", app: "people", page: "people", node: true }],
    client: [{ label: "People", app: "people", page: "people", node: true }],
  },
  plan: {
    wren: [{ label: "Money", app: "office", page: "money" }],
    client: [{ label: "Payments", app: "office", page: "pay-links" }],
  },
  content: {
    wren: [{ label: "Content", app: "campaigns", page: "content" }],
    client: [{ label: "Content", app: "campaigns", page: "content" }],
  },
} as const satisfies Record<string, Record<Place, readonly Target[]>>;

/** Which table row a node reads from. */
export function rowOf(n: Pick<ShapeNode, "kind"> & { via?: string; channel?: string }) {
  if (n.kind === "job") return "content";
  if (n.kind === "source") {
    if (n.via === "found") return "content";
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
    // "=": the whole key, so `held` never lists `call_held`.
    stepNode: t.node ? `=${n.id}` : null,
    view: t.node ? "journey" : null,
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
type NodeRef = Pick<ShapeNode, "id" | "name" | "kind"> & {
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

/** A part of the Map that has a panel: a station (the hub too), a track, a line or a campaign. */
export interface PanelRef {
  kind: "station" | "track" | "line" | "campaign";
  id: string;
}

/** The address param each panel kind uses. A station keeps `?node=`, the id older links carry. */
const PANEL_PARAM = {
  station: "node",
  track: "track",
  line: "line",
  campaign: "campaign",
} as const;
const PANEL_KINDS = Object.keys(PANEL_PARAM) as PanelRef["kind"][];

/** The panel a Map address names (`?node=`, `?track=`, `?line=` or `?campaign=`), or none. */
export function panelOfParams(params: URLSearchParams): PanelRef | null {
  for (const kind of PANEL_KINDS) {
    const id = params.get(PANEL_PARAM[kind]);
    if (id) return { kind, id };
  }
  return null;
}

/** The params that name a panel; every other kind is cleared. None closes the panel. */
export const panelParams = (p: PanelRef | null): Params =>
  Object.fromEntries(PANEL_KINDS.map((k) => [PANEL_PARAM[k], p?.kind === k ? p.id : null]));

/** A track on the Map: the Map's home with the track's panel open (Today's task opens it). */
export const mapTrackHref = (trackId: string, client: string | null): string =>
  href("/", { track: trackId, client });
