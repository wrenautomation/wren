/**
 * One frame for every product's card in the agent chat (Weaver, Vireo): the product, the name, a
 * meta line with the link to its page, the body, the agent's next asks.
 */
import type { ReactNode } from "react";
import { Button, Tag } from "./controls.js";
import { Icon } from "./icons.js";

/** an agent's next ask; `why` rides as the tip */
export interface NextAsk {
  ask: string;
  why?: string | undefined;
}

export type OnAsk = ((text: string) => void) | undefined;

const CARD =
  "ui-rise grid w-full max-w-[44rem] min-w-0 gap-3 rounded-[12px] bg-(--ui-paper) p-3.5 shadow-[inset_0_0_0_1px_var(--ui-hair)]";
export const CARD_SMALL = "text-[12px]/[1.45] text-(--ui-ink-3)";

export interface ProductCardProps {
  /** the product: "Weaver", "Vireo" */
  product: string;
  /** the card's label for a screen reader: "Weaver run", "Vireo batch" */
  what: string;
  name?: ReactNode;
  meta?: ReactNode;
  /** its page, and the link's words: "Open in Research" */
  href?: string | undefined;
  open?: string | undefined;
  /** a tag at the head's right: "Reading", "To mark" */
  status?: ReactNode;
  asks?: readonly NextAsk[] | undefined;
  onAsk?: OnAsk;
  children?: ReactNode;
}

export function ProductCard({
  product,
  what,
  name,
  meta,
  href,
  open,
  status,
  asks,
  onAsk,
  children,
}: ProductCardProps) {
  const label = typeof name === "string" ? `${what}: ${name}` : what;
  return (
    <article aria-label={label} className={CARD}>
      {name != null ? (
        <header className="flex min-w-0 items-start gap-3">
          <div className="grid min-w-0 flex-1 gap-0.5">
            <span className="text-[12px] font-semibold text-(--ui-ink-3)">{product}</span>
            <span className="text-[14.5px]/[1.35] font-semibold text-(--ui-ink) wrap-anywhere">
              {name}
            </span>
            <span className={`${CARD_SMALL} flex flex-wrap items-center gap-x-3`}>
              {meta}
              {href ? (
                <a
                  href={href}
                  className="inline-flex items-center gap-1 font-semibold text-(--ui-link) no-underline hover:underline"
                >
                  {open ?? "Open"}
                  <Icon name="arrow" size={13} />
                </a>
              ) : null}
            </span>
          </div>
          {status}
        </header>
      ) : null}
      {children}
      {asks?.length && onAsk ? (
        <div className="flex flex-wrap gap-2">
          {asks.map((a) => (
            <Button
              key={a.ask}
              tone="quiet"
              size="dense"
              title={a.why}
              onClick={() => onAsk(a.ask)}
            >
              {a.ask}
            </Button>
          ))}
        </div>
      ) : null}
    </article>
  );
}

/** the head's busy tag */
export const BusyTag = ({ children }: { children: ReactNode }) => (
  <Tag tone="accent" busy>
    {children}
  </Tag>
);
