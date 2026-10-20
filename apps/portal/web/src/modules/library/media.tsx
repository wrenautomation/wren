/** The Library's Media: the file itself, played or shown, signed for a while. */
import type { RecordExtras } from "@wren/ui";
import type { ListPage } from "../../module.js";
import { PlayerSlot } from "../../player/index.js";

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
      // Played by the shell's player (../../player): it goes on in the corner when you leave.
      <PlayerSlot
        eager
        className={
          m.kind === "short"
            ? "aspect-[9/16] h-[560px] max-h-[70vh] max-w-full self-start border border-(--ui-hair)"
            : "aspect-video w-full max-w-[720px] border border-(--ui-hair)"
        }
        item={{
          id: `media:${m.src.split("?")[0] ?? m.src}`,
          kind: "media",
          media: "video",
          src: m.src,
          title: name || "Video",
          ...(m.kind === "short" ? { ratio: 9 / 16 } : {}),
        }}
      />
    ),
  } satisfies RecordExtras;
};
