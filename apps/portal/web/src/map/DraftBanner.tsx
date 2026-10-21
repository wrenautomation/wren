/**
 * The banner over the Map while a draft is open (`?draft=<id>`): its name, the version it started
 * from, who made it, its state, and (when live moved on) the newest version. Propose, Apply and
 * Drop act on the draft; Close goes back to the live Map. The Map under it draws the draft with the
 * marks of what it changes. The draft is a read: nothing here edits it.
 */
import type { DraftRow } from "@wren/pipeline/history";
import { Button, StateMark } from "@wren/ui";
import { useState } from "react";
import { ApplyDialog, DropDialog, useDraftWrite } from "./DraftList.js";
import { actionsOf, DRAFT_LOOK, liveMoved } from "./drafts.js";
import { Refused } from "./Refused.js";

const BANNER =
  "absolute top-3 left-1/2 z-20 flex max-w-[calc(100%-24px)] -translate-x-1/2 flex-wrap items-center gap-x-3 gap-y-2 rounded-[14px] border border-(--ui-hair) bg-(--ui-paper) px-3 py-2 text-[13.5px] text-(--ui-ink) shadow-(--ui-shadow)";

export function DraftBanner({
  row,
  newest,
  at,
  client,
  canEdit,
  onClose,
  onChanged,
}: {
  row: DraftRow;
  /** The newest live version. */
  newest: number;
  at: Record<string, string>;
  /** The workspace's id, for the keys of unsent forms. */
  client: string;
  /** The viewer may act on the shape: Propose, Apply and Drop show. */
  canEdit: boolean;
  /** Back to the live Map. */
  onClose: () => void;
  /** The draft was proposed: read it again. */
  onChanged: () => void;
}) {
  const can = actionsOf(row.state);
  const [apply, setApply] = useState(false);
  const [drop, setDrop] = useState(false);
  const propose = useDraftWrite(at, onChanged);
  return (
    <div role="status" aria-label="Open draft" className={BANNER}>
      <span className="font-semibold">{row.name}</span>
      <span className="text-(--ui-ink-2)">
        from version {row.base} · {row.createdBy}
      </span>
      <StateMark state={DRAFT_LOOK[row.state]} />
      {liveMoved(row.base, newest) ? (
        <span className="text-(--ui-ink-2)">Live moved to version {newest} since</span>
      ) : null}
      {canEdit && can.propose ? (
        <Button
          tone="quiet"
          size="dense"
          aria-label={`Propose ${row.name}`}
          busy={propose.busy}
          onClick={() => void propose.run("shapeDraftPropose", { id: row.id })}
        >
          Propose
        </Button>
      ) : null}
      {canEdit && can.apply ? (
        <Button
          tone="primary"
          size="dense"
          aria-label={`Apply ${row.name}`}
          onClick={() => setApply(true)}
        >
          Apply
        </Button>
      ) : null}
      {canEdit && can.drop ? (
        <Button
          tone="quiet"
          size="dense"
          aria-label={`Drop ${row.name}`}
          onClick={() => setDrop(true)}
        >
          Drop
        </Button>
      ) : null}
      <Button tone="quiet" size="dense" icon="close" onClick={onClose}>
        Close
      </Button>
      {propose.refused ? <Refused text={propose.refused} /> : null}
      {apply ? (
        <ApplyDialog
          row={row}
          newest={newest}
          at={at}
          onClose={() => setApply(false)}
          onApplied={() => {
            setApply(false);
            onClose();
          }}
        />
      ) : null}
      {drop ? (
        <DropDialog
          row={row}
          client={client}
          at={at}
          onClose={() => setDrop(false)}
          onDropped={() => {
            setDrop(false);
            onClose();
          }}
        />
      ) : null}
    </div>
  );
}
