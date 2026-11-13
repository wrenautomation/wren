/**
 * The business map in Explorer (designs/2026-11-12-explorer.md D4, "Map"): a part's fields as
 * text and a link to its focus page on the Map.
 */
import { segments, type Whole } from "@wren/core/paths";
import type { TagTone } from "@wren/ui";
import type { MetroPart } from "@wren/ui/metro";
import { focusHref } from "./focus.js";

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

export function MetroPreview({ w }: { w: Whole }) {
  const part = partOf(w);
  const text =
    w.path === "metro"
      ? w.body
      : w.body
          ?.split("\n")
          .filter((l) => !SAID.test(l))
          .join("\n");
  return (
    <div className="flex max-w-[72ch] flex-col gap-4">
      {text ? (
        <p className="m-0 text-[14px]/[1.6] whitespace-pre-wrap text-(--ui-ink-2) wrap-anywhere">
          {text}
        </p>
      ) : null}
      <a href={focusHref(part, new URLSearchParams())} className="self-start">
        {part ? "Open on the Map" : "Open the Map"}
      </a>
    </div>
  );
}
