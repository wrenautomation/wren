/** What we wrote for you, and your say before it goes: send these, or don't. */
import {
  Alert,
  Button,
  Callout,
  Card,
  CardList,
  Empty,
  Loading,
  num,
  PageHeader,
  Pager,
  Tabs,
  Tag,
  type TagTone,
} from "@wren/ui";
import { useState } from "react";
import { ApiError, call, type EmailFilter, type EmailRow, type EmailsPage } from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { Who } from "./bits.js";
import { at, goto } from "./nav.js";

const FILTERS: Record<EmailFilter, string> = {
  awaiting: "Waiting for you",
  approved: "Approved",
  sent: "Sent",
  stopped: "Stopped",
  all: "All",
};
const STATUS: Record<EmailRow["status"], [string, TagTone]> = {
  awaiting: ["Waiting for you", "rust"],
  approved: ["Approved, going out", "green"],
  sent: ["Sent", "green"],
  stopped: ["Stopped", "neutral"],
};
const STOPS: Record<string, string> = {
  reply: "they replied",
  bounce: "it bounced",
  opt_out: "they opted out",
  complaint: "marked as spam",
  manual: "you skipped it",
};
const PAGE = 50;

export function Emails({ client, demo, params }: PageProps) {
  const filter = (params.get("filter") as EmailFilter | null) ?? "awaiting";
  const offset = Number(params.get("offset")) || 0;
  const [nonce, setNonce] = useState(0);
  const list = useCall(`emails:${client}:${filter}:${offset}:${nonce}`, () =>
    call<EmailsPage>("emails", { client, filter, offset }),
  );
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const d = list.data;
  const waiting = d?.rows.filter((r) => r.status === "awaiting") ?? [];
  const toggle = (id: number) =>
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const act = async (route: "approve" | "skip") => {
    if (!picked.size) return;
    if (route === "skip" && !confirm(`Don't send ${picked.size}? We won't write to them again.`))
      return;
    setBusy(true);
    setError(null);
    try {
      await call(route, { client, enrollmentIds: [...picked] });
      setPicked(new Set());
      setNonce((n) => n + 1);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(String(err), 0));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Emails" lede="What we wrote, and your say before it goes." />
      {d ? (
        <Callout>
          {demo
            ? "The demo is read-only. On your list, you approve emails here before anything sends."
            : d.approval.mode === "every"
              ? "Nothing sends until you approve it. Each new batch waits here."
              : d.approval.firstApproved
                ? "You approved the first batch, so new emails go out on their own. Skip any you'd rather we didn't send."
                : "Nothing sends until you approve the first batch. After that, new emails go out on their own."}
        </Callout>
      ) : null}

      <Tabs
        label="Filter"
        current={filter}
        items={(Object.keys(FILTERS) as EmailFilter[]).map((f) => ({
          id: f,
          label: FILTERS[f],
          href: at("emails", { filter: f === "awaiting" ? null : f }),
          count: d?.counts[f],
        }))}
      />

      {!demo && waiting.length ? (
        <div className="rx-bulk">
          <label>
            <input
              type="checkbox"
              checked={waiting.every((r) => picked.has(r.enrollmentId))}
              onChange={(e) =>
                setPicked(
                  e.target.checked ? new Set(waiting.map((r) => r.enrollmentId)) : new Set(),
                )
              }
            />
            All {num(waiting.length)} on this page
          </label>
          <Button size="sm" disabled={busy || !picked.size} onClick={() => act("approve")}>
            Send {picked.size ? num(picked.size) : ""}
          </Button>
          <Button
            tone="secondary"
            size="sm"
            disabled={busy || !picked.size}
            onClick={() => act("skip")}
          >
            Don't send
          </Button>
        </div>
      ) : null}
      {error ? <Alert>{error.message}</Alert> : null}

      {list.error && !d ? <Alert>{list.error.message}</Alert> : null}
      {d ? (
        d.rows.length ? (
          <CardList stale={list.loading}>
            {d.rows.map((r) => {
              const [status, tone] = STATUS[r.status];
              return (
                <Card key={r.enrollmentId}>
                  <div className="rx-card-head">
                    {!demo && r.status === "awaiting" ? (
                      <input
                        type="checkbox"
                        aria-label={`Pick the email to ${r.name}`}
                        checked={picked.has(r.enrollmentId)}
                        onChange={() => toggle(r.enrollmentId)}
                      />
                    ) : null}
                    <Who name={r.name} firm={r.firm} personId={r.personId} />
                    <Tag tone={tone} dot={r.status === "awaiting"}>
                      {status}
                      {r.status === "stopped" && r.stopReason
                        ? `: ${STOPS[r.stopReason] ?? r.stopReason}`
                        : ""}
                    </Tag>
                  </div>
                  <p className="rx-meta">
                    From {r.from} to {r.to}
                    {r.sent ? ` · ${r.sent} of 2 sent` : ""}
                  </p>
                  <div className="rx-mail">
                    {r.subject ? <p className="rx-mail-subject">{r.subject}</p> : null}
                    <p className="rx-mail-body">{r.opener}</p>
                  </div>
                  {r.followup ? (
                    <details className="rx-followup">
                      <summary>Follow-up, 4 days later if no reply</summary>
                      <div className="rx-mail">
                        <p className="rx-mail-body">{r.followup}</p>
                      </div>
                    </details>
                  ) : null}
                </Card>
              );
            })}
          </CardList>
        ) : (
          <Empty>
            {filter === "awaiting"
              ? "Nothing waiting for you. New emails show up here as we write them."
              : "None yet."}
          </Empty>
        )
      ) : list.error ? null : (
        <Loading lines={8} />
      )}
      {d ? (
        <Pager
          offset={d.offset}
          size={PAGE}
          total={d.total}
          onPage={(o) => goto("emails", { offset: o || null }, params)}
        />
      ) : null}
    </>
  );
}
