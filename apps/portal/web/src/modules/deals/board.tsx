/**
 * Opportunities → Board (designs/2026-10-09-opportunities.md, "Portal"): a column per stage with
 * its count and value; a card per deal. Drag a card to move it, or pick its stage on a phone.
 * Each move is kept and told to the spine by the server.
 */
import type { Board } from "@wren/deals/console";
import type { DealRow } from "@wren/deals/records";
import type { Stage } from "@wren/deals/schema";
import { Button, cx, Input, LoadFailed, Loading, money, num, PageHeader, say } from "@wren/ui";
import { type FormEvent, useState } from "react";
import { call } from "../../api.js";
import { useCall } from "../../load.js";
import { type PageProps, WREN } from "../../module.js";
import { href } from "../../route.js";

const SELECT =
  "min-h-[34px] border border-(--ui-hair) bg-(--ui-paper) px-2 py-1 text-[13.5px] text-(--ui-ink) focus:border-(--ui-accent) focus:outline-none";

/** The body's client: none in Wren's workspace, whose deals the server keeps as Wren's. */
export const atOf = (client: string): Record<string, string> =>
  client === WREN.id ? {} : { client };

const today = () => new Date().toISOString().slice(0, 10);

const total = (rows: readonly DealRow[]) => rows.reduce((sum, d) => sum + (d.value ?? 0), 0);

export function DealBoard(props: PageProps) {
  const at = atOf(props.client);
  const [pipeline, setPipeline] = useState<string | null>(null);
  const got = useCall(`deals-board:${props.client}:${pipeline ?? ""}`, () =>
    call<Board>("deals/board", { ...at, pipeline }),
  );
  // A move shows at once; the next read replaces it.
  const [moved, setMoved] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  if (got.error && !got.data) return <LoadFailed error={got.error} onRetry={got.retry} />;
  if (!got.data) return <Loading lines={6} />;
  const b = got.data;
  const pipe = b.pipelines.find((p) => p.id === b.pipeline) ?? b.pipelines[0];
  if (!pipe) return <Loading lines={6} />;
  const rows = b.deals.map((d) => (moved[d.id] ? { ...d, stage: moved[d.id] as string } : d));
  const write = !props.demo;

  const move = async (id: string, stage: string) => {
    const was = rows.find((d) => d.id === id);
    if (!was || was.stage === stage) return;
    setMoved((m) => ({ ...m, [id]: stage }));
    try {
      await call("deals/move", { ...at, ids: [id], stage });
      got.retry();
    } catch (err) {
      setMoved((m) => {
        const { [id]: _, ...rest } = m;
        return rest;
      });
      say.failed(err);
    }
  };

  return (
    <>
      <PageHeader
        title="Board"
        lede="Drag a deal to the stage it's in now. A workflow can start on any move."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {b.pipelines.length > 1 ? (
              <select
                aria-label="Pipeline"
                className={SELECT}
                value={pipe.id}
                onChange={(e) => {
                  setMoved({});
                  setPipeline(e.target.value);
                }}
              >
                {b.pipelines.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            ) : null}
            {write ? (
              <Button size="sm" icon="board" onClick={() => setAdding((a) => !a)}>
                New deal
              </Button>
            ) : null}
          </div>
        }
      />
      {adding ? (
        <NewDeal
          at={at}
          pipeline={pipe.id}
          onDone={() => {
            setAdding(false);
            got.retry();
          }}
        />
      ) : null}
      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-4">
        {pipe.stages.map((s) => (
          <Column
            key={s.key}
            at={at}
            stage={s}
            stages={pipe.stages}
            rows={rows.filter((d) => d.stage === s.key)}
            write={write}
            move={move}
          />
        ))}
      </div>
    </>
  );
}

function Column({
  at,
  stage,
  stages,
  rows,
  write,
  move,
}: {
  at: Record<string, string>;
  stage: Stage;
  stages: readonly Stage[];
  rows: readonly DealRow[];
  write: boolean;
  move: (id: string, stage: string) => void;
}) {
  const [over, setOver] = useState(false);
  const sum = total(rows);
  return (
    <section
      aria-label={stage.label}
      className={cx(
        "grid w-[264px] shrink-0 content-start gap-2 border border-(--ui-hair) bg-(--ui-wash) p-2",
        over && "border-(--ui-accent)",
      )}
      onDragOver={(e) => {
        if (!write) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const id = e.dataTransfer.getData("text/deal");
        if (id) move(id, stage.key);
      }}
    >
      <header className="flex items-baseline justify-between gap-2 px-1">
        <h2
          className={cx(
            "m-0 text-[13.5px] font-semibold",
            stage.kind === "won" && "text-(--ui-good)",
            stage.kind === "lost" && "text-(--ui-ink-3)",
          )}
        >
          {stage.label}
          <span className="ml-1.5 font-normal text-(--ui-ink-3)">{num(rows.length)}</span>
        </h2>
        {sum ? (
          <span className="text-[12.5px] text-(--ui-ink-2)">{money(sum, "USD", true)}</span>
        ) : null}
      </header>
      {rows.map((d) => (
        <Card key={d.id} d={d} at={at} stages={stages} write={write} move={move} />
      ))}
      {rows.length ? null : (
        <p className="m-0 px-1 py-3 text-[12.5px] text-(--ui-ink-3)">
          {write ? "Drop a deal here." : "None."}
        </p>
      )}
    </section>
  );
}

function Card({
  d,
  at,
  stages,
  write,
  move,
}: {
  d: DealRow;
  at: Record<string, string>;
  stages: readonly Stage[];
  write: boolean;
  move: (id: string, stage: string) => void;
}) {
  const late = d.status === "open" && !!d.next_on && d.next_on <= today();
  return (
    <article
      draggable={write}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/deal", d.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      className={cx(
        "grid gap-1 border border-(--ui-hair) bg-(--ui-paper) p-2.5 text-[13px]",
        write && "cursor-grab active:cursor-grabbing",
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <a
          className="min-w-0 truncate font-medium text-(--ui-ink) no-underline hover:underline"
          href={href(`/deals/deals/${encodeURIComponent(d.id)}`, at)}
        >
          {d.name}
        </a>
        {d.value !== null ? (
          <span className="shrink-0 text-(--ui-ink-2)">{money(d.value, d.currency, true)}</span>
        ) : null}
      </div>
      {d.contact_name || d.contact_email ? (
        <span className="truncate text-(--ui-ink-2)">{d.contact_name ?? d.contact_email}</span>
      ) : null}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-(--ui-ink-3)">
        <span>{d.days_in_stage === 0 ? "Today" : `${d.days_in_stage}d`} in stage</span>
        {d.owner ? <span className="truncate">{d.owner}</span> : null}
        {d.next_on ? (
          <span className={cx(late && "font-medium text-(--ui-bad)")}>Follow up {d.next_on}</span>
        ) : null}
      </div>
      {write ? (
        <select
          aria-label={`Stage of ${d.name}`}
          className={cx(SELECT, "mt-1 sm:hidden")}
          value={d.stage}
          onChange={(e) => move(d.id, e.target.value)}
        >
          {stages.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
      ) : null}
    </article>
  );
}

function NewDeal({
  at,
  pipeline,
  onDone,
}: {
  at: Record<string, string>;
  pipeline: string;
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await call("deals/create", {
        ...at,
        pipeline,
        name,
        ...(value.trim() ? { value } : {}),
        ...(contact.trim()
          ? contact.includes("@")
            ? { contactEmail: contact }
            : { contactName: contact }
          : {}),
      });
      say.done("Added to the first stage.");
      onDone();
    } catch (err) {
      say.failed(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      onSubmit={submit}
      className="mb-4 flex flex-wrap items-end gap-2 border border-(--ui-hair) p-3"
    >
      <label className="grid gap-1 text-[13px]">
        Deal
        <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
      </label>
      <label className="grid w-[120px] gap-1 text-[13px]">
        Value
        <Input
          value={value}
          inputMode="decimal"
          placeholder="1200"
          onChange={(e) => setValue(e.target.value)}
        />
      </label>
      <label className="grid gap-1 text-[13px]">
        Contact
        <Input
          value={contact}
          placeholder="A name or an email"
          onChange={(e) => setContact(e.target.value)}
        />
      </label>
      <Button type="submit" size="sm" busy={busy} disabled={!name.trim()}>
        Add
      </Button>
    </form>
  );
}
