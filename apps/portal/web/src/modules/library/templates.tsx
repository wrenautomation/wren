/**
 * A template's page in the Library: its draft and live words, each rendered for a made-up lead,
 * then its slots, its variants with their numbers, each version's
 * numbers and the campaigns that sent it. The words edit in place above (the record's `edits`),
 * with History, Undo and Ask Claude. Publishing sends nothing.
 */
import type { TemplateDetail } from "@wren/core/templates/edits";
import {
  BarsChart,
  type BarsRow,
  type MessageKind,
  MessagePreview,
  type RecordExtras,
  Tag,
} from "@wren/ui";
import type { ReactNode } from "react";
import type { ListPage } from "../../module.js";
import { QUIET } from "../work/bits.js";
import { CHANNEL, replyRate } from "./sequence.js";

export const RECORD = "templates.template";

type Words = NonNullable<TemplateDetail["live"]>;

/** The words with the made-up lead in them, as the reader gets them. */
function Rendered({ kind, words }: { kind: string; words: Words }) {
  if (!words.sample)
    return <p className="text-[14px] text-(--ui-bad)">It doesn't render: {words.problem}</p>;
  // A prompt reads as text; a DM's frame wants its site, which the template doesn't name.
  if (kind === "prompt" || kind === "dm")
    return (
      <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap border border-(--ui-hair) bg-(--ui-fill) p-3 text-[12.5px]">
        {words.sample.body}
      </pre>
    );
  const message: MessageKind =
    kind === "email" ? { kind: "email", subject: words.sample.subject } : { kind: "sms" };
  return <MessagePreview message={message} body={words.sample.body} />;
}

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

export const templateExtras: NonNullable<ListPage["extras"]> = (detail) => {
  const d = detail as TemplateDetail | null;
  if (!d) return {};
  const sections: [string, ReactNode][] = [];
  if (d.draft)
    sections.push([
      "Draft",
      <div key="draft" className="grid gap-4">
        <Rendered kind={d.kind} words={d.draft} />
      </div>,
    ]);
  sections.push([
    d.draft ? "Live now" : "Live",
    d.live ? (
      <Rendered key="live" kind={d.kind} words={d.live} />
    ) : (
      <p key="live" className={`text-[14px] ${QUIET}`}>
        Nothing is live, so nothing sends.
      </p>
    ),
  ]);
  if (!d.editable)
    sections.push([
      "Where it's edited",
      <p key="where" className={`text-[14px] ${QUIET}`}>
        {CHANNEL[d.kind] ?? d.kind} copy saves on its page in Marketing, which holds its rules.
      </p>,
    ]);
  if (d.slots.length)
    sections.push([
      "Slots",
      <div key="slots" className="grid gap-2">
        <span className="flex flex-wrap gap-1.5">
          {d.slots.map((s) => (
            <Tag key={s}>{`{${s}}`}</Tag>
          ))}
        </span>
        <span className={`text-[13px] ${QUIET}`}>
          The samples fill them for Sam Rivera of Northwind Staffing, a made-up lead.
        </span>
      </div>,
    ]);
  if (d.variants.length) sections.push(["Variants", <Variants key="variants" d={d} />]);
  if (d.versions.length) sections.push(["Versions", <Versions key="versions" d={d} />]);
  if (d.campaigns.length)
    sections.push([
      "Campaigns",
      <ul key="campaigns" className="grid gap-1 text-[14px]">
        {d.campaigns.map((c) => (
          <li key={`${c.campaign}:${c.sequence}`}>
            {c.campaign}
            {c.sequence ? `, ${c.sequence}` : ""}{" "}
            <span className={QUIET}>
              · {c.sends.toLocaleString()} sent{c.lastSent ? `, last ${when(c.lastSent)}` : ""}
            </span>
          </li>
        ))}
      </ul>,
    ]);
  return { sections } satisfies RecordExtras;
};
