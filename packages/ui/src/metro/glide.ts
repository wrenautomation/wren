/**
 * Metro's marks for orrery's glide (port of `render` in the artifact's `mountZoom`): a station, a
 * fold tab, a person pill glide; the lines fade in under them; the hub keeps its width.
 */
import type { Marks } from "@wrenautomation/orrery";

export const METRO_MARKS: Marks = {
  select: "[data-id],[data-fold],.pill[data-tr]",
  key(n) {
    const el = n as SVGElement;
    if (el.dataset.id) return `i:${el.dataset.id}`;
    if (el.dataset.fold) return `f:${el.dataset.fold}`;
    if (el.dataset.tr && !el.classList.contains("hit")) return `p:${el.dataset.tr}`;
    return null;
  },
  fresh: ".case,.trk,.spur,.xfer,.hit,.opn",
  fixedWidth: (k) => k === "i:hub",
};
