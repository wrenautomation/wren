/** What goes in: the CRM export, where research reads, how the emails sound, and the send rule. */
import { Alert, Callout, Facts, Loading, num, PageHeader, Section } from "@wren/ui";
import type { ReactNode } from "react";
import { call, type Setup as Data } from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { at } from "./nav.js";

export function Setup({ client, demo }: PageProps) {
  const s = useCall(`setup:${client}`, () => call<Data>("setup", { client }));
  return (
    <>
      <PageHeader
        title="Setup"
        lede={
          demo
            ? "What the sample firm plugged in. It's read-only on the demo."
            : "What you plugged in. Wren sets it up with you; to change anything, just ask."
        }
      />
      {s.error && !s.data ? <Alert>{s.error.message}</Alert> : null}
      {s.data ? <Plugged d={s.data} demo={demo} /> : s.error ? null : <Loading lines={10} />}
    </>
  );
}

/** "bullhorn" -> "Bullhorn"; the names people know these by. */
const NAMES: Record<string, string> = { linkedin: "LinkedIn", bullhorn: "Bullhorn", csv: "CSV" };
const named = (id: string) => NAMES[id] ?? id.charAt(0).toUpperCase() + id.slice(1);

const day = (at: string | null) =>
  at
    ? new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "";

/** A signature with its `{name}` slot shown as a slot. */
function Signature({ text }: { text: string }) {
  const parts = text.split("{name}");
  return (
    <span className="rx-sig">
      {parts.map((p, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the parts never reorder.
        <span key={i}>
          {i ? <span className="rx-slot">recruiter's name</span> : null}
          {p}
        </span>
      ))}
    </span>
  );
}

function Plugged({ d, demo }: { d: Data; demo: boolean }) {
  const crm: [string, ReactNode][] = d.crm
    ? [
        ["Export", `${named(d.crm.format)}, ${num(d.crm.rows)} rows`],
        ["Loaded", day(d.crm.importedAt)],
        ...(d.crm.asOf ? [["Taken on", day(d.crm.asOf)] as [string, ReactNode]] : []),
        ...(d.crm.imports > 1
          ? [["Exports so far", num(d.crm.imports)] as [string, ReactNode]]
          : []),
      ]
    : [["Export", "None yet"]];
  const research: [string, ReactNode][] = [
    ...d.research.map((site): [string, ReactNode] => [
      named(site),
      `A ${named(site)} research account`,
    ]),
    ["Public pages", "Company sites and job posts"],
    [
      "Every fact",
      <a key="sources" href={at("sources")}>
        Links to the page it came from
      </a>,
    ],
  ];
  const p = d.profile;
  const sending: [string, ReactNode][] = [
    [
      "Your OK",
      d.sending.approval === "first"
        ? "You approve the first batch. After that, new drafts go out on their own."
        : "You approve every batch before it goes out.",
    ],
    ["New drafts", `Up to ${num(d.sending.perDay)} a day`],
    [
      "Sending",
      d.sending.live ? "On" : demo ? "Off. The demo never sends." : "Off until you say go",
    ],
    [
      "Sends from",
      d.sending.senders.length
        ? d.sending.senders.map((s) => `${s.name} <${s.address}>`).join(", ")
        : "No mailbox yet",
    ],
  ];
  return (
    <>
      <Callout>
        <b>Nothing sends without your OK.</b> Every email waits in Emails until you approve it.
      </Callout>

      <div className="rx-split rx-gap">
        <Section title="Your CRM" note="The export your list came from.">
          <Facts items={crm} />
        </Section>
        <Section title="Research" note="Where we look people and companies up.">
          <Facts items={research} />
        </Section>
      </div>

      <Section title="How your emails sound" note="What each draft is written from.">
        {p ? (
          <Facts
            items={[
              ["What you place", p.sells],
              ["Voice", p.voice],
              ["Signature", <Signature key="sig" text={p.signature} />],
            ]}
          />
        ) : (
          <p className="rx-quiet">Not set yet. Drafts wait until it is.</p>
        )}
      </Section>

      <div className="rx-split">
        <Section
          title="Recruiters"
          note="Each email comes from the recruiter who owns the contact."
        >
          {p?.recruiters.length ? (
            <Facts items={p.recruiters.map((r): [string, ReactNode] => [r.name, r.email])} />
          ) : (
            <p className="rx-quiet">None yet.</p>
          )}
        </Section>
        <Section title="Sending">
          <Facts items={sending} />
        </Section>
      </div>
    </>
  );
}
