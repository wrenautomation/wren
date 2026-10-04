/** What a person's record adds under its fields: where they are now, why they rank, how we looked. */
import { VERDICTS } from "@wren/core/records";
import { month, num, type RecordExtras, StateMark } from "@wren/ui";
import type { ReactNode } from "react";
import type { PersonRow, PersonView } from "../../api.js";
import type { ListPage } from "../../module.js";
import { cardOf } from "./bits.js";
import { LineWork } from "./Run.js";

type PersonDetail = Pick<PersonRow, "reasons" | "now" | "hiring" | "email" | "oldEmail"> &
  Pick<PersonView, "sources" | "crm">;

const roleAt = (title: string | null, company: string | null) =>
  [title, company].filter(Boolean).join(" at ");

/** Where they work now, as the lookup read it. */
function whereNow(now: PersonRow["now"]): string | null {
  if (!now) return null;
  if (now.kind === "left") return `Left${now.from ? ` ${now.from}` : ""}, no current role found`;
  const role = roleAt(now.title, now.company);
  if (now.kind === "job_change")
    return `${role || "A new company"}${now.from ? `, from ${now.from}` : ""}`;
  return role || null;
}

/** An address beside its verdict. */
function address(e: PersonRow["email"]): ReactNode {
  const v = e?.verdict ? VERDICTS[e.verdict] : undefined;
  if (!e) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3">
      <span className="break-all">{e.address}</span>
      {v ? <StateMark state={v} /> : null}
    </span>
  );
}

const nameOf = (c: unknown) =>
  c && typeof c === "object" && "name" in c ? String(c.name) : typeof c === "string" ? c : "";

export const personExtras: NonNullable<ListPage["extras"]> = (detail, { client, team, row }) => {
  const d = detail as PersonDetail;
  const placed = d.crm.find((c) => c.lastPlacementOn)?.lastPlacementOn;
  const where = whereNow(d.now);
  const facts: [string, ReactNode][] = [];
  if (d.email) facts.push(["Email", address(d.email)]);
  if (where) facts.push(["Where now", where]);
  if (d.oldEmail) facts.push(["Old email", address(d.oldEmail)]);
  facts.push(["Company hiring", d.hiring ? `${num(d.hiring.count)} open roles` : "Nothing found"]);
  if (placed) facts.push(["Last placement", month(placed)]);
  if (d.reasons.length) facts.push(["Why this score", d.reasons.map((r) => r.reason).join(" · ")]);
  const name = nameOf(row.name);
  const firm = nameOf(row.company);
  return {
    facts,
    sections: [
      [
        "How we looked",
        <div key="work" className="grid gap-8">
          <LineWork
            line={{ step: "lookup", subject: name }}
            client={client}
            team={team}
            more={false}
          />
          {firm ? (
            <LineWork
              line={{ step: "signals", subject: firm }}
              client={client}
              team={team}
              more={false}
            />
          ) : null}
        </div>,
      ],
    ],
    sources: d.sources.map(cardOf),
  } satisfies RecordExtras;
};

/** The old People page's `?filter=moved` lands on everyone, filtered by where they are now. */
export const personLegacy: NonNullable<ListPage["legacy"]> = (params) => {
  const f = params.get("filter");
  return f === null ? null : { filter: null, view: "all", now: f === "all" ? null : f };
};
