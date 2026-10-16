/**
 * A template's numbers in the Library: each version's sends, replies and bookings, each variant
 * point's options by reply rate, and the campaigns that sent it (`templates.template` detail).
 */
import type { TemplateDetail } from "@wren/core/templates/edits";
import { BarsChart, type BarsRow, DataTable, type TableColumn, Tag } from "@wren/ui";
import { QUIET } from "../work/bits.js";
import { replyRate } from "./sequence.js";

const when = (at: string | null) => (at ? new Date(at).toLocaleDateString("en-CA") : "");

function Versions({ d }: { d: TemplateDetail }) {
  type V = TemplateDetail["versions"][number];
  const columns: TableColumn<V>[] = [
    {
      key: "version",
      label: "Version",
      cell: (v) => (
        <>
          <span className="tabular-nums">v{v.number}</span>{" "}
          {v.state === "kept" ? null : (
            <Tag tone={v.state === "live" ? "green" : "accent"}>
              {v.state === "live" ? "Live" : v.state === "waiting" ? "Waiting" : "Draft"}
            </Tag>
          )}
        </>
      ),
    },
    {
      key: "saved",
      label: "Saved",
      cell: (v) => <span className={QUIET}>{[when(v.at), v.by].filter(Boolean).join(", ")}</span>,
    },
    { key: "sent", label: "Sent", end: true, cell: (v) => v.sends.toLocaleString() },
    {
      key: "replied",
      label: "Replied",
      end: true,
      cell: (v) => (v.sends ? `${v.replies} · ${replyRate(v.replies, v.sends)}` : "—"),
    },
    ...(d.kind === "email"
      ? [{ key: "booked", label: "Booked", end: true, cell: (v: V) => v.booked ?? "—" }]
      : []),
  ];
  return <DataTable columns={columns} data={d.versions} rowKey={(v) => String(v.number)} />;
}

/** Each variant point's options by reply rate on the live version. */
function Variants({ d }: { d: TemplateDetail }) {
  return (
    <div className="grid gap-6">
      {d.variants.map((p) => {
        const rows: BarsRow[] = p.options.map((o, i) => ({
          label: o.text || `Option ${i + 1}`,
          value: o.sends ? o.replies / o.sends : 0,
          note: o.sends ? `${o.replies} of ${o.sends}` : "not sent",
          tone: `chart-${(i % 5) + 1}`,
        }));
        return (
          <div key={p.name} className="grid gap-2">
            <span className={`text-[13px] ${QUIET}`}>[[#{p.name}]] replied, live version</span>
            <BarsChart
              rows={rows}
              label={`Variant ${p.name}`}
              format={(n) => `${Math.round(n * 1000) / 10}%`}
            />
          </div>
        );
      })}
    </div>
  );
}

/** The numbers, or what's said while nothing has sent. */
export function Numbers({ d }: { d: TemplateDetail }) {
  if (!d.versions.some((v) => v.sends) && !d.campaigns.length)
    return <p className={`text-[14px] ${QUIET}`}>Nothing has sent with it yet.</p>;
  return (
    <div className="grid gap-8">
      <Versions d={d} />
      {d.variants.length ? <Variants d={d} /> : null}
      {d.campaigns.length ? (
        <ul className="grid gap-1 text-[14px]">
          {d.campaigns.map((c) => (
            <li key={`${c.campaign}:${c.sequence}`}>
              {c.campaign}
              {c.sequence ? `, ${c.sequence}` : ""}{" "}
              <span className={QUIET}>
                · {c.sends.toLocaleString()} sent{c.lastSent ? `, last ${when(c.lastSent)}` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
