/** Updates: the timeline, newest first. Wren's team posts here, and can take a post back off. */
import { Alert, Button, Empty, Loading, PageHeader, Section, Tag } from "@wren/ui";
import { useState } from "react";
import { ApiError, call, type UpdateView } from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { dayLabel, Form, field, SampleNote, StepPick, useAct, useWork } from "./bits.js";

type Page = { updates: UpdateView[]; more: boolean };

export function Updates(props: PageProps) {
  const { client, team } = props;
  const work = useWork(props);
  const [nonce, setNonce] = useState(0);
  const first = useCall(`updates:${client}:${team}:${nonce}`, () =>
    call<Page>("delivery/updates", { client, asClient: !team }),
  );
  const [older, setOlder] = useState<UpdateView[]>([]);
  const [more, setMore] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const act = useAct(props, () => {
    setOlder([]);
    setMore(null);
    setNonce((n) => n + 1);
    work.reload();
  });

  const shown = [...(first.data?.updates ?? []), ...older];
  const hasMore = more ?? first.data?.more ?? false;
  const loadOlder = async () => {
    const last = shown[shown.length - 1];
    if (!last) return;
    try {
      const page = await call<Page>("delivery/updates", {
        client,
        asClient: !team,
        before: last.id,
      });
      setOlder((o) => [...o, ...page.updates]);
      setMore(page.more);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  };
  const e = work.data?.engagements[0];
  const many = (work.data?.engagements.length ?? 0) > 1;

  return (
    <>
      <PageHeader title="Updates" lede="What we did, as we did it." />
      {props.demo ? <SampleNote /> : null}
      {team && e ? (
        <Section title="Post an update">
          <Form
            label="Post an update"
            submit="Post"
            act={act}
            demo={props.demo}
            onSubmit={(f) =>
              act.run("post", {
                engagementId: Number(field(f, "engagement") ?? e.id),
                body: field(f, "body"),
                step: field(f, "step"),
                internal: f.get("internal") === "on",
              })
            }
          >
            <label className="wk-field wk-wide">
              <span>What happened</span>
              <textarea name="body" required rows={3} maxLength={4000} />
            </label>
            {many ? (
              <label className="wk-field">
                <span>Project</span>
                <select name="engagement" defaultValue={e.id}>
                  {work.data?.engagements.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.offer.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <StepPick e={e} />
            <label className="wk-check">
              <input type="checkbox" name="internal" /> Wren's team only
            </label>
          </Form>
        </Section>
      ) : null}

      <Section>
        {first.error && !first.data ? (
          <Alert onRetry={first.retry}>{first.error.message}</Alert>
        ) : !first.data ? (
          <Loading lines={6} />
        ) : shown.length === 0 ? (
          <Empty>No updates yet. We post here as the work moves.</Empty>
        ) : (
          <ol className="wk-timeline">
            {shown.map((u) => (
              <li key={u.id} className={u.hidden ? "wk-hidden" : undefined}>
                <div className="wk-when">
                  {dayLabel(u.at)}
                  {u.step ? (
                    <span className="wk-quiet"> · {stepName(work.data, u.step)}</span>
                  ) : null}
                  {u.internal ? <Tag>Team only</Tag> : null}
                  {u.hidden ? <Tag>Hidden</Tag> : null}
                </div>
                <p className="wk-body">{u.body}</p>
                {team && !u.hidden ? (
                  <Button
                    size="sm"
                    tone="quiet"
                    disabled={act.busy || props.demo}
                    onClick={() => {
                      if (confirm("Take this off the client's timeline? It stays on record."))
                        void act.run("hide", { updateId: u.id });
                    }}
                  >
                    Hide
                  </Button>
                ) : null}
              </li>
            ))}
          </ol>
        )}
        {act.error ? <p className="wk-error">{act.error}</p> : null}
        {error ? <p className="wk-error">{error}</p> : null}
        {hasMore ? (
          <Button tone="secondary" size="sm" onClick={loadOlder}>
            Older updates
          </Button>
        ) : null}
      </Section>
    </>
  );
}

const stepName = (
  home: { engagements: { steps: { key: string; name: string }[] }[] } | null,
  key: string,
) => home?.engagements.flatMap((e) => e.steps).find((s) => s.key === key)?.name ?? key;
