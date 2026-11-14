/**
 * The business map in Explorer (designs/2026-11-12-explorer.md D4, "Map"): a part drawn as the Map
 * draws its focus (its sub-line), its fields as text, and a link to its focus page on the Map.
 */
import { segments, type Whole } from "@wren/core/paths";
import { LoadFailed, type TagTone } from "@wren/ui";
import { MetroMap, type MetroPart, type MetroPick, MetroSkeleton } from "@wren/ui/metro";
import { useMemo } from "react";
import { navigate } from "../route.js";
import { focusHref, focusOf } from "./focus.js";
import { windowOf } from "./model.js";
import { useMap } from "./read.js";
import { viewOf } from "./view.js";

/** The map's row marks: a planned part, a failure exit. */
export const METRO_MARKS: Record<string, { label: string; tone?: TagTone }> = {
  planned: { label: "Planned" },
  failure: { label: "Failure", tone: "bad" },
};

/** What fills the map's root: a map starts on Map. */
export const metroFills = (route: string) =>
  route === "metro" ? (
    <>
      Start the business map on <a href="/">Map</a>.
    </>
  ) : undefined;

/** The Map part a home path names; null: the Map itself. */
function partOf(w: Whole): MetroPart | null {
  const s = segments(w.path);
  const last = (s.at(-1) ?? "").replace(/^station:/, "");
  // a flow's station opens its flow: the Map has no address for it alone
  if (s[1] === "flows" && s[2]) return { kind: "flow", id: s[2] };
  if (w.kind === "station") return { kind: "station", id: last };
  if (w.kind === "group") return { kind: "group", id: last };
  if (w.kind === "metro-line") return { kind: "line", id: last };
  return null;
}

/** said already (the sub: kind, action, tier, offer; the crumbs: line), or a token index (colour) */
const SAID = /^(kind|action|line|tier|offer|colour): /;

/** One part as the Map's focus draws it, from the Map's own read; a click goes on to the Map. */
function PartMap({ part, client }: { part: MetroPart | null; client: string }) {
  const read = useMap(client, windowOf(null));
  const data = read.data?.map ?? null;
  const metro = data?.metro ?? null;
  const focus = useMemo(() => (metro && part ? focusOf(metro, [part]) : null), [metro, part]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `data` is the read this moment belongs to
  const now = useMemo(() => new Date(), [data]);
  const view = useMemo(
    () => (data && metro ? viewOf(metro, data, data.people, now) : null),
    [data, metro, now],
  );
  const open = (p: MetroPart | null) => navigate(focusHref(p, new URLSearchParams()));
  const onPick = (p: MetroPick) => {
    if (p.kind === "station") open({ kind: "station", id: p.id });
  };
  if (read.error && !read.data)
    return <LoadFailed error={read.error} onRetry={read.retry} what="map" />;
  if (!read.data) return <MetroSkeleton className="h-[260px]" />;
  // a part the newest shape lost: the text and the link still say what it was
  if (!view || (part && !focus)) return null;
  return (
    <MetroMap
      view={view}
      focus={focus?.parts ?? null}
      onStub={open}
      onPick={onPick}
      controls={false}
      intro={false}
      bare
      fullScreen
      className="metro-peek"
    />
  );
}

export function MetroPreview({ w, client }: { w: Whole; client: string }) {
  const part = useMemo(() => partOf(w), [w]);
  const text =
    w.path === "metro"
      ? w.body
      : w.body
          ?.split("\n")
          .filter((l) => !SAID.test(l))
          .join("\n");
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <PartMap part={part} client={client} />
      {text ? (
        <p className="m-0 max-w-[72ch] text-[14px]/[1.6] whitespace-pre-wrap text-(--ui-ink-2) wrap-anywhere">
          {text}
        </p>
      ) : null}
      <a href={focusHref(part, new URLSearchParams())} className="self-start">
        {part ? "Open on the Map" : "Open the Map"}
      </a>
    </div>
  );
}
