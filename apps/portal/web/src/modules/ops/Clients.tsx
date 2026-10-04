/** Wren's ops board: every client's work on one screen, the ones at risk first. */
import { Alert, Empty, Loading, PageHeader, Table, Tag } from "@wren/ui";
import { type BoardRow, call } from "../../api.js";
import { useCall } from "../../load.js";
import { href } from "../../route.js";
import { dayLabel } from "../work/bits.js";

/** "3h ago", "2d ago"; "never" for nothing. */
export function age(at: string | null, now = Date.now()): string {
  if (!at) return "never";
  const hours = Math.floor((now - new Date(at).getTime()) / 3_600_000);
  return hours < 1 ? "just now" : hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

export function Clients() {
  const board = useCall("ops:board", () => call<BoardRow[]>("delivery/board"));
  const rows = board.data;
  return (
    <>
      <PageHeader
        title="Clients"
        lede="Every client's work, at risk first: quiet 3 business days, a late step or ask, a low pulse, or nobody signing in."
      />
      {board.error && !rows ? <Alert onRetry={board.retry}>{board.error.message}</Alert> : null}
      {rows ? (
        rows.length ? (
          <Table stale={board.loading} stack>
            <thead>
              <tr>
                <th>Client</th>
                <th>Phase</th>
                <th>Next</th>
                <th>Last update</th>
                <th>Open asks</th>
                <th>Last seen</th>
                <th>Pulse</th>
                <th>Risk</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.clientId}:${r.engagementId}`}>
                  <td>
                    <a href={href(r.path, { client: r.clientId })}>{r.name}</a>
                    {r.offer ? <div className="ops-sub">{r.offer}</div> : null}
                  </td>
                  <td data-label="Phase">
                    {!r.offer
                      ? "Nothing running"
                      : r.status === "onboarding"
                        ? "Paperwork"
                        : `${r.phase ?? "All done"} (${r.stepsDone}/${r.steps})`}
                  </td>
                  <td data-label="Next" className="ui-nowrap">
                    {r.next ? `${r.next.name}, ${dayLabel(r.next.dueOn)}` : "-"}
                  </td>
                  <td data-label="Last update" className="ui-nowrap">
                    {r.offer ? age(r.lastUpdateAt) : "-"}
                  </td>
                  <td data-label="Open asks">{r.openAsks}</td>
                  <td data-label="Last seen" className="ui-nowrap">
                    {age(r.lastSeenAt)}
                  </td>
                  <td data-label="Pulse">{r.pulse ? `${r.pulse}/5` : "-"}</td>
                  <td data-label="Risk" data-wide>
                    {r.risks.length ? (
                      r.risks.map((x) => (
                        <div key={x}>
                          <Tag tone="rust">{x}</Tag>
                        </div>
                      ))
                    ) : (
                      <Tag tone="green">ok</Tag>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <Empty>No clients yet. Add one from the command line.</Empty>
        )
      ) : board.error ? null : (
        <Loading lines={8} shape="rows" />
      )}
    </>
  );
}
