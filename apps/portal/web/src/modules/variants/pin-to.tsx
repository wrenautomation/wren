/**
 * Pin to board (vireo board B6): a run's page or a Canon reference onto a subject's board. One
 * button for both detail views; the subject list loads on open.
 */
import { Button, Icon, POP, say } from "@wren/ui";
import { Popover, PopoverContent, PopoverTrigger } from "@wren/ui/components/ui/popover";
import { useState } from "react";
import { call } from "../../api.js";
import { useCall } from "../../load.js";

export interface PinOut {
  url: string;
  title: string | null;
  poster: string | null;
  from: { weaver: { run: string; page: string } } | { canon: string };
}

interface SubjectRow {
  id: number;
  name: string;
  state?: string;
}

const ROW =
  "flex min-h-8 w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-2 py-1.5 text-left text-[13px] wrap-anywhere text-(--ui-ink) hover:bg-(--ui-hover) focus-visible:bg-(--ui-hover) pointer-coarse:min-h-11";

/** a signed link expires: a pin keeps only a poster that lasts */
const lasting = (u: string | null) => (u && !/[?&]X-Amz-Signature=/i.test(u) ? u : null);

export function PinToBoard({ pin }: { pin: PinOut }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const subjects = useCall(open ? "variants-subjects" : null, () =>
    call<SubjectRow[]>("variants/subjects", {}),
  );
  const rows = (subjects.data ?? []).filter((s) => s.state !== "closed");
  const to = async (s: SubjectRow) => {
    setOpen(false);
    setBusy(true);
    try {
      await call("variants/pin", {
        subject: s.id,
        pins: [{ url: pin.url, title: pin.title, poster: lasting(pin.poster), from: pin.from }],
      });
      say.done(`Pinned to ${s.name}`);
    } catch (e) {
      say.failed(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button size="dense" icon="pin" busy={busy}>
            Pin to board
          </Button>
        }
      />
      <PopoverContent aria-label="Pin to which board" align="start" className={`${POP} w-64 p-1`}>
        <p className="m-0 px-2 pt-1.5 pb-1 text-[12px] font-medium text-(--ui-ink-3)">
          Pin to a subject's board
        </p>
        {subjects.error ? (
          <p className="m-0 px-2 py-1.5 text-[13px] text-(--ui-ink-2)">
            Subjects didn't load.{" "}
            <button
              type="button"
              className="cursor-pointer border-0 bg-transparent p-0 underline"
              onClick={subjects.retry}
            >
              Retry
            </button>
          </p>
        ) : !subjects.data ? (
          <p role="status" className="m-0 px-2 py-1.5 text-[13px] text-(--ui-ink-3)">
            Loading subjects
          </p>
        ) : rows.length ? (
          <div className="max-h-72 overflow-y-auto">
            {rows.map((s) => (
              <button key={s.id} type="button" className={ROW} onClick={() => void to(s)}>
                <Icon name="board" size={14} className="flex-none text-(--ui-ink-3)" />
                <span className="min-w-0 flex-1">{s.name}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="m-0 px-2 py-1.5 text-[13px] text-(--ui-ink-3)">No subjects yet.</p>
        )}
      </PopoverContent>
    </Popover>
  );
}
