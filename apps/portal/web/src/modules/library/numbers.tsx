/**
 * A template's numbers in the Library: each version's sends, replies and bookings, each variant
 * point's options by reply rate, and the campaigns that sent it (`templates.template` detail).
 */
import type { TemplateDetail } from "@wren/core/templates/edits";
import { BarsChart, type BarsRow, Tag } from "@wren/ui";
import { QUIET } from "../work/bits.js";
import { replyRate } from "./sequence.js";

const when = (at: string | null) => (at ? new Date(at).toLocaleDateString("en-CA") : "");

function Versions({ d }: { d: TemplateDetail }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[13.5px]">
        <thead className={QUIET}>
          <tr className="border-b border-(--ui-hair)">
            <th className="py-1.5 pr-3 font-normal">Version</th>
            <th className="py-1.5 pr-3 font-normal">Saved</th>
            <th className="py-1.5 pr-3 text-right font-normal">Sent</th>
            <th className="py-1.5 pr-3 text-right font-normal">Replied</th>
            {d.kind === "email" ? <th className="py-1.5 text-right font-normal">Booked</th> : null}
          </tr>
        </thead>
        <tbody>
          {d.versions.map((v) => (
            <tr key={v.number} className="border-b border-(--ui-hair) align-top">
              <td className="py-1.5 pr-3">
                <span className="tabular-nums">v{v.number}</span>{" "}
                {v.state === "kept" ? null : (
                  <Tag tone={v.state === "live" ? "green" : "accent"}>
                    {v.state === "live" ? "Live" : v.state === "waiting" ? "Waiting" : "Draft"}
                  </Tag>
                )}
              </td>
              <td className={`py-1.5 pr-3 ${QUIET}`}>
                {[when(v.at), v.by].filter(Boolean).join(", ")}
              </td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{v.sends.toLocaleString()}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums">
                {v.sends ? `${v.replies} · ${replyRate(v.replies, v.sends)}` : "—"}
              </td>
              {d.kind === "email" ? (
                <td className="py-1.5 text-right tabular-nums">{v.booked ?? "—"}</td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
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
