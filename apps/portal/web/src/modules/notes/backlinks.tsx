/**
 * "Notes" on a record's page: the notes that @ it, which this viewer may open. A note links a
 * record by `@`; the server keeps the links as the note saves.
 */
import { can, relative } from "@wren/ui";
import type { ReactNode } from "react";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { docPath, notes } from "./api.js";

function Backlinks({ client, target }: { client: string; target: string }) {
  const got = useCall(`notes:backlinks:${client}:${target}`, () =>
    notes(client, "backlinks", { target }),
  );
  if (!got.data) return null;
  if (!got.data.notes.length)
    return (
      <p className="m-0 text-[13px] text-(--ui-ink-2)">
        No note links here. Type @ in a note to link it.
      </p>
    );
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {got.data.notes.map((n) => (
        <li key={n.id} className="text-[13.5px]">
          <a href={docPath(n.id)} className="font-medium text-(--ui-ink)">
            {n.name}
          </a>
          <span className="text-[12px] text-(--ui-ink-2)">
            {" "}
            · edited {relative(new Date(n.updatedAt))}
          </span>
          {n.excerpt ? (
            <span className="mt-0.5 line-clamp-2 block text-[13px] text-(--ui-ink-2)">
              {n.excerpt}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** The section for a record of type `record`, or none where notes can't be read (the demo). */
export function notesSection(
  props: PageProps,
  record: string,
  id: string,
): [string, ReactNode] | null {
  if (props.demo) return null;
  if (
    !can(
      {
        team: props.team,
        demo: false,
        ...(props.can ? { can: props.can } : {}),
        ...(props.who ? { who: props.who } : {}),
      },
      { needs: "read", at: { app: "notes" } },
    )
  )
    return null;
  return ["Notes", <Backlinks key="notes" client={props.client} target={`${record}:${id}`} />];
}
