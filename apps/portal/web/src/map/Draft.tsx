/**
 * Editing the shape on the Map (designs/2026-10-19-business-map.md, "Map page", edit mode): the
 * draft that lives on this device until it saves, the bar over the canvas that counts it, and the
 * dialog that asks why and saves it as the next version. The draft is one edits-store entry
 * (`useEdit`), so a reload or another page gives it back; if the shape moved meanwhile, the person
 * picks theirs or the saved one. Nothing is lost when the server refuses a save.
 */

import type { ShapeBody } from "@wren/pipeline/model";
import {
  Alert,
  Button,
  cx,
  FormKept,
  Icon,
  StateMark,
  TextField,
  tipProps,
  useEdit,
  useEditForm,
} from "@wren/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@wren/ui/components/ui/dialog";
import { useEffect, useMemo, useRef, useState } from "react";
import { call } from "../api.js";
import { draftStoreKey, newestOf } from "./drafts.js";
import {
  changesOf,
  cleanMoves,
  type Draft,
  draftOf,
  type Moves,
  problemsOf,
  textOf,
} from "./edit.js";
import type { MapData } from "./model.js";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** A server draft opened for editing: what it holds now, and when it was last saved. */
export interface OpenedDraft {
  body: ShapeBody;
  moves: Moves;
  /** The draft row's `updatedAt`: a moved one means the draft changed under the device's edits. */
  version: string;
}

/**
 * The shape being edited. `draft` is the shape it starts from plus what the person changed (null
 * while nothing is read); `set` keeps it on this device. It starts from the newest shape, or, when
 * a server draft is named (`draftId`), from that draft once `opened` has read it; the device edits
 * of a draft live under their own key. A draft equal to its start is no draft.
 */
export function useShapeDraft(
  client: string,
  data: MapData | null,
  mayEdit: boolean,
  draftId: string | null = null,
  opened: OpenedDraft | null = null,
) {
  const base = draftId ? opened?.body : data?.body;
  const moves = draftId ? opened?.moves : undefined;
  const store = useEdit(
    data && mayEdit && (!draftId || opened) ? draftStoreKey(client, draftId) : null,
    base ? textOf({ body: base, moves: moves ?? {} }) : "",
    {
      version: draftId ? (opened?.version ?? null) : data ? String(newestOf(data.versions)) : null,
    },
  );
  const draft = useMemo<Draft | null>(() => {
    if (!base) return null;
    return store.dirty ? draftOf(store.value, base) : { body: base, moves: moves ?? {} };
  }, [base, moves, store.dirty, store.value]);
  const problems = useMemo(() => (draft ? problemsOf(draft.body) : []), [draft]);
  return {
    draft,
    problems,
    changes: base && draft ? changesOf(base, draft.body) : 0,
    /** Words the server does not hold: a draft exists. */
    dirty: store.dirty,
    conflict: store.conflict,
    keepMine: store.keepMine,
    takeTheirs: store.takeTheirs,
    discard: store.discard,
    /** The server holds `sent` now: the draft is spent. */
    saved: store.saved,
    /** Keeps `next` as the draft. Moves for nodes it keeps, or to nodes it lacks, are dropped. */
    set: (next: Draft) =>
      store.set(textOf({ body: next.body, moves: cleanMoves(next.body, next.moves) })),
  };
}
export type ShapeDraft = ReturnType<typeof useShapeDraft>;

/** True while Alt is held: a line dragged now is a loop line. A ref, so a drag reads it live. */
export function useAltKey() {
  const alt = useRef(false);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      alt.current = e.altKey;
    };
    const off = () => {
      alt.current = false;
    };
    globalThis.addEventListener("keydown", on);
    globalThis.addEventListener("keyup", on);
    globalThis.addEventListener("blur", off);
    return () => {
      globalThis.removeEventListener("keydown", on);
      globalThis.removeEventListener("keyup", on);
      globalThis.removeEventListener("blur", off);
    };
  }, []);
  return alt;
}

/** The bar floats over the canvas's foot; on a phone it sits at the top, since a panel takes the foot. */
const BAR =
  "absolute bottom-3 left-1/2 z-20 flex max-w-[calc(100%-24px)] -translate-x-1/2 flex-wrap items-center gap-x-3 gap-y-2 rounded-[14px] border border-(--ui-hair) bg-(--ui-paper) px-3 py-2 text-[13.5px] text-(--ui-ink) shadow-(--ui-shadow) max-[900px]:bottom-auto";
/** On a phone the bar sits at the top, under the draft banner when one is open. */
const BAR_TOP = { plain: "max-[900px]:top-3", banner: "max-[900px]:top-24" } as const;

/**
 * The edit bar: how many changes the draft holds, what `checkShape` finds wrong with it, and the
 * ways out: Save asks for a note and saves the next version; Save as draft keeps the work apart
 * from the live shape; while a server draft is open, Update draft saves into it (and Save is not
 * there: a draft goes live by Apply in History). Discard asks twice.
 */
export function DraftBar({
  changes,
  problems,
  palette,
  onPalette,
  loop,
  onLoop,
  opened,
  below,
  onSave,
  onSaveDraft,
  onUpdate,
  onDiscard,
}: {
  changes: number;
  problems: readonly string[];
  palette: boolean;
  onPalette: () => void;
  /** New lines are loop lines (for touch, where Alt is not there). */
  loop: boolean;
  onLoop: () => void;
  /** A server draft is open: Update draft shows, Save does not. */
  opened: boolean;
  /** The draft banner is over the canvas: on a phone the bar sits under it. */
  below: boolean;
  onSave: () => void;
  onSaveDraft: () => void;
  onUpdate: () => void;
  onDiscard: () => void;
}) {
  const [sure, setSure] = useState(false);
  return (
    <div
      role="toolbar"
      aria-label="Edit the shape"
      className={cx(BAR, below ? BAR_TOP.banner : BAR_TOP.plain)}
    >
      <Button tone="quiet" size="dense" aria-pressed={palette} onClick={onPalette}>
        <Icon name="plus" size={15} /> Add
      </Button>
      <Button
        tone="quiet"
        size="dense"
        aria-pressed={loop}
        onClick={onLoop}
        {...tipProps("New lines go back to an earlier node. Alt does the same while you drag.")}
      >
        <Icon name="workflow" size={15} /> Loop line
      </Button>
      <StateMark
        state={
          changes
            ? { tone: "warn", label: `Draft: ${plural(changes, "change", "changes")}` }
            : { tone: "neutral", label: "No changes" }
        }
      />
      {problems.length ? (
        <details className="relative">
          <summary className="cursor-pointer list-none">
            <StateMark
              state={{ tone: "bad", label: plural(problems.length, "problem", "problems") }}
            />
          </summary>
          <ul
            aria-label="Problems"
            className="absolute bottom-full left-0 mb-3 grid max-h-[40dvh] w-[min(420px,80vw)] list-none gap-1.5 overflow-y-auto rounded-[14px] border border-(--ui-hair) bg-(--ui-paper) p-3 text-[13px] text-(--ui-ink-2) shadow-(--ui-shadow) max-[900px]:top-full max-[900px]:bottom-auto max-[900px]:mt-3 max-[900px]:mb-0"
          >
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </details>
      ) : null}
      {sure ? (
        <>
          <span className="text-(--ui-ink-2)">
            Throw away {plural(changes, "change", "changes")}?
          </span>
          <Button
            tone="secondary"
            size="dense"
            onClick={() => {
              setSure(false);
              onDiscard();
            }}
          >
            Discard
          </Button>
          <Button tone="quiet" size="dense" onClick={() => setSure(false)}>
            Keep
          </Button>
        </>
      ) : (
        <>
          <Button tone="quiet" size="dense" disabled={changes === 0} onClick={() => setSure(true)}>
            Discard
          </Button>
          <Button tone="quiet" size="dense" disabled={changes === 0} onClick={onSaveDraft}>
            Save as draft
          </Button>
          {opened ? (
            <Button
              tone="primary"
              size="dense"
              disabled={changes === 0 || problems.length > 0}
              onClick={onUpdate}
            >
              Update draft
            </Button>
          ) : (
            <Button
              tone="primary"
              size="dense"
              disabled={changes === 0 || problems.length > 0}
              onClick={onSave}
            >
              Save
            </Button>
          )}
        </>
      )}
    </div>
  );
}

/** The shape moved while the draft waited: keep the draft, or take the saved shape. */
export function DraftConflict({
  onKeep,
  onTake,
  below,
}: {
  onKeep: () => void;
  onTake: () => void;
  /** The draft banner is over the canvas: the note sits under it. */
  below: boolean;
}) {
  return (
    <div
      role="alert"
      className={cx(
        "absolute left-1/2 z-20 grid max-w-[calc(100%-24px)] -translate-x-1/2 gap-2 rounded-[14px] border border-(--ui-hair) bg-(--ui-paper) px-4 py-3 text-[13.5px] text-(--ui-ink) shadow-(--ui-shadow)",
        below ? "top-16 max-[900px]:top-48" : "top-3 max-[900px]:top-16",
      )}
    >
      <p>The shape changed while your draft waited. Pick one.</p>
      <div className="flex gap-2">
        <Button tone="primary" size="dense" onClick={onKeep}>
          Keep my draft
        </Button>
        <Button tone="quiet" size="dense" onClick={onTake}>
          Use the saved shape
        </Button>
      </div>
    </div>
  );
}

/**
 * Asks why, then saves the draft as the next version. A refusal shows the server's sentences and
 * leaves the draft and the note as they were.
 */
export function SaveDialog({
  client,
  at,
  draft,
  changes,
  open,
  onOpenChange,
  onSaved,
}: {
  client: string;
  /** The workspace as a call's params. */
  at: Record<string, string>;
  draft: Draft;
  changes: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The version was saved; `sent` is the draft's text that went. */
  onSaved: (sent: string) => void;
}) {
  const form = useEditForm({ key: `map:note:${client}`, defaults: { note: "" } });
  const save = form.onSend(
    async (v) => {
      await call("pipeline/shapeVersion", {
        ...at,
        body: draft.body,
        note: v.note.trim(),
        moves: cleanMoves(draft.body, draft.moves),
      });
      onSaved(textOf(draft));
    },
    { clear: true },
  );
  const moved = Object.keys(cleanMoves(draft.body, draft.moves)).length;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save the shape</DialogTitle>
          <DialogDescription>
            This saves {plural(changes, "change", "changes")} as the next version.
            {moved
              ? ` People on ${plural(moved, "dropped node", "dropped nodes")} move first.`
              : ""}
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-3" onSubmit={(e) => void save(e)}>
          <TextField
            form={form}
            name="note"
            autoFocus
            maxLength={200}
            aria-label="Why it changed"
            placeholder="Why it changed"
          />
          <FormKept form={form} />
          {form.error ? <Alert className="mb-0">{form.error}</Alert> : null}
          <div className="flex justify-end gap-2">
            <Button tone="quiet" size="dense" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              tone="primary"
              size="dense"
              type="submit"
              busy={form.formState.isSubmitting}
              disabled={!form.watch("note").trim()}
            >
              Save version
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
