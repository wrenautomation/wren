/** What Wren's lists add beside their title: a client's add form, this month's AI spend. */
import type { RecordsStat } from "@wren/core/records/serve";
import { Button } from "@wren/ui";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@wren/ui/components/ui/dialog";
import { Input } from "@wren/ui/components/ui/input";
import { type FormEvent, useId, useState } from "react";
import { call } from "../../api.js";
import { useCall } from "../../load.js";

/** The short name a client's name suggests: "Acme & Co." is "acme_co". */
export const idOf = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^[^a-z]+/, "")
    .slice(0, 40)
    .replace(/_+$/, "");

export function AddClient({ reload }: { reload: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  // Null follows the name until it's typed over.
  const [typed, setTyped] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameId = useId();
  const keyId = useId();
  const key = typed ?? idOf(name);
  const add = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await call("console/addClient", { id: key, name: name.trim() });
      setOpen(false);
      setName("");
      setTyped(null);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button tone="secondary" size="dense" onClick={() => setOpen(true)}>
        Add client
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form onSubmit={(e) => void add(e)} className="grid gap-4 text-sm">
            <DialogHeader>
              <DialogTitle>Add a client</DialogTitle>
            </DialogHeader>
            <div className="grid gap-1.5">
              <label htmlFor={nameId}>Name</label>
              <Input
                id={nameId}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={200}
              />
            </div>
            <div className="grid gap-1.5">
              <label htmlFor={keyId}>Short name</label>
              <Input
                id={keyId}
                value={key}
                onChange={(e) => setTyped(e.target.value)}
                required
                pattern="[a-z][a-z0-9_]{0,39}"
              />
              <p className="text-(--ui-ink-2)">
                Lowercase letters, numbers and underscores. It can't change later.
              </p>
            </div>
            {error ? <p className="text-(--ui-bad)">{error}</p> : null}
            <DialogFooter>
              <Button tone="quiet" size="dense" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button size="dense" type="submit" disabled={busy}>
                Add client
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
export const AI_SPEND = "account=~AI+models";

/** Model calls cost money: this month's AI spend beside them, a link to its lines. */
export function AiSpend() {
  const stat = useCall("ai-spend", () =>
    call<RecordsStat>("console/recordsStats", {
      record: "books.spend",
      view: "all",
      where: { account: { contains: "AI models" } },
      period: "month",
      sum: "amount",
      zone: ZONE,
    }),
  );
  const s = stat.data;
  if (!s?.currency) return null;
  const amount = s.value.toLocaleString("en-US", { style: "currency", currency: s.currency });
  return (
    <a
      href={`/money/spend?view=this_month&${AI_SPEND}`}
      className="mr-2 text-[13px] text-(--ui-ink-2) hover:text-(--ui-ink)"
    >
      AI spend this month: <span className="font-medium text-(--ui-ink)">{amount}</span>
    </a>
  );
}
