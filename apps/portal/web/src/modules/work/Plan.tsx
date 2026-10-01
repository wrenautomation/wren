/** Plan: every step with its dates. A moved date shows as moved, with why (D2). */
import { Button, PageHeader, Section } from "@wren/ui";
import { useState } from "react";
import type { EngagementView, StepView } from "../../api.js";
import type { PageProps } from "../../module.js";
import { dayLabel, Engagements, Form, field, StateTag, useAct, useWork } from "./bits.js";

export function Plan(props: PageProps) {
  const work = useWork(props);
  const act = useAct(props, work.reload);
  return (
    <>
      <PageHeader title="Plan" lede="Every step, when it runs, and when it's due." />
      <Engagements work={work} props={props}>
        {(e) => (
          <Section>
            <ol className="wk-steps">
              {e.steps.map((s) => (
                <Step key={s.key} e={e} s={s} props={props} act={act} />
              ))}
            </ol>
          </Section>
        )}
      </Engagements>
    </>
  );
}

function Step({
  e,
  s,
  props,
  act,
}: {
  e: EngagementView;
  s: StepView;
  props: PageProps;
  act: ReturnType<typeof useAct>;
}) {
  const [moving, setMoving] = useState(false);
  const moved = s.dueOn !== s.plannedTo;
  const ids = { engagementId: e.id, step: s.key };
  return (
    <li className="wk-step">
      <div className="wk-step-head">
        <b>{s.name}</b>
        <StateTag state={s.state} />
      </div>
      <p className="wk-quiet">
        {dayLabel(s.plannedFrom)} to {s.plannedTo ? dayLabel(s.plannedTo) : "the end"}
        {s.doneOn ? ` · done ${dayLabel(s.doneOn)}` : ""}
      </p>
      {moved && s.dueOn ? (
        <p className="wk-moved">
          Moved to {dayLabel(s.dueOn)}
          {s.slipReason ? `: ${s.slipReason}` : ""}
        </p>
      ) : null}
      {props.team ? (
        <div className="wk-tools">
          <Button
            size="sm"
            tone="secondary"
            disabled={act.busy}
            onClick={() => act.run("done", { ...ids, on: s.doneOn ? null : undefined })}
          >
            {s.doneOn ? "Not done" : "Mark done"}
          </Button>
          {s.doneOn ? null : (
            <Button size="sm" tone="quiet" onClick={() => setMoving((m) => !m)}>
              Move date
            </Button>
          )}
          {act.error && !moving ? <span className="wk-error">{act.error}</span> : null}
        </div>
      ) : null}
      {moving ? (
        <Form
          label={`Move ${s.name}`}
          submit="Move"
          act={act}
          demo={props.demo}
          onSubmit={async (f) => {
            const ok = await act.run("slip", {
              ...ids,
              to: field(f, "to"),
              reason: field(f, "reason"),
            });
            if (ok) setMoving(false);
            return ok;
          }}
        >
          <label className="wk-field">
            <span>New due date</span>
            <input type="date" name="to" required defaultValue={s.dueOn ?? ""} />
          </label>
          <label className="wk-field wk-grow">
            <span>Why (the client reads this)</span>
            <input name="reason" required maxLength={500} />
          </label>
        </Form>
      ) : null}
    </li>
  );
}
