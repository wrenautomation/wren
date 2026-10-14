/**
 * The Shop's art, as the main bundle holds it: a band in the row's stage hue, sized before its
 * drawing loads, so nothing shifts. The scenes and the vendor marks load on their own chunk
 * (`./art/`), only when the Shop shows.
 */
import { tintOf } from "@wren/core/records";
import { tintColor } from "@wren/ui";
import { type CSSProperties, lazy, Suspense } from "react";

const Drawn = lazy(() => import("./art/index.js"));
const Mark = lazy(() => import("@wren/ui/vendor-marks").then((m) => ({ default: m.VendorMark })));

const HEIGHT = { card: "h-[116px]", hero: "h-[150px] sm:h-[200px]" } as const;

/** A row's art: its band, then its scene once loaded. */
export function PartArt({ row, size }: { row: Record<string, unknown>; size: "card" | "hero" }) {
  const stage = String(row.stage ?? "");
  const hue = stage ? tintColor(tintOf(stage)) : "var(--ui-ink-3)";
  const style = {
    "--art": hue,
    background: `radial-gradient(circle, color-mix(in srgb, var(--ui-ink) 9%, transparent) 0.8px, transparent 1px) 0 0 / 12px 12px, color-mix(in srgb, ${hue} 9%, var(--ui-paper))`,
  } as CSSProperties;
  return (
    <span
      className={`relative block overflow-hidden px-4 py-2 ${HEIGHT[size]} ${size === "hero" ? "rounded-(--ui-radius-panel)" : ""}`}
      style={style}
    >
      <Suspense fallback={null}>
        <Drawn
          id={String(row.id ?? "")}
          icon={row.icon ? String(row.icon) : null}
          name={String(row.name ?? "")}
          needs={row.needs}
          size={size}
        />
      </Suspense>
    </span>
  );
}

/** A vendor's mark beside its name, loaded with the art; a blank of its size until then. */
export function LazyMark({ vendor, size = 16 }: { vendor: string; size?: number }) {
  return (
    <Suspense
      fallback={<span className="inline-block shrink-0" style={{ width: size, height: size }} />}
    >
      <Mark vendor={vendor} size={size} />
    </Suspense>
  );
}
