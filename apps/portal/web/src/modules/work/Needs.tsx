/** Needs you: what we're waiting on, answered in place (D5). Deliverables waiting on an OK lead. */
import { ButtonLink, Empty, PageHeader, Section, Tag } from "@wren/ui";
import type { AskView, EngagementView } from "../../api.js";
import type { PageProps } from "../../module.js";
import {
  ACCEPT,
  dayLabel,
  Engagements,
  Form,
  field,
  fileOf,
  OpenFile,
  StepPick,
  useAct,
  useWork,
} from "./bits.js";
import { at } from "./nav.js";

export function Needs(props: PageProps) {
  const work = useWork(props);
  const act = useAct(props, work.reload);
  return (
    <>
      <PageHeader title="Needs you" lede="What we're waiting on. Answer here and we pick it up." />
      <Engagements work={work} props={props}>
        {(e) => <Waiting e={e} props={props} act={act} />}
      </Engagements>
    </>
  );
}

function Waiting({
  e,
  props,
  act,
}: {
  e: EngagementView;
  props: PageProps;
  act: ReturnType<typeof useAct>;
}) {
  const open = e.asks.filter((a) => !a.answeredAt);
  const answered = e.asks.filter((a) => a.answeredAt);
  const toApprove = e.deliverables.filter((d) => d.status === "waiting");
  return (
    <>
      {props.team ? <AddAsk e={e} props={props} act={act} /> : null}
      {toApprove.length ? (
        <Section
          title="Waiting on your OK"
          actions={
            <ButtonLink href={at("deliverables")} tone="primary" size="sm" arrow>
              Review
            </ButtonLink>
          }
        >
          <ul className="wk-list">
            {toApprove.map((d) => (
              <li key={d.id}>{d.title}</li>
            ))}
          </ul>
        </Section>
      ) : null}
      <Section title="Open">
        {open.length === 0 ? (
          <Empty>Nothing waits on you right now.</Empty>
        ) : (
          <ul className="wk-cards">
            {open.map((a) => (
              <Ask key={a.id} a={a} props={props} act={act} />
            ))}
          </ul>
        )}
      </Section>
      {answered.length ? (
        <Section title="Answered">
          <ul className="wk-list">
            {answered.map((a) => (
              <li key={a.id}>
                <b>{a.text}</b>
                <p className="wk-quiet">
                  {[a.answer, a.file].filter(Boolean).join(" · ")} · {a.answeredBy},{" "}
                  {dayLabel(a.answeredAt)}
                </p>
                {a.file ? (
                  <div className="wk-tools">
                    <OpenFile props={props} of={{ askId: a.id }} />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </>
  );
}

function Ask({ a, props, act }: { a: AskView; props: PageProps; act: ReturnType<typeof useAct> }) {
  return (
    <li className="wk-card">
      <div className="wk-step-head">
        <b>{a.text}</b>
        {a.overdue ? (
          <Tag tone="rust">Overdue</Tag>
        ) : a.dueOn ? (
          <Tag>Due {dayLabel(a.dueOn)}</Tag>
        ) : null}
      </div>
      {props.team ? (
        <p className="wk-quiet">Waiting on the client.</p>
      ) : (
        <Form
          label={`Answer: ${a.text}`}
          submit="Send"
          act={act}
          demo={props.demo}
          onSubmit={(f) =>
            act.run("answer", { askId: a.id, answer: field(f, "answer") }, fileOf(f, "file"))
          }
        >
          <label className="wk-field wk-wide">
            <span>Your answer (a link works too)</span>
            <textarea name="answer" rows={2} maxLength={4000} />
          </label>
          <label className="wk-field wk-wide">
            <span>Or a file (up to 50 MB)</span>
            <input name="file" type="file" accept={ACCEPT} />
          </label>
        </Form>
      )}
    </li>
  );
}

function AddAsk({
  e,
  props,
  act,
}: {
  e: EngagementView;
  props: PageProps;
  act: ReturnType<typeof useAct>;
}) {
  return (
    <Section title="Ask the client">
      <Form
        label="Ask the client"
        submit="Ask"
        act={act}
        demo={props.demo}
        onSubmit={(f) =>
          act.run("ask", {
            engagementId: e.id,
            text: field(f, "text"),
            dueOn: field(f, "due"),
            step: field(f, "step"),
          })
        }
      >
        <label className="wk-field wk-wide">
          <span>What we need</span>
          <input name="text" required maxLength={500} />
        </label>
        <label className="wk-field">
          <span>Due</span>
          <input type="date" name="due" />
        </label>
        <StepPick e={e} />
      </Form>
    </Section>
  );
}
