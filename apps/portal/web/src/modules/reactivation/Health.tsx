/** The list itself: what's missing, stale or wrong before anyone is looked up. */
import {
  Alert,
  BarList,
  Loading,
  num,
  PageHeader,
  Section,
  Stat,
  StatStrip,
  Tally,
} from "@wren/ui";
import { type CrmHealth, call } from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";

export function Health({ client }: PageProps) {
  const h = useCall(`health:${client}`, () => call<CrmHealth>("health", { client }));
  return (
    <>
      <PageHeader
        title="Data health"
        lede="Your list as it came in: what's missing, stale or wrong."
      />
      {h.error && !h.data ? <Alert onRetry={h.retry}>{h.error.message}</Alert> : null}
      {h.data ? <Report d={h.data} /> : h.error ? null : <Loading lines={8} />}
    </>
  );
}

function Report({ d }: { d: CrmHealth }) {
  const share = (n: number) => (d.rows ? `${Math.round((n / d.rows) * 100)}%` : "");
  const contacted: [string, number][] = [
    ["Under 6 months", d.lastContacted.under6mo],
    ["6 to 12 months", d.lastContacted.from6to12mo],
    ["1 to 2 years", d.lastContacted.from1to2y],
    ["Over 2 years", d.lastContacted.over2y],
    ["Never", d.lastContacted.never],
  ];
  const verified: [string, number][] = [
    ["Works", d.verification.valid],
    ["Bounces", d.verification.invalid],
    ["Risky", d.verification.risky],
    ["Can't tell (catch-all)", d.verification.catch_all],
    ["Not checked", d.verification.unchecked],
  ];
  return (
    <>
      <StatStrip>
        <Stat
          label="Rows in the export"
          value={num(d.rows)}
          note={`${num(d.people)} people, ${num(d.companies)} companies`}
        />
        <Stat label="Duplicate rows" value={num(d.duplicateRows)} note={share(d.duplicateRows)} />
        <Stat label="No email" value={num(d.emails.missing)} note={share(d.emails.missing)} />
        <Stat label="No title" value={num(d.noTitle)} note={share(d.noTitle)} />
      </StatStrip>

      <div className="rx-split">
        <Section title="Last contact">
          <BarList rows={contacted} total={d.rows} />
          {d.rows ? (
            <p className="rx-foot">
              {share(d.lastContacted.from1to2y + d.lastContacted.over2y + d.lastContacted.never)}{" "}
              haven't heard from you in over a year.
            </p>
          ) : null}
        </Section>
        <Section title="Emails">
          <BarList rows={verified} total={verified.reduce((a, [, n]) => a + n, 0)} />
          <div className="rx-gap">
            <Tally
              rows={[
                ["Not a valid address", d.emails.badSyntax],
                ["Personal (Gmail and the like)", d.emails.freemail],
                ["A team inbox (info@, hr@)", d.emails.role],
                ["Same address on several rows", d.emails.shared],
              ]}
            />
          </div>
          {d.gate.deadShare !== null ? (
            <p className="rx-foot">
              {Math.round(d.gate.deadShare * 100)}% of the addresses we checked are dead.
            </p>
          ) : null}
        </Section>
      </div>

      <Section title="Owners">
        <Tally rows={d.owners.map((o) => [o.owner, o.rows])} />
        {d.importErrors ? (
          <p className="rx-foot">{num(d.importErrors)} rows couldn't be read.</p>
        ) : null}
      </Section>
    </>
  );
}
