/**
 * The History card's Drafts tab: the shape's drafts, one row each (name, state, the version it
 * started from, who, when). A draft can be opened on the Map (a read), compared with the live shape or
 * any version (the Map draws the difference), proposed, applied or dropped with a reason. Apply
 * shows what the draft changes against live first, and warns when live moved on since the draft
 * started. There is no merge: a draft that fell behind is applied as it is, or dropped.
 */
import type { DraftRow, ShapeRef } from "@wren/pipeline/history";
import {
  Alert,
  Button,
  Callout,
  FormKept,
  LoadFailed,
  Loading,
  refreshAll,
  SELECT_CLASS,
  StateMark,
  TextField,
  useEditForm,
} from "@wren/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@wren/ui/components/ui/dialog";
import { useState } from "react";
import { call } from "../api.js";
import { actionsOf, DRAFT_LOOK, dayOf, draftRef, LIVE_MOVED, liveMoved } from "./drafts.js";
import type { Version } from "./model.js";
import { messageOf, Refused } from "./Refused.js";
import { type DraftView, useDiffOf, useDrafts } from "./read.js";

/** The two sides a draft is compared on: another version (or live) and the draft. */
export interface Compare {
  a: number;
  b: ShapeRef;
}

type DiffRead = ReturnType<typeof useDiffOf>;

/** The lines of a read difference, or its failure or wait. */
export function DiffLines({ diff, what = "difference" }: { diff: DiffRead; what?: string }) {
  if (diff.error && !diff.data)
    return <LoadFailed error={diff.error} onRetry={diff.retry} what={what} />;
  if (!diff.data) return <Loading lines={3} />;
  const lines = diff.data.changes;
  return lines.length ? (
    <ul className="list-none space-y-0.5 text-(--ui-ink-2)">
      {lines.map((l) => (
        <li key={l.key}>{l.line}</li>
      ))}
    </ul>
  ) : (
    <p className="text-(--ui-ink-3)">The two are the same.</p>
  );
}

/** A write on one draft: runs, shows a refusal as the server says it, then reads everything again. */
export function useDraftWrite(at: Record<string, string>, onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const run = async (route: string, body: Record<string, unknown>): Promise<boolean> => {
    setBusy(true);
    setRefused(null);
    try {
      await call(`pipeline/${route}`, { ...at, ...body });
      void refreshAll();
      onDone();
      return true;
    } catch (err) {
      setRefused(messageOf(err));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, refused, run, clear: () => setRefused(null) };
}

/** What applying a draft changes against live, with a warning first when live moved on. */
export function ApplyDialog({
  row,
  newest,
  at,
  onClose,
  onApplied,
}: {
  row: DraftRow;
  newest: number;
  at: Record<string, string>;
  onClose: () => void;
  onApplied: () => void;
}) {
  const moved = liveMoved(row.base, newest);
  const behind = useDiffOf(at, moved ? row.base : null, moved ? newest : null);
  const against = useDiffOf(at, newest, draftRef(row.id));
  const write = useDraftWrite(at, onApplied);
  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Apply {row.name}</DialogTitle>
          <DialogDescription>
            This saves the draft as the next version of the live shape.
          </DialogDescription>
        </DialogHeader>
        {moved ? (
          <section aria-label="Live changed" className="grid gap-1.5">
            <Callout tone="warn" className="mb-0">
              {LIVE_MOVED}
            </Callout>
            <p className="text-[12.5px] text-(--ui-ink-3)">
              Version {row.base} to version {newest}:
            </p>
            <DiffLines diff={behind} />
          </section>
        ) : null}
        <section aria-label="Draft against live" className="grid gap-1.5">
          <p className="text-[12.5px] text-(--ui-ink-3)">The draft changes live like this:</p>
          <DiffLines diff={against} />
        </section>
        {write.refused ? <Refused text={write.refused} /> : null}
        <div className="flex justify-end gap-2">
          <Button tone="quiet" size="dense" onClick={onClose}>
            Cancel
          </Button>
          <Button
            tone="primary"
            size="dense"
            busy={write.busy}
            disabled={!against.data}
            onClick={() => void write.run("shapeDraftApply", { id: row.id })}
          >
            Apply
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Drops a draft; asks why first. The draft stays in "Show applied and dropped". */
export function DropDialog({
  row,
  client,
  at,
  onClose,
  onDropped,
}: {
  row: DraftRow;
  client: string;
  at: Record<string, string>;
  onClose: () => void;
  onDropped: () => void;
}) {
  const form = useEditForm({ key: `map:drop:${client}:${row.id}`, defaults: { reason: "" } });
  const send = form.onSend(
    async (v) => {
      await call("pipeline/shapeDraftDrop", { ...at, id: row.id, reason: v.reason.trim() });
      void refreshAll();
      onDropped();
    },
    { clear: true },
  );
  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Drop {row.name}</DialogTitle>
          <DialogDescription>The draft closes for good. Say why.</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-3" onSubmit={(e) => void send(e)}>
          <TextField
            form={form}
            name="reason"
            autoFocus
            maxLength={200}
            aria-label="Why drop it"
            placeholder="Why drop it"
          />
          <FormKept form={form} />
          {form.error ? <Alert className="mb-0">{form.error}</Alert> : null}
          <div className="flex justify-end gap-2">
            <Button tone="quiet" size="dense" onClick={onClose}>
              Cancel
            </Button>
            <Button
              tone="primary"
              size="dense"
              type="submit"
              busy={form.formState.isSubmitting}
              disabled={!form.watch("reason").trim()}
            >
              Drop draft
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** One draft: its facts, the ways to act on it, and (while compared) the difference. */
function DraftItem({
  row,
  client,
  at,
  canEdit,
  versions,
  newest,
  compare,
  diff,
  onCompare,
  onOpen,
  onChanged,
}: {
  row: DraftRow;
  client: string;
  at: Record<string, string>;
  canEdit: boolean;
  versions: readonly Version[];
  newest: number;
  compare: Compare | null;
  diff: DiffRead;
  onCompare: (c: Compare | null) => void;
  onOpen: (id: string) => void;
  onChanged: () => void;
}) {
  const can = actionsOf(row.state);
  const [apply, setApply] = useState(false);
  const [drop, setDrop] = useState(false);
  const propose = useDraftWrite(at, onChanged);
  const mine = compare?.b === draftRef(row.id) ? compare : null;
  const facts = [
    `from version ${row.base}`,
    row.createdBy,
    `updated ${dayOf(row.updatedAt)}`,
    row.appliedVersion != null ? `now version ${row.appliedVersion}` : "",
  ].filter(Boolean);
  return (
    <li
      aria-label={`Draft ${row.name}`}
      className="grid gap-1.5 border-b border-(--ui-hair) py-2.5"
    >
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1 font-semibold">{row.name}</span>
        <StateMark state={DRAFT_LOOK[row.state]} />
      </div>
      <p className="text-[12.5px] text-(--ui-ink-3)">{facts.join(" · ")}</p>
      {row.note ? <p className="text-(--ui-ink-2)">{row.note}</p> : null}
      {row.dropReason ? <p className="text-(--ui-ink-2)">Dropped: {row.dropReason}</p> : null}
      <div className="flex flex-wrap gap-1">
        <Button
          tone="quiet"
          size="dense"
          aria-label={`Open ${row.name}`}
          onClick={() => onOpen(row.id)}
        >
          Open
        </Button>
        <Button
          tone="quiet"
          size="dense"
          aria-label={`Compare ${row.name}`}
          aria-pressed={!!mine}
          onClick={() => onCompare(mine ? null : { a: newest, b: draftRef(row.id) })}
        >
          Compare
        </Button>
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
            tone="quiet"
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
      </div>
      {propose.refused ? <Refused text={propose.refused} /> : null}
      {mine ? (
        <section aria-label={`Compare ${row.name} with live`} className="grid gap-1.5">
          <label className="flex items-center gap-2 text-[12.5px] text-(--ui-ink-3)">
            Compare with
            <select
              aria-label={`Compare ${row.name} with`}
              className={`${SELECT_CLASS} !w-auto`}
              value={mine.a}
              onChange={(e) => onCompare({ a: Number(e.target.value), b: mine.b })}
            >
              {versions.map((v) => (
                <option key={v.number} value={v.number}>
                  {v.number === newest ? `Live (version ${v.number})` : `Version ${v.number}`}
                </option>
              ))}
            </select>
          </label>
          <DiffLines diff={diff} />
        </section>
      ) : null}
      {apply ? (
        <ApplyDialog
          row={row}
          newest={newest}
          at={at}
          onClose={() => setApply(false)}
          onApplied={() => {
            setApply(false);
            onChanged();
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
            onChanged();
          }}
        />
      ) : null}
    </li>
  );
}

export function DraftsPanel({
  rows,
  at,
  client,
  canEdit,
  versions,
  newest,
  compare,
  diff,
  onCompare,
  onOpen,
  onChanged,
}: {
  /** The open drafts, read by History (its tab counts them). */
  rows: ReturnType<typeof useDrafts>;
  at: Record<string, string>;
  client: string;
  canEdit: boolean;
  versions: readonly Version[];
  newest: number;
  compare: Compare | null;
  diff: DiffRead;
  onCompare: (c: Compare | null) => void;
  onOpen: (id: string) => void;
  /** A draft changed (proposed, applied, dropped): read the Map and the lists again. */
  onChanged: () => void;
}) {
  const [all, setAll] = useState(false);
  const closed = useDrafts(at, "all" satisfies DraftView, all);
  const read = all ? closed : rows;
  return (
    <section aria-label="Drafts">
      {read.error && !read.data ? (
        <LoadFailed error={read.error} onRetry={read.retry} what="drafts" />
      ) : !read.data ? (
        <Loading lines={3} />
      ) : read.data.length ? (
        <ul className="list-none">
          {read.data.map((r) => (
            <DraftItem
              key={r.id}
              row={r}
              client={client}
              at={at}
              canEdit={canEdit}
              versions={versions}
              newest={newest}
              compare={compare}
              diff={diff}
              onCompare={onCompare}
              onOpen={onOpen}
              onChanged={onChanged}
            />
          ))}
        </ul>
      ) : (
        <p className="py-2 text-(--ui-ink-3)">No open drafts.</p>
      )}
      <Button tone="quiet" size="dense" aria-pressed={all} onClick={() => setAll((a) => !a)}>
        Show applied and dropped
      </Button>
    </section>
  );
}
