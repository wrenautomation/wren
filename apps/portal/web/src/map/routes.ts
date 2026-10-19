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
