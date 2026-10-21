/** A server refusal as the server says it: one line, or a list when the reason has many lines. */
import { Alert } from "@wren/ui";

export function Refused({ text }: { text: string }) {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return (
    <Alert className="mb-0">
      {lines.length > 1 ? (
        <ul className="list-none space-y-0.5">
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      ) : (
        (lines[0] ?? text)
      )}
    </Alert>
  );
}

export const messageOf = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);
