/** Who wrote back, who we passed them to, and the meetings that came of it. */
import { useState } from "react";
import { ApiError, call, type RepliesPage, type ReplyFilter, type ReplyRow } from "./api.js";
import { go, href } from "./route.js";
import { Failed, num, Pager, Stat, useCall } from "./ui.js";

const FILTERS: Record<ReplyFilter, string> = {
  interested: "Interested",
  booked: "Meetings booked",
  all: "All replies",
};
const DISPOSITIONS: Record<string, string> = {
  interested: "Interested",
  meeting_booked: "Wants a meeting",
  not_interested: "Not interested",
  not_now: "Not now",
  wrong_person: "Wrong person",
  referral: "Referred someone",
  other: "Other",
};
const PAGE = 50;

const money = (n: number) => `$${n.toLocaleString("en-US")}`;
const when = (iso: string) =>
  iso
    ? new Date(iso).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";

export function Replies({
  client,
  demo,
  params,
}: {
  client: string;
  demo: boolean;
  params: URLSearchParams;
}) {
  const filter = (params.get("filter") as ReplyFilter | null) ?? "interested";
  const offset = Number(params.get("offset")) || 0;
  const [nonce, setNonce] = useState(0);
  const list = useCall(`replies:${client}:${filter}:${offset}:${nonce}`, () =>
    call<RepliesPage>("replies", { client, filter, offset }),
  );
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const book = async (r: ReplyRow, booked: boolean) => {
    if (!booked && !confirm(`Take back the meeting with ${r.name}?`)) return;
    setBusy(r.threadEventId);
    setError(null);
    try {
      await call("book", { client, threadEventId: r.threadEventId, booked });
      setNonce((n) => n + 1);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(String(err), 0));
    } finally {
      setBusy(null);
    }
  };

  const bill = list.data?.bill;
  return (
    <div className="page">
      {bill ? (
        <section className="stats">
          <Stat
            value={<a href={href("replies", { filter: "booked" })}>{num(bill.meetings)}</a>}
            label="Meetings booked"
            note={`${money(bill.perMeeting)} each, up to ${money(bill.cap)}`}
          />
          <Stat
            value={money(bill.total)}
            label="Owed so far"
            note={`${money(bill.upfront)} setup + ${money(bill.meetingFees)} in meetings`}
          />
        </section>
      ) : null}

      <div className="filters" role="tablist" aria-label="Filter">
        {(Object.keys(FILTERS) as ReplyFilter[]).map((f) => (
          <a
            key={f}
            role="tab"
            aria-selected={f === filter}
            href={href("replies", { filter: f === "interested" ? null : f })}
          >
            {FILTERS[f]}
            {list.data ? <span className="count">{num(list.data.counts[f])}</span> : null}
          </a>
        ))}
      </div>
      {error ? <Failed error={error} /> : null}

      {list.error && !list.data ? <Failed error={list.error} /> : null}
      {list.data ? (
        list.data.rows.length ? (
          <ul className={`cards${list.loading ? " stale" : ""}`}>
            {list.data.rows.map((r) => (
              <li key={r.threadEventId} className="card">
                <div className="card-head">
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
                  {r.disposition ? (
                    <span className="tag tag-reply">
                      {DISPOSITIONS[r.disposition] ?? r.disposition}
                    </span>
                  ) : null}
                  <span className="quiet small nowrap">{when(r.receivedAt)}</span>
                </div>
                {r.subject ? <div className="mail-subject">{r.subject}</div> : null}
                <div className="mail-body">{r.text}</div>
                <div className="card-foot">
                  <span className="quiet small">
                    {r.handoff
                      ? r.handoff.forwardedAt
                        ? `Sent to ${r.handoff.recruiter} ${when(r.handoff.forwardedAt)}`
                        : `Sending to ${r.handoff.recruiter}`
                      : ""}
                  </span>
                  {r.booked ? (
                    <span className="booked">
                      <span className="tag tag-booked">Meeting booked</span>
                      <span className="quiet small">
                        {" "}
                        {when(r.booked.at)} by {r.booked.by}
                      </span>
                      {demo ? null : (
                        <button
                          type="button"
                          className="link"
                          disabled={busy === r.threadEventId}
                          onClick={() => book(r, false)}
                        >
                          Undo
                        </button>
                      )}
                    </span>
                  ) : demo ? null : (
                    <button
                      type="button"
                      disabled={busy === r.threadEventId}
                      onClick={() => book(r, true)}
                    >
                      Mark meeting booked
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty">
            {filter === "booked"
              ? "No meetings marked yet. Mark one here once it's on a calendar."
              : "No replies yet."}
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
          onPage={(o) => go("replies", { offset: o || null }, params)}
        />
      ) : null}
    </div>
  );
}
