/**
 * A sent comment's proof on its Engage page (designs/2026-10-14-comment-proof.md): Live, Hidden,
 * Missing or Checking. Hovering the badge shows the screenshot and when it was read; a click
 * opens the permalink. The list's Proof column is the same state as a chip.
 */
import { dateTip, type RecordExtras, Tag, type TagTone } from "@wren/ui";

type Row = Record<string, unknown>;

const LOOKS: Record<string, { label: string; tone: TagTone; className?: string }> = {
  live: { label: "Live", tone: "green" },
  hidden: { label: "Hidden", tone: "warn" },
  missing: { label: "Missing", tone: "neutral", className: "bg-(--ui-bad-tint) text-(--ui-bad)" },
  pending: { label: "Checking", tone: "neutral" },
};

const str = (v: unknown) => (typeof v === "string" && v ? v : null);

export function ProofBadge({ row }: { row: Row }) {
  const look = LOOKS[String(row.proof)];
  if (!look) return null;
  const url = str(row.proof_url) ?? str(row.url);
  const shot = str(row.proof_shot);
  const note = str(row.proof_note);
  const at = str(row.proof_at) ? new Date(String(row.proof_at)) : null;
  const tag = (
    <Tag tone={look.tone} dot className={look.className} title={note ?? undefined}>
      {look.label}
    </Tag>
  );
  return (
    <span className="group relative inline-flex items-center gap-2">
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          aria-label={`${look.label}: open the comment`}
        >
          {tag}
        </a>
      ) : (
        tag
      )}
      {at ? (
        <time
          className="text-[12px] text-(--ui-ink-2)"
          dateTime={at.toISOString()}
          {...dateTip(at)}
        >
          Checked {at.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
        </time>
      ) : null}
      {shot ? (
        <span className="absolute left-0 top-full z-50 mt-2 hidden group-hover:block group-focus-within:block w-[420px] max-w-[80vw] rounded-(--ui-radius) border border-(--ui-hair) bg-(--ui-paper) p-2 shadow-(--ui-shadow)">
          <img
            src={shot}
            alt="The comment as a signed-out reader saw it"
            className="block w-full"
          />
        </span>
      ) : null}
    </span>
  );
}

/** Engage's extras with the proof first, when the row was sent and checked. */
export const withProof =
  (extras: (detail: unknown, at: { row: Row }) => RecordExtras) =>
  (detail: unknown, at: { row: Row }): RecordExtras => {
    const base = extras(detail, at);
    if (!at.row.proof) return base;
    return {
      ...base,
      sections: [
        ["Live for strangers", <ProofBadge key="proof" row={at.row} />],
        ...(base.sections ?? []),
      ],
    };
  };
