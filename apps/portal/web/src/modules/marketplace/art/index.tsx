/**
 * A Shop row's art, loaded on its own chunk: the scene its id names, and the vendors it runs on
 * as their marks in the corner. `../art.tsx` holds the band it draws into.
 */
import { VendorMark, vendorName, vendorOf } from "@wren/ui/vendor-marks";
import { specOf } from "./registry.js";
import { SceneArt } from "./scenes.js";

/** The vendors a row needs, as mark keys: accounts only, never the parts it builds on. */
export const vendorsOf = (needs: unknown): string[] =>
  String(needs ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && !s.includes(".") && vendorOf(s));

export default function ComponentArt({
  id,
  icon,
  name,
  needs,
  size,
}: {
  id: string;
  icon: string | null;
  name: string;
  needs: unknown;
  size: "card" | "hero";
}) {
  const vendors = vendorsOf(needs);
  const s = size === "hero" ? 18 : 14;
  return (
    <>
      <span className="block h-full transition-transform duration-300 ease-(--ui-ease) group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100">
        <SceneArt spec={specOf(id, icon)} label={`What ${name} does`} />
      </span>
      {vendors.length ? (
        <span className="absolute right-2 bottom-2 flex items-center gap-1">
          {vendors.map((v) => (
            <span
              key={v}
              className="grid place-items-center rounded-full bg-(--ui-paper) text-(--ui-ink) shadow-(--ui-raise)"
              style={{ width: s + 10, height: s + 10 }}
            >
              <VendorMark vendor={v} size={s} label={vendorName(v)} />
            </span>
          ))}
        </span>
      ) : null}
    </>
  );
}
