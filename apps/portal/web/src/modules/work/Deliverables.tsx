/** Deliverables: what we handed over. The client approves each, or asks for changes (D4). */
import { Button, ButtonLink, Empty, PageHeader, Section, Tag, type TagTone } from "@wren/ui";
import { useState } from "react";
import type { DeliverableView, EngagementView } from "../../api.js";
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
  Thread,
  useAct,
  useWork,
} from "./bits.js";

const STATUS: Record<DeliverableView["status"], [string, TagTone]> = {
  waiting: ["Waiting on your OK", "rust"],
  approved: ["Approved", "green"],
  changes: ["Changes asked", "neutral"],
};
const KIND: Record<DeliverableView["kind"], string> = {
  link: "Link",
  loom: "Video",
  doc: "Document",
  file: "File",
};

export function Deliverables(props: PageProps) {
  const work = useWork(props);
  const act = useAct(props, work.reload);
  return (
    <>
      <PageHeader title="Deliverables" lede="What we've handed over, and your say on each." />
      <Engagements work={work} props={props}>
        {(e) => (
          <>
            {props.team ? <Deliver e={e} props={props} act={act} /> : null}
            <Section>
              {e.deliverables.length === 0 ? (
                <Empty>Nothing handed over yet. Each piece shows here for your OK.</Empty>
              ) : (
                <ul className="wk-cards">
                  {e.deliverables.map((d) => (
                    <Piece key={d.id} d={d} props={props} act={act} />
                  ))}
                </ul>
              )}
            </Section>
          </>
        )}
      </Engagements>
    </>
  );
}

function Piece({
  d,
  props,
  act,
}: {
  d: DeliverableView;
  props: PageProps;
  act: ReturnType<typeof useAct>;
}) {
  const [asking, setAsking] = useState(false);
  const [label, tone] = STATUS[d.status];
  return (
    <li className="wk-card">
      <div className="wk-step-head">
        <b>{d.title}</b>
        <Tag tone={tone}>{label}</Tag>
      </div>
      <p className="wk-quiet">
        {d.file ?? KIND[d.kind]}
        {d.version > 1 ? ` · version ${d.version}` : ""} · {dayLabel(d.at)}
        {d.decidedBy
          ? ` · ${d.status === "approved" ? "approved" : "reviewed"} by ${d.decidedBy}`
          : ""}
      </p>
      {d.decisionNote ? <p className="wk-moved">“{d.decisionNote}”</p> : null}
      <div className="wk-tools">
        {d.url ? (
          <ButtonLink
            href={d.url}
            target="_blank"
            rel="noopener noreferrer"
            size="sm"
            tone="secondary"
            icon="external"
          >
            Open
          </ButtonLink>
        ) : null}
        {d.file ? <OpenFile props={props} of={{ deliverableId: d.id }} /> : null}
        {d.status === "waiting" && !props.team ? (
          <>
            <Button
              size="sm"
              disabled={act.busy || props.demo}
              onClick={() => act.run("decide", { deliverableId: d.id, decision: "approved" })}
            >
              Approve
            </Button>
            <Button
              size="sm"
              tone="quiet"
              disabled={props.demo}
              onClick={() => setAsking((a) => !a)}
            >
              Ask for changes
            </Button>
          </>
        ) : null}
        {props.demo && d.status === "waiting" ? (
          <span className="wk-quiet">Off on the demo.</span>
        ) : null}
      </div>
      {asking ? (
        <Form
          label="Ask for changes"
          submit="Send"
          act={act}
          demo={props.demo}
          onSubmit={async (f) => {
            const ok = await act.run("decide", {
              deliverableId: d.id,
              decision: "changes",
              note: field(f, "note"),
            });
            if (ok) setAsking(false);
            return ok;
          }}
        >
          <label className="wk-field wk-wide">
            <span>What should change</span>
            <textarea name="note" required rows={3} maxLength={2000} />
          </label>
        </Form>
      ) : act.error ? (
        <p className="wk-error">{act.error}</p>
      ) : null}
      <Thread props={props} act={act} on={{ deliverableId: d.id }} comments={d.comments} />
    </li>
  );
}

function Deliver({
  e,
  props,
  act,
}: {
  e: EngagementView;
  props: PageProps;
  act: ReturnType<typeof useAct>;
}) {
  const [kind, setKind] = useState("link");
  return (
    <Section title="Hand something over">
      <Form
        label="Hand something over"
        submit="Deliver"
        act={act}
        demo={props.demo}
        onSubmit={(f) => {
          const replaces = field(f, "replaces");
          return act.run(
            "deliver",
            {
              engagementId: e.id,
              title: field(f, "title"),
              kind,
              url: field(f, "url"),
              step: field(f, "step"),
              ...(replaces ? { replaces: Number(replaces) } : {}),
            },
            fileOf(f, "file"),
          );
        }}
      >
        <label className="wk-field wk-grow">
          <span>Title</span>
          <input name="title" required maxLength={200} />
        </label>
        <label className="wk-field">
          <span>Kind</span>
          <select name="kind" value={kind} onChange={(ev) => setKind(ev.target.value)}>
            <option value="link">Link</option>
            <option value="loom">Loom</option>
            <option value="doc">Document</option>
            <option value="file">File</option>
          </select>
        </label>
        {kind === "file" ? (
          <label className="wk-field wk-wide">
            <span>File (up to 50 MB)</span>
            <input name="file" type="file" required accept={ACCEPT} />
          </label>
        ) : (
          <label className="wk-field wk-wide">
            <span>Address (https)</span>
            <input name="url" type="url" required placeholder="https://" />
          </label>
        )}
        <StepPick e={e} />
        {e.deliverables.length ? (
          <label className="wk-field">
            <span>New version of</span>
            <select name="replaces" defaultValue="">
              <option value="">Nothing, it's new</option>
              {e.deliverables.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title} (v{d.version})
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </Form>
    </Section>
  );
}
