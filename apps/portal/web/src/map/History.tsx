/**
 * The Map's History, a card over the canvas, in two tabs. Versions: the shape's versions newest
 * first (number, note, author, date, its tags, the draft it came from, its commit in the git
 * mirror). Pick two and the Map draws the difference, with the list of changes under them; each
 * line has an Undo that saves the undo as a new version. "Restore" on an older version shows what
 * it would change, then saves a new version with that version's body (the old versions stay;
 * history only grows). "Tag" names a version for good. Drafts: `DraftList.tsx`.
 */
import { Button, cx, Icon, LoadFailed, Loading, Tag } from "@wren/ui";
import { useState } from "react";
import { call } from "../api.js";
import { type Compare, DraftsPanel } from "./DraftList.js";
import { dayOf, fromDraft, type HistoryTab, newestOf, refLabel, shortSha } from "./drafts.js";
import type { Version } from "./model.js";
import { OVER_RIGHT } from "./overlay.js";
import { messageOf, Refused } from "./Refused.js";
import { useDiffOf, useDrafts } from "./read.js";
import { TagForm } from "./TagForm.js";
import { UndoLine } from "./Undo.js";

/** The note a restore carries. */
export const restoreNote = (n: number) => `Restore v${n}`;

/** What restoring version `n` would change, and the button that does it. */
function Restore({
  n,
  newest,
  at,
  onSaved,
  onCancel,
}: {
  n: number;
  newest: number;
  at: Record<string, string>;
  /** The newest version was saved: read the Map again. */
  onSaved: () => void;
  onCancel: () => void;
}) {
  // Newest to `n`: the changes the restore makes.
  const diff = useDiffOf(at, newest, n);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  // The server copies version `n`; no shape travels.
  const save = async () => {
    setBusy(true);
    setRefused(null);
    try {
      await call("pipeline/shapeVersion", { ...at, from: n, note: restoreNote(n) });
      onSaved();
    } catch (err) {
      setRefused(messageOf(err));
    } finally {
      setBusy(false);
    }
  };
  const lines = diff.data?.changes.map((c) => c.line) ?? [];
  return (
    <section
      aria-label={`Restore version ${n}`}
      className="grid gap-2 rounded-(--ui-radius) bg-(--ui-wash) p-3"
    >
      <h3 className="text-[13px] font-semibold text-(--ui-ink)">Restore version {n}</h3>
      {diff.error && !diff.data ? (
        <LoadFailed error={diff.error} onRetry={diff.retry} what="difference" />
      ) : !diff.data ? (
        <Loading lines={3} />
      ) : lines.length ? (
        <>
          <p className="text-[12.5px] text-(--ui-ink-2)">
            This saves a new version with the shape as it was. It changes:
          </p>
          <ul className="list-none space-y-0.5 text-(--ui-ink-2)">
            {lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-(--ui-ink-3)">
          Version {n} is the same as the newest. Nothing to restore.
        </p>
      )}
      {refused ? <Refused text={refused} /> : null}
      <div className="flex gap-2">
        <Button
          tone="primary"
          size="dense"
          busy={busy}
          disabled={!diff.data || lines.length === 0}
          onClick={() => void save()}
        >
          Restore
        </Button>
        <Button tone="quiet" size="dense" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </section>
  );
}

export function History({
  versions,
  picked,
  onPick,
  tab,
  onTab,
  compare,
  onCompare,
  diff,
  at,
  client,
  canEdit,
  onOpenDraft,
  onSaved,
  onClose,
}: {
  versions: readonly Version[];
  picked: readonly number[];
  onPick: (n: number) => void;
  tab: HistoryTab;
  onTab: (tab: HistoryTab) => void;
  /** The draft being compared, when the Drafts tab compares one. */
  compare: Compare | null;
  onCompare: (c: Compare | null) => void;
  /** The difference the Map draws: the two picked versions, or the compared draft. */
  diff: ReturnType<typeof useDiffOf>;
  /** The workspace as a call's params. */
  at: Record<string, string>;
  /** The workspace's id, for the keys of unsent forms. */
  client: string;
  /** The viewer may save a version: Restore, Tag, Undo and the draft actions show. */
  canEdit: boolean;
  onOpenDraft: (id: string) => void;
  onSaved: () => void;
  onClose: () => void;
}) {
  const sorted = [...versions].sort((x, y) => y.number - x.number);
  const newest = newestOf(versions);
  const [restoring, setRestoring] = useState<number | null>(null);
  const [tagging, setTagging] = useState<number | null>(null);
  const drafts = useDrafts(at, "open");
  const open = drafts.data?.length ?? 0;
  return (
    <section aria-label="History" className={cx(OVER_RIGHT, "text-[14px] text-(--ui-ink)")}>
      <header className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-[17px]/6 font-semibold">History</h2>
          <p className="text-[13px] text-(--ui-ink-3)">
            {tab === "versions"
              ? "Pick two versions to see what changed."
              : "Drafts wait here until someone applies them."}
          </p>
        </div>
        <Button tone="quiet" size="dense" icon="close" onClick={onClose}>
          Close
        </Button>
      </header>
      <fieldset aria-label="History view" className="m-0 flex gap-1 border-0 p-0">
        <Button
          tone="quiet"
          size="dense"
          aria-pressed={tab === "versions"}
          onClick={() => onTab("versions")}
        >
          Versions
        </Button>
        <Button
          tone="quiet"
          size="dense"
          aria-pressed={tab === "drafts"}
          onClick={() => onTab("drafts")}
        >
          {open ? `Drafts (${open})` : "Drafts"}
        </Button>
      </fieldset>
      {tab === "drafts" ? (
        <DraftsPanel
          rows={drafts}
          at={at}
          client={client}
          canEdit={canEdit}
          versions={sorted}
          newest={newest}
          compare={compare}
          diff={diff}
          onCompare={onCompare}
          onOpen={onOpenDraft}
          onChanged={() => onCompare(null)}
        />
      ) : (
        <>
          <ul className="list-none">
            {sorted.map((v) => {
              const on = picked.includes(v.number);
              const sha = shortSha(v.mirror);
              const from = fromDraft(v);
              return (
                <li key={v.number}>
                  <div className="flex items-start">
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => onPick(v.number)}
                      className={cx(
                        "flex min-h-11 min-w-0 flex-1 cursor-pointer items-start gap-2 border-0 bg-transparent px-1 py-1.5 text-left text-(--ui-ink) hover:bg-(--ui-hover)",
                        on && "bg-(--ui-tile)",
                      )}
                    >
                      <Icon
                        name={on ? "check" : "stack"}
                        size={15}
                        className="mt-0.5 text-(--ui-ink-2)"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold">Version {v.number}</span>
                        <span className="block wrap-anywhere whitespace-normal text-(--ui-ink-2)">
                          {v.note || "No note"}
                        </span>
                        <span className="block text-[12.5px] text-(--ui-ink-3)">
                          {[v.by, dayOf(v.at)].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                    </button>
                    {canEdit ? (
                      <Button
                        tone="quiet"
                        size="dense"
                        aria-label={`Tag version ${v.number}`}
                        aria-pressed={tagging === v.number}
                        onClick={() => setTagging(tagging === v.number ? null : v.number)}
                      >
                        Tag
                      </Button>
                    ) : null}
                    {canEdit && v.number !== newest ? (
                      <Button
                        tone="quiet"
                        size="dense"
                        aria-label={`Restore version ${v.number}`}
                        aria-pressed={restoring === v.number}
                        onClick={() => setRestoring(restoring === v.number ? null : v.number)}
                      >
                        Restore
                      </Button>
                    ) : null}
                  </div>
                  {v.tags.length || from || sha ? (
                    <div className="flex flex-wrap items-center gap-1.5 pb-1.5 pl-8 text-[12.5px] text-(--ui-ink-3)">
                      {v.tags.map((t) => (
                        <Tag
                          key={t.name}
                          tone="accent"
                          title={[t.note, `${t.by}, ${dayOf(t.at)}`].filter(Boolean).join(" · ")}
                        >
                          {t.name}
                        </Tag>
                      ))}
                      {from ? <span>{from}</span> : null}
                      {v.mirror ? (
                        <a
                          href={v.mirror.url}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Version ${v.number} commit ${sha}`}
                          className="text-(--ui-ink-2) underline [font-variant-numeric:tabular-nums]"
                        >
                          {sha}
                        </a>
                      ) : null}
                    </div>
                  ) : null}
                  {tagging === v.number ? (
                    <TagForm
                      key={v.number}
                      client={client}
                      at={at}
                      version={v.number}
                      onTagged={() => {
                        setTagging(null);
                        onSaved();
                      }}
                      onCancel={() => setTagging(null)}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
          {restoring !== null ? (
            <Restore
              key={restoring}
              n={restoring}
              newest={newest}
              at={at}
              onSaved={() => {
                setRestoring(null);
                onSaved();
              }}
              onCancel={() => setRestoring(null)}
            />
          ) : null}
          {picked.length === 2 ? (
            diff.error && !diff.data ? (
              <LoadFailed error={diff.error} onRetry={diff.retry} what="difference" />
            ) : diff.data ? (
              <Changes diff={diff.data} at={at} canEdit={canEdit} onUndone={onSaved} />
            ) : (
              <Loading lines={3} />
            )
          ) : null}
        </>
      )}
    </section>
  );
}

/** The changes between two picked versions, one line each; a line can be undone. */
function Changes({
  diff,
  at,
  canEdit,
  onUndone,
}: {
  diff: NonNullable<ReturnType<typeof useDiffOf>["data"]>;
  at: Record<string, string>;
  canEdit: boolean;
  onUndone: () => void;
}) {
  const [a, b] = [diff.a, diff.b];
  const lines = diff.changes;
  return (
    <section aria-label="Changes">
      <h3 className="mb-1.5 text-[13px] font-semibold text-(--ui-ink-2)">
        {refLabel(a)} to {refLabel(b).toLowerCase()}
      </h3>
      {lines.length ? (
        <ul className="list-none space-y-0.5 text-(--ui-ink-2)">
          {lines.map((l) =>
            typeof a === "number" && typeof b === "number" ? (
              <UndoLine
                key={l.key}
                at={at}
                a={a}
                b={b}
                change={l.key}
                line={l.line}
                canEdit={canEdit}
                onUndone={onUndone}
              />
            ) : (
              <li key={l.key}>{l.line}</li>
            ),
          )}
        </ul>
      ) : (
        <p className="text-(--ui-ink-3)">The two are the same.</p>
      )}
    </section>
  );
}
