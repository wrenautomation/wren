/** What we wrote for you, and your say before it goes: send these, or don't. */
import {
  Alert,
  Button,
  Callout,
  Card,
  CardList,
  Drawer,
  Empty,
  Loading,
  num,
  PageHeader,
  Pager,
  Tabs,
  Tag,
  type TagTone,
  Traced,
  Trail,
} from "@wren/ui";
import { useState } from "react";
import {
  ApiError,
  call,
  type EmailFilter,
  type EmailRow,
  type EmailsPage,
  type WhyLine,
} from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { Cited, marksOf, SourceCards, useSourcePick, Who } from "./bits.js";
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
    call<EmailsPage>("reactivation/emails", { client, filter, offset }),
  );
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [why, setWhy] = useState<{ row: EmailRow; line: WhyLine } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // The demo acts in the page only: what you approved or skipped, until a reload.
  const [local, setLocal] = useState<Map<number, Acted>>(new Map());

  const d = list.data ? withLocal(list.data, local) : undefined;
  const waiting = d?.rows.filter((r) => r.status === "awaiting") ?? [];
  const toggle = (id: number) =>
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const act = async (route: "approve" | "skip", ids = [...picked]) => {
    if (!ids.length) return;
    const n = ids.length === 1 ? "this email" : `${num(ids.length)} emails`;
    if (route === "skip" && !confirm(`Don't send ${n}? We won't write to them again.`)) return;
    const said = route === "approve" ? `Approved ${n}.` : `Skipped ${n}.`;
    setError(null);
    setPicked((p) => new Set([...p].filter((id) => !ids.includes(id))));
    if (demo) {
      setLocal((m) => new Map([...m, ...ids.map((id): [number, Acted] => [id, route])]));
      setDone(`${said} Nothing sends on the demo. Reload to reset.`);
      return;
    }
    setBusy(true);
    try {
      await call(`reactivation/${route}`, { client, enrollmentIds: ids });
      setDone(said);
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
            ? "Nothing sends without your OK. Try it below: on the demo, nothing actually goes out."
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

      {waiting.length ? (
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
            Approve {picked.size ? num(picked.size) : ""}
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
      {done ? (
        <p className="rx-done" role="status">
          {done}
        </p>
      ) : null}

      {list.error && !d ? <Alert onRetry={list.retry}>{list.error.message}</Alert> : null}
      {d ? (
        d.rows.length ? (
          <CardList stale={list.loading}>
            {d.rows.map((r) => {
              // On the demo an approved email goes nowhere, so it doesn't say it's going out.
              const [status, tone] =
                demo && r.status === "approved"
                  ? (["Approved", "green"] as const)
                  : STATUS[r.status];
              return (
                <Card key={r.enrollmentId}>
                  <div className="rx-card-head">
                    {r.status === "awaiting" ? (
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
                    <Body
                      text={r.opener}
                      why={r.why?.opener ?? []}
                      open={why?.line ?? null}
                      onWhy={(line) => setWhy({ row: r, line })}
                    />
                  </div>
                  {r.followup ? (
                    <details className="rx-followup">
                      <summary>Follow-up, 4 days later if no reply</summary>
                      <div className="rx-mail">
                        <Body
                          text={r.followup}
                          why={r.why?.followup ?? []}
                          open={why?.line ?? null}
                          onWhy={(line) => setWhy({ row: r, line })}
                        />
                      </div>
                    </details>
                  ) : null}
                  {r.status === "awaiting" ? (
                    <div className="rx-card-actions">
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => act("approve", [r.enrollmentId])}
                      >
                        Approve
                      </Button>
                      <Button
                        tone="secondary"
                        size="sm"
                        disabled={busy}
                        onClick={() => act("skip", [r.enrollmentId])}
                      >
                        Don't send
                      </Button>
                    </div>
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
        <Loading lines={3} shape="cards" />
      )}
      {d ? (
        <Pager
          offset={d.offset}
          size={PAGE}
          total={d.total}
          onPage={(o) => goto("emails", { offset: o || null }, params)}
        />
      ) : null}

      {why ? (
        <Drawer label="Why this line" onClose={() => setWhy(null)}>
          <Why row={why.row} line={why.line} />
        </Drawer>
      ) : null}
    </>
  );
}

type Acted = "approve" | "skip";

/** The page with the demo's own approvals and skips laid over it, counts and all. */
function withLocal(page: EmailsPage, local: Map<number, Acted>): EmailsPage {
  if (!local.size) return page;
  const counts = { ...page.counts };
  const rows = page.rows.map((r): EmailRow => {
    const a = r.status === "awaiting" ? local.get(r.enrollmentId) : undefined;
    if (!a) return r;
    counts.awaiting -= 1;
    if (a === "approve") {
      counts.approved += 1;
      return { ...r, status: "approved" };
    }
    counts.stopped += 1;
    return { ...r, status: "stopped", stopReason: "manual" };
  });
  return { ...page, rows, counts };
}

/** An email, paragraph by paragraph. One written from the brief can show why. */
function Body({
  text,
  why,
  open,
  onWhy,
}: {
  text: string;
  why: WhyLine[];
  open: WhyLine | null;
  onWhy: (line: WhyLine) => void;
}) {
  const byText = new Map(why.map((w) => [w.text, w]));
  return (
    <div className="rx-mail-body">
      {text.split(/\n{2,}/).map((para, i) => {
        const w = byText.get(para.trim());
        return w?.lines.length ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: an email's paragraphs never reorder.
          <Traced key={i} on={open?.text === w.text} onTrace={() => onWhy(w)}>
            {para}
          </Traced>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: an email's paragraphs never reorder.
          <p key={i}>{para}</p>
        );
      })}
    </div>
  );
}

/** One line of an email, traced back: the brief lines it was written from, then what they cite. */
function Why({ row, line }: { row: EmailRow; line: WhyLine }) {
  const brief = line.lines.flatMap((i) => row.why?.brief[i] ?? []);
  const cited = new Set(brief.flatMap(marksOf));
  const sources = row.sources.filter((s) => cited.has(s.mark.toLowerCase()));
  const order = sources.map((s) => s.mark.toLowerCase());
  const [lit, pick] = useSourcePick();
  return (
    <article className="rx-why">
      <header>
        <h2>Why this line</h2>
        <p className="rx-quiet">
          To {row.name} · {row.firm}
        </p>
      </header>
      <Trail
        steps={[
          {
            id: "line",
            label: "In the email",
            children: <blockquote className="rx-quote">{line.text}</blockquote>,
          },
          {
            id: "brief",
            label:
              brief.length === 1
                ? "Written from this line of the brief"
                : "Written from these lines of the brief",
            children: (
              <ul className="rx-brief-lines">
                {brief.map((b) => (
                  <li key={b} className="rx-brief-line">
                    <Cited text={b} order={order} lit={lit} onPick={pick} />
                  </li>
                ))}
              </ul>
            ),
          },
          {
            id: "found",
            label: "What we found",
            children: sources.length ? (
              <SourceCards sources={sources} lit={lit} />
            ) : (
              <p className="rx-quiet">These lines cite nothing we found.</p>
            ),
          },
        ]}
      />
      {row.personId ? (
        <p className="rx-why-more">
          <a href={at("people", { person: row.personId })}>
            See {row.name.split(" ")[0]}'s full brief
          </a>
        </p>
      ) : null}
    </article>
  );
}
