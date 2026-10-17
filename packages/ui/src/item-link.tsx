/** A touch's item link and the words for a touch with none: shared by every place a touch shows. */
import { cn } from "cn";
import { ExternalLink } from "lucide-react";
import { tipProps } from "./hint.js";

/** True for a link out of the app: it opens in a new tab; a page of this app opens in place. */
export const away = (href: string) => !href.startsWith("/");

/** The line's own source: an icon link that opens beside. */
export function SourceLink({ href, className }: { href: string; className?: string }) {
  return (
    <a
      href={href}
      aria-label="Open its source"
      {...tipProps("Open its source")}
      {...(away(href) ? { target: "_blank", rel: "noreferrer" } : {})}
      className={cn(
        "grid size-7 shrink-0 place-items-center rounded-(--ui-radius) text-(--ui-ink-3) hover:bg-(--ui-fill) hover:text-(--ui-ink)",
        className,
      )}
    >
      <ExternalLink className="size-3.5" />
    </a>
  );
}

/** A line that should open its item and cannot: says so, then offers the place it sits. */
export function NoLink({
  note,
  context,
  className,
}: {
  note: string;
  context?: string | null | undefined;
  className?: string;
}) {
  return (
    <p className={cn("m-0 text-[12px] text-(--ui-ink-3)", className)}>
      {note}
      {context ? (
        <>
          {" · "}
          <a
            href={context}
            {...(away(context) ? { target: "_blank", rel: "noreferrer" } : {})}
            className="text-(--ui-ink-2) underline decoration-(--ui-hair) underline-offset-2 hover:decoration-current"
          >
            Where it sits
          </a>
        </>
      ) : null}
    </p>
  );
}
