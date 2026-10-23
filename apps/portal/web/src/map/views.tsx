/**
 * Saved views of the Map (designs/2026-10-23-focus-view.md, F2): a named set of parts kept in the
 * workspace's `saved_views` under record `map`, its params `parts=<parts>`. The viewer's
 * `map.home` pref names the view "/" opens on.
 */
import { MAP_VIEW_RECORD, partsOf, partsParam } from "@wren/pipeline/metro-parts";
import { type KeepApi, type SavedViewLine, useSavedViews } from "@wren/ui";
import type { MetroPart } from "@wren/ui/metro";
import { type PageProps, WREN } from "../module.js";
import { keepOf } from "../records.js";
import { focusHref } from "./focus.js";

export const MAP_HOME = "map.home";

/** Where the workspace keeps his views of its Map: Wren's team only, never on a demo. */
export const mapKeepOf = (props: PageProps): KeepApi | undefined =>
  props.team && !props.demo
    ? keepOf(props.client === WREN.id ? null : props.client, { app: "", asClient: false })
    : undefined;

/** The parts a saved view holds. */
export const viewPartsOf = (v: SavedViewLine): MetroPart[] =>
  partsOf(new URLSearchParams(v.params).get("parts"));

/** A set of parts as a saved view's params, as the server keeps them. */
export const viewParamsOf = (parts: readonly MetroPart[]) =>
  new URLSearchParams({ parts: partsParam(parts) }).toString();

/** The workspace's views of its Map, his own and the shared ones, in tab order. */
export const useMapViews = (keep: KeepApi | undefined) => useSavedViews(keep, MAP_VIEW_RECORD);

/** The Views list in the Map's tools: each saved view, the home one marked. */
export function MapViews({
  views,
  home,
  params,
}: {
  views: readonly SavedViewLine[];
  home: number | undefined;
  params: URLSearchParams;
}) {
  return (
    <section aria-label="Views" className="grid gap-1 border-t border-(--ui-hair) pt-2">
      <h2 className="px-1 text-[12px] font-semibold text-(--ui-ink-3)">Views</h2>
      {views.length ? (
        <ul className="grid list-none gap-0.5">
          {views.map((v) => (
            <li key={v.id}>
              <a
                href={focusHref({ view: v.id }, params)}
                className="flex items-center gap-2 rounded-(--ui-leaf-button) px-1.5 py-1 text-[13px] font-semibold text-(--ui-ink) no-underline hover:bg-(--ui-hover)"
              >
                <span className="min-w-0 flex-1 wrap-anywhere">{v.name}</span>
                {v.id === home ? <span className="text-[12px] text-(--ui-ink-3)">Home</span> : null}
                {v.shared ? <span className="text-[12px] text-(--ui-ink-3)">Shared</span> : null}
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-1 text-[12.5px] text-(--ui-ink-3)">
          To make one, open a line or a group, then Save view.
        </p>
      )}
    </section>
  );
}
