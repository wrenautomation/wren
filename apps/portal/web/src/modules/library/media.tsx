/** The Library's Media: the file itself, played or shown, signed for a while. */
import type { RecordExtras } from "@wren/ui";
import type { ListPage } from "../../module.js";

interface Media {
  kind: "video" | "short" | "thumbnail";
  src: string | null;
}

export const mediaExtras: NonNullable<ListPage["extras"]> = (detail, { row }) => {
  const m = (detail as { media?: Media } | null)?.media;
  if (!m) return {};
  const name = String(row.name ?? "");
  return {
    lead: !m.src ? (
      <p className="text-[13px] text-(--ui-ink-3)">
        The media bucket isn't set up here, so the file can't show.
      </p>
    ) : m.kind === "thumbnail" ? (
      <img src={m.src} alt={name} className="w-full max-w-[640px] border border-(--ui-hair)" />
    ) : (
      // biome-ignore lint/a11y/useMediaCaption: a rendered cut has its captions burned in.
      <video
        src={m.src}
        controls
        preload="metadata"
        className={
          m.kind === "short"
            ? "max-h-[560px] w-auto max-w-full border border-(--ui-hair)"
            : "w-full max-w-[720px] border border-(--ui-hair)"
        }
      />
    ),
  } satisfies RecordExtras;
};
