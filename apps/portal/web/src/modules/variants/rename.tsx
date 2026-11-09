/** A name changed in place (WA-1234): Rename opens a field; Enter or leaving it saves, Esc drops. */
import { Button, Input } from "@wren/ui";
import { type ReactNode, useEffect, useRef, useState } from "react";

export function Rename({
  value,
  label,
  max,
  blank = false,
  save,
  children,
}: {
  value: string;
  /** what is renamed, e.g. "subject": button "Rename subject", field "Subject name" */
  label: string;
  max: number;
  /** a blank name clears it (a sample's); else blank is no change */
  blank?: boolean;
  save: (to: string) => Promise<unknown>;
  children: (shown: string) => ReactNode;
}) {
  const [shown, setShown] = useState(value);
  useEffect(() => setShown(value), [value]);
  const [draft, setDraft] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Esc unmounts the field, and its blur still fires: this says "drop"
  const drop = useRef(false);

  const done = async (text: string) => {
    setDraft(null);
    if (drop.current) return;
    const to = text.trim();
    if (to === shown || (!to && !blank)) return;
    const before = shown;
    setShown(to);
    try {
      await save(to);
      setErr(null);
    } catch (e) {
      setShown(before);
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  if (draft != null)
    return (
      <Input
        autoFocus
        aria-label={`${label[0]?.toUpperCase()}${label.slice(1)} name`}
        value={draft}
        maxLength={max}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => void done(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            drop.current = true;
            setDraft(null);
          }
        }}
      />
    );
  return (
    <>
      {children(shown)}
      <Button
        size="dense"
        tone="quiet"
        icon="edit"
        aria-label={`Rename ${label}`}
        onClick={() => {
          drop.current = false;
          setDraft(shown);
        }}
      >
        Rename
      </Button>
      {err && (
        <span role="alert" className="text-[12px] text-(--ui-bad)">
          {err}
        </span>
      )}
    </>
  );
}
