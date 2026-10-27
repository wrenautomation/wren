import { Agentation } from "agentation";
import { useEffect, useState } from "react";

/**
 * Notes on a story, to a Claude session (William, 10-27). Agentation draws the marks; its Send posts
 * them to the Devboard note inbox, so the session picked here wakes on `draw watch` like a canvas
 * note. Dev Storybook only: never in a build, a shot or a story test (frame.tsx). No Agentation
 * server and no MCP. Agentation is PolyForm Shield: free while Wren sells no feedback tool.
 */
const INBOX = "http://127.0.0.1:3100";
const KEY = "wren-feedback-to";

type Session = { watch: string; name: string; status: string };

function load(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

export function Feedback({ story }: { story: string }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [to, setTo] = useState(() => load(KEY));
  useEffect(() => {
    fetch(`${INBOX}/api/sessions`)
      .then((r) => r.json())
      .then((got: { sessions: Session[] }) => setSessions(got.sessions))
      .catch(() => setSessions([]));
  }, []);
  const pick = (watch: string) => {
    setTo(watch);
    try {
      localStorage.setItem(KEY, watch);
    } catch {}
  };
  const send = async (output: string) => {
    // A rejection keeps the marks in Agentation, to send again.
    if (!to) throw new Error("Pick a session first");
    const res = await fetch(`${INBOX}/api/notify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        to,
        text: output,
        link: `${location.origin}/?path=/story/${story}`,
      }),
    });
    if (!res.ok) throw new Error(`Devboard said ${res.status}`);
  };
  return (
    <>
      <select
        aria-label="Send notes to"
        value={to}
        onChange={(e) => pick(e.target.value)}
        style={{
          position: "fixed",
          left: 12,
          bottom: 12,
          zIndex: 99999,
          font: "12px var(--ui-font)",
          padding: "4px 6px",
          borderRadius: 6,
          border: "1px solid var(--ui-hair)",
          background: "var(--ui-canvas)",
          color: "var(--ui-ink)",
        }}
      >
        <option value="">{sessions.length ? "Send notes to…" : "Devboard is off"}</option>
        {sessions.map((s) => (
          <option key={s.watch} value={s.watch}>
            {s.name} ({s.watch}, {s.status})
          </option>
        ))}
      </select>
      <Agentation appName="wren Storybook" copyToClipboard={false} onSubmit={send} />
    </>
  );
}
