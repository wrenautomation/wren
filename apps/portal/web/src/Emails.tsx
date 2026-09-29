/** What we wrote for you, and your say before it goes: send these, or don't. */
import { useState } from "react";
import { ApiError, call, type EmailFilter, type EmailRow, type EmailsPage } from "./api.js";
import { go, href } from "./route.js";
import { Failed, num, Pager, useCall } from "./ui.js";

const FILTERS: Record<EmailFilter, string> = {
  awaiting: "Waiting for you",
  approved: "Approved",
  sent: "Sent",
  stopped: "Stopped",
  all: "All",
};
const STATUS: Record<EmailRow["status"], string> = {
  awaiting: "Waiting for you",
  approved: "Approved, going out",
  sent: "Sent",
  stopped: "Stopped",
};
const STOPS: Record<string, string> = {
  reply: "they replied",
  bounce: "it bounced",
  opt_out: "they opted out",
  complaint: "marked as spam",
  manual: "you skipped it",
};
const PAGE = 50;

export function Emails({
  client,
  demo,
  params,
}: {
  client: string;
  demo: boolean;
  params: URLSearchParams;
}) {
  const filter = (params.get("filter") as EmailFilter | null) ?? "awaiting";
  const offset = Number(params.get("offset")) || 0;
  const [nonce, setNonce] = useState(0);
  const list = useCall(`emails:${client}:${filter}:${offset}:${nonce}`, () =>
    call<EmailsPage>("emails", { client, filter, offset }),
  );
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const waiting = list.data?.rows.filter((r) => r.status === "awaiting") ?? [];
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

  const approval = list.data?.approval;
  return (
    <div className="page">
      {approval ? (
        <p className="quiet">
          {demo
            ? "The demo is read-only. On your list, you approve emails here before anything sends."
            : approval.mode === "every"
              ? "Nothing sends until you approve it. Each new batch waits here."
              : approval.firstApproved
                ? "You approved the first batch, so new emails go out on their own. Skip any you'd rather we didn't send."
                : "Nothing sends until you approve the first batch. After that, new emails go out on their own."}
        </p>
      ) : null}

      <div className="filters" role="tablist" aria-label="Filter">
        {(Object.keys(FILTERS) as EmailFilter[]).map((f) => (
          <a
            key={f}
            role="tab"
            aria-selected={f === filter}
            href={href("emails", { filter: f === "awaiting" ? null : f })}
          >
            {FILTERS[f]}
            {list.data ? <span className="count">{num(list.data.counts[f])}</span> : null}
          </a>
        ))}
      </div>

      {!demo && waiting.length ? (
        <div className="actions">
          <label className="pick-all">
            <input
              type="checkbox"
              checked={waiting.every((r) => picked.has(r.enrollmentId))}
              onChange={(e) =>
                setPicked(
                  e.target.checked ? new Set(waiting.map((r) => r.enrollmentId)) : new Set(),
                )
              }
            />{" "}
            All {num(waiting.length)} on this page
          </label>
          <button
            type="button"
            className="primary"
            disabled={busy || !picked.size}
            onClick={() => act("approve")}
          >
            Send {picked.size ? num(picked.size) : ""}
          </button>
          <button type="button" disabled={busy || !picked.size} onClick={() => act("skip")}>
            Don't send
          </button>
        </div>
      ) : null}
      {error ? <Failed error={error} /> : null}

      {list.error && !list.data ? <Failed error={list.error} /> : null}
      {list.data ? (
        list.data.rows.length ? (
          <ul className={`cards${list.loading ? " stale" : ""}`}>
            {list.data.rows.map((r) => (
              <li key={r.enrollmentId} className="card">
                <div className="card-head">
                  {!demo && r.status === "awaiting" ? (
                    <input
                      type="checkbox"
                      aria-label={`Pick the email to ${r.name}`}
                      checked={picked.has(r.enrollmentId)}
                      onChange={() => toggle(r.enrollmentId)}
                    />
                  ) : null}
                  <span className="card-who">
                    {r.personId ? (
                      <a className="who" href={href("people", { person: r.personId })}>
                        <b>{r.name}</b>
                      </a>
                    ) : (
                      <b>{r.name}</b>
                    )}
                    <span className="quiet"> · {r.firm}</span>
                  </span>
                  <span className={`tag tag-${r.status}`}>
                    {STATUS[r.status]}
                    {r.status === "stopped" && r.stopReason
                      ? `: ${STOPS[r.stopReason] ?? r.stopReason}`
                      : ""}
                  </span>
                </div>
                <div className="mail-meta quiet small">
                  From {r.from} to {r.to}
                  {r.sent ? ` · ${r.sent} of 2 sent` : ""}
                </div>
                {r.subject ? <div className="mail-subject">{r.subject}</div> : null}
                <div className="mail-body">{r.opener}</div>
                {r.followup ? (
                  <details className="mail-followup">
                    <summary>Follow-up, 4 days later if no reply</summary>
                    <div className="mail-body">{r.followup}</div>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty">
            {filter === "awaiting"
              ? "Nothing waiting for you. New emails show up here as we write them."
              : "None yet."}
          </p>
        )
      ) : list.loading ? (
        <div className="loading">Loading…</div>
      ) : null}
      {list.data ? (
        <Pager
          offset={list.data.offset}
          size={PAGE}
          total={list.data.total}
          onPage={(o) => go("emails", { offset: o || null }, params)}
        />
      ) : null}
    </div>
  );
}
