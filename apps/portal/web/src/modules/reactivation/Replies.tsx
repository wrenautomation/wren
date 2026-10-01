/** Who wrote back, who we passed them to, and the meetings that came of it. */
import {
  Alert,
  Button,
  Card,
  CardList,
  Empty,
  Loading,
  num,
  PageHeader,
  Pager,
  Stat,
  StatStrip,
  Tabs,
  Tag,
} from "@wren/ui";
import { useState } from "react";
import { ApiError, call, type RepliesPage, type ReplyFilter, type ReplyRow } from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { Who } from "./bits.js";
import { at, goto } from "./nav.js";

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
/** The replies worth a call. */
const WARM = new Set(["interested", "meeting_booked"]);
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

export function Replies({ client, demo, params }: PageProps) {
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

  const d = list.data;
  const bill = d?.bill;
  return (
    <>
      <PageHeader
        title="Replies"
        lede="Who wrote back, who we passed them to, and the meetings that came of it."
      />
      {bill ? (
        <StatStrip>
          <Stat
            label="Meetings booked"
            value={num(bill.meetings)}
            note={`${money(bill.perMeeting)} each, up to ${money(bill.cap)}`}
            href={at("replies", { filter: "booked" })}
          />
          <Stat
            label="Owed so far"
            value={money(bill.total)}
            note={`${money(bill.upfront)} setup + ${money(bill.meetingFees)} in meetings`}
          />
        </StatStrip>
      ) : null}

      <Tabs
        label="Filter"
        current={filter}
        items={(Object.keys(FILTERS) as ReplyFilter[]).map((f) => ({
          id: f,
          label: FILTERS[f],
          href: at("replies", { filter: f === "interested" ? null : f }),
          count: d?.counts[f],
        }))}
      />
      {error ? <Alert>{error.message}</Alert> : null}

      {list.error && !d ? <Alert onRetry={list.retry}>{list.error.message}</Alert> : null}
      {d ? (
        d.rows.length ? (
          <CardList stale={list.loading}>
            {d.rows.map((r) => (
              <Card key={r.threadEventId}>
                <div className="rx-card-head">
                  <Who name={r.name} firm={r.firm} personId={r.personId} />
                  {r.disposition ? (
                    <Tag tone={WARM.has(r.disposition) ? "green" : "neutral"}>
                      {DISPOSITIONS[r.disposition] ?? r.disposition}
                    </Tag>
                  ) : null}
                  <span className="rx-when">{when(r.receivedAt)}</span>
                </div>
                <div className="rx-mail">
                  {r.subject ? <p className="rx-mail-subject">{r.subject}</p> : null}
                  <p className="rx-mail-body">{r.text}</p>
                </div>
                {r.handoff || r.booked || !demo ? (
                  <div className="rx-card-foot">
                    <span className="rx-quiet">
                      {r.handoff
                        ? r.handoff.forwardedAt
                          ? `Sent to ${r.handoff.recruiter} ${when(r.handoff.forwardedAt)}`
                          : `Sending to ${r.handoff.recruiter}`
                        : ""}
                    </span>
                    {r.booked ? (
                      <span className="rx-booked">
                        <Tag tone="green">Meeting booked</Tag>
                        <span className="rx-quiet">
                          {when(r.booked.at)} by {r.booked.by}
                        </span>
                        {demo ? null : (
                          <Button
                            tone="quiet"
                            disabled={busy === r.threadEventId}
                            onClick={() => book(r, false)}
                          >
                            Undo
                          </Button>
                        )}
                      </span>
                    ) : demo ? null : (
                      <Button
                        tone="secondary"
                        size="sm"
                        disabled={busy === r.threadEventId}
                        onClick={() => book(r, true)}
                      >
                        Mark meeting booked
                      </Button>
                    )}
                  </div>
                ) : null}
              </Card>
            ))}
          </CardList>
        ) : (
          <Empty>
            {filter === "booked"
              ? "No meetings marked yet. Mark one here once it's on a calendar."
              : "No replies yet."}
          </Empty>
        )
      ) : list.error ? null : (
        <Loading lines={3} shape="cards" />
      )}
      {d ? (
        <Pager
          offset={d.offset}
          size={PAGE}
          total={d.total}
          onPage={(o) => goto("replies", { offset: o || null }, params)}
        />
      ) : null}
    </>
  );
}
