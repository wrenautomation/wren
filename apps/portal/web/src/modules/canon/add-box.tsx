/**
 * The Add box on Canon › Library (designs/2026-11-12-canon-references.md D4): a link or a
 * picture or PDF, plus his note, whole. The ask waits in a queue; `wren source drain` files it.
 * A row says Filing… until then, Filed with a link after, or why it failed with Retry.
 */
import type { AddRow } from "@wren/research/canon-console";
import {
  Button,
  DictateField,
  FormKept,
  Icon,
  messageOf,
  Tag,
  TextAreaField,
  TextField,
  useEditForm,
} from "@wren/ui";
import { useId, useRef, useState } from "react";
import { call, uploadMedia } from "../../api.js";
import { useCall } from "../../load.js";
import { href } from "../../route.js";
import { dayLabel, ERROR, QUIET } from "../work/bits.js";

const ACCEPT = "image/jpeg,image/png,image/gif,image/webp,application/pdf";
const WAITING = new Set<AddRow["state"]>(["pending", "claimed"]);

export function AddBox({ here, params }: { here: string; params: URLSearchParams }) {
  // the drain tells topic `canon-adds` after each ask
  const adds = useCall("canon-adds", () => call<{ rows: AddRow[] }>("canon/adds", {}), {
    live: "canon-adds",
  });
  const rows = adds.data?.rows ?? [];
  const { retry } = adds;

  const [file, setFile] = useState<File | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const noteId = useId();
  const listId = useId();
  const form = useEditForm({ key: "canon:add", defaults: { link: "", note: "" } });
  const busy = form.formState.isSubmitting;
  const send = form.onSend(
    async (v) => {
      const link = v.link.trim();
      if (!file && !link) throw new Error("Paste a link, or pick a picture or PDF.");
      const what = file
        ? await uploadMedia(file, file.name, (meta) => call("canon/upload", meta))
        : link;
      await call("canon/add", { what, fileName: file?.name ?? null, note: v.note.trim() || null });
      setFile(null);
      retry();
    },
    { clear: true },
  );

  return (
    <section aria-label="Add a source" className="grid gap-4 border-b border-(--ui-hair) pb-6">
      <form className="grid gap-2" onSubmit={(e) => void send(e)}>
        <FormKept form={form} />
        <div className="flex flex-wrap items-end gap-2">
          {file ? (
            <p className="m-0 flex min-h-[38px] min-w-0 flex-1 basis-60 items-center gap-2 text-[14px]">
              <Icon name="doc" size={16} />
              <span className="min-w-0 break-all">{file.name}</span>
              <Button size="dense" tone="quiet" onClick={() => setFile(null)}>
                Remove
              </Button>
            </p>
          ) : (
            <TextField
              form={form}
              name="link"
              label="Add to Canon"
              type="url"
              inputMode="url"
              placeholder="Paste a link: a reel, a video, a page, a repo"
              className="min-w-0 flex-1 basis-60"
            />
          )}
          <label className="inline-flex h-[38px] cursor-pointer items-center gap-1.5 rounded-(--ui-radius) border border-(--ui-hair) px-3 text-[13px] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-(--ui-accent)">
            <Icon name="attach" size={14} />
            {file ? "Another file" : "Picture or PDF"}
            <input
              type="file"
              accept={ACCEPT}
              className="sr-only"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        {/* Not a <label> around it: a click on the mic inside one would focus the box instead. */}
        <div className="grid gap-1">
          <label htmlFor={noteId} className="text-[13px] text-(--ui-ink-2)">
            Your note (kept whole)
          </label>
          <DictateField target={box} label="Dictate your note">
            <TextAreaField
              form={form}
              name="note"
              ref={box}
              id={noteId}
              rows={2}
              maxLength={20_000}
              placeholder="What's good about it, what to steal"
            />
          </DictateField>
        </div>
        {form.error && (
          <p role="alert" className={`m-0 ${ERROR}`}>
            {form.error}
          </p>
        )}
        <div>
          <Button type="submit" tone="primary" disabled={busy}>
            {busy ? (file ? "Uploading…" : "Adding…") : "Add"}
          </Button>
        </div>
      </form>
      {rows.length > 0 && (
        <div className="grid gap-1">
          <h2 id={listId} className="m-0 text-[13px] font-medium text-(--ui-ink-2)">
            Recent adds
          </h2>
          <ul aria-labelledby={listId} className="m-0 list-none divide-y divide-(--ui-hair) p-0">
            {rows.map((r) => (
              <AddLine key={r.id} r={r} here={here} params={params} done={retry} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function AddLine({
  r,
  here,
  params,
  done,
}: {
  r: AddRow;
  here: string;
  params: URLSearchParams;
  done: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const first = r.records[0];
  return (
    <li className="grid grid-cols-[4.75rem_minmax(0,1fr)] items-baseline gap-x-3 py-2.5 text-[13.5px]">
      <span>
        {WAITING.has(r.state) ? (
          <Tag busy>Filing</Tag>
        ) : r.state === "done" ? (
          <Tag tone="green">Filed</Tag>
        ) : (
          <Tag tone="bad">Failed</Tag>
        )}
      </span>
      <div className="grid min-w-0 gap-0.5">
        <span className="[overflow-wrap:anywhere]">{r.fileName ?? r.what}</span>
        {r.state === "failed" && r.error && <p className={`m-0 ${ERROR}`}>{r.error}</p>}
        <span className="flex flex-wrap items-center gap-x-3 text-[12.5px]">
          <span className={QUIET}>{dayLabel(r.at)}</span>
          {r.state === "done" && first && <a href={href(here, { r: first }, params)}>Open</a>}
          {r.state === "failed" && (
            <Button
              size="dense"
              tone="quiet"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await call("canon/retry", { id: r.id });
                  done();
                } catch (err) {
                  setError(messageOf(err));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Retry
            </Button>
          )}
        </span>
        {error && (
          <p role="alert" className={`m-0 ${ERROR}`}>
            {error}
          </p>
        )}
      </div>
    </li>
  );
}
