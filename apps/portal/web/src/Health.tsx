/** The list itself: what's missing, stale or wrong before anyone is looked up. */
import { type CrmHealth, call } from "./api.js";
import { Failed, num, Stat, useCall } from "./ui.js";

export function Health({ client }: { client: string }) {
  const h = useCall(`health:${client}`, () => call<CrmHealth>("health", { client }));
  if (h.error && !h.data) return <Failed error={h.error} />;
  if (!h.data) return <div className="loading">Loading…</div>;
  const d = h.data;
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
    <div className="page">
      <section className="stats">
        <Stat
          value={num(d.rows)}
          label="Rows in the export"
          note={`${num(d.people)} people, ${num(d.companies)} companies`}
        />
        <Stat value={num(d.duplicateRows)} label="Duplicate rows" note={share(d.duplicateRows)} />
        <Stat value={num(d.emails.missing)} label="No email" note={share(d.emails.missing)} />
        <Stat value={num(d.noTitle)} label="No title" note={share(d.noTitle)} />
      </section>

      <div className="split">
        <section>
          <h2>Last contact</h2>
          <Bars rows={contacted} total={d.rows} />
          {d.gate.deadShare !== null ? (
            <p className="quiet small">
              {Math.round(d.gate.deadShare * 100)}% not contacted in over a year. {d.gate.reason}
            </p>
          ) : null}
        </section>
        <section>
          <h2>Emails</h2>
          <Bars rows={verified} total={verified.reduce((a, [, n]) => a + n, 0)} />
          <table className="plain">
            <tbody>
              <tr>
                <td>Not a valid address</td>
                <td className="num">{num(d.emails.badSyntax)}</td>
              </tr>
              <tr>
                <td>Personal (Gmail and the like)</td>
                <td className="num">{num(d.emails.freemail)}</td>
              </tr>
              <tr>
                <td>A team inbox (info@, hr@)</td>
                <td className="num">{num(d.emails.role)}</td>
              </tr>
              <tr>
                <td>Same address on several rows</td>
                <td className="num">{num(d.emails.shared)}</td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>

      <section>
        <h2>Owners</h2>
        <table className="plain">
          <tbody>
            {d.owners.map((o) => (
              <tr key={o.owner}>
                <td>{o.owner}</td>
                <td className="num">{num(o.rows)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {d.importErrors ? (
          <p className="quiet small">{num(d.importErrors)} rows couldn't be read.</p>
        ) : null}
      </section>
    </div>
  );
}

function Bars({ rows, total }: { rows: [string, number][]; total: number }) {
  return (
    <div className="bars">
      {rows.map(([label, n]) => (
        <div className="bar-row" key={label}>
          <span className="bar-label">{label}</span>
          <span className="bar-track">
            <span className="bar-fill" style={{ width: `${total ? (n / total) * 100 : 0}%` }} />
          </span>
          <span className="num">{num(n)}</span>
        </div>
      ))}
    </div>
  );
}
