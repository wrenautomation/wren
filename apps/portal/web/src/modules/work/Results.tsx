/** Results: the offer's measures so far, against what we promised (D6). */
import { PageHeader, Section, Stat, StatStrip } from "@wren/ui";
import type { EngagementView } from "../../api.js";
import type { PageProps } from "../../module.js";
import { dayLabel, Engagements, Form, field, figure, useAct, useWork } from "./bits.js";

export function Results(props: PageProps) {
  const work = useWork(props);
  const act = useAct(props, work.reload);
  return (
    <>
      <PageHeader title="Results" lede="The numbers that say whether this worked." />
      <Engagements work={work} props={props}>
        {(e) => (
          <>
            <Section title="So far" note={e.offer.promise}>
              <StatStrip>
                {e.results.map((r) => (
                  <Stat
                    key={r.key}
                    label={r.label}
                    value={figure(r)}
                    note={
                      r.at
                        ? `${r.note ? `${r.note} · ` : ""}as of ${dayLabel(r.at)}`
                        : "not measured yet"
                    }
                  />
                ))}
              </StatStrip>
            </Section>
            {props.team ? <Record e={e} props={props} act={act} /> : null}
          </>
        )}
      </Engagements>
    </>
  );
}

function Record({
  e,
  props,
  act,
}: {
  e: EngagementView;
  props: PageProps;
  act: ReturnType<typeof useAct>;
}) {
  return (
    <Section title="Record a result">
      <Form
        label="Record a result"
        submit="Save"
        act={act}
        demo={props.demo}
        onSubmit={(f) =>
          act.run("result", {
            engagementId: e.id,
            key: field(f, "key"),
            value: Number(field(f, "value")),
            note: field(f, "note"),
          })
        }
      >
        <label className="wk-field">
          <span>Measure</span>
          <select name="key">
            {e.results.map((r) => (
              <option key={r.key} value={r.key}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <label className="wk-field">
          <span>Value so far</span>
          <input name="value" type="number" required step="any" min="0" />
        </label>
        <label className="wk-field wk-grow">
          <span>Note (the client reads it)</span>
          <input name="note" maxLength={500} />
        </label>
      </Form>
    </Section>
  );
}
