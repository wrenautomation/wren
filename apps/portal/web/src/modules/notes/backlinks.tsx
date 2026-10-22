/**
 * "Notes" on a record's page: the notes that @ it, which this viewer may open. A note links a
 * record by `@`; the server keeps the links as the note saves.
 */
import { can, Icon, Rows, type RowsLine, relative, Tag, useNarrow } from "@wren/ui";
import { type ReactNode, useMemo } from "react";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { navigate } from "../../route.js";
import { docPath, notes } from "./api.js";

type NoteBack = Awaited<ReturnType<typeof notes<"backlinks">>>["notes"][number];

function Backlinks({ client, target }: { client: string; target: string }) {
  const got = useCall(`notes:backlinks:${client}:${target}`, () =>
    notes(client, "backlinks", { target }),
  );
  const narrow = useNarrow();
  const data = got.data;
  const lines = useMemo<RowsLine<NoteBack>[]>(
    () => (data?.notes ?? []).map((n, index) => ({ kind: "row", key: n.id, index, row: n })),
    [data],
  );
  if (!got.data) return null;
  if (!got.data.notes.length)
    return (
      <p className="m-0 text-[13px] text-(--ui-ink-2)">
        No note links here. Type @ in a note to link it.
      </p>
    );
  return (
    <div className="overflow-x-auto">
      <Rows<NoteBack>
        label="notes that link here"
        noun="note"
        narrow={narrow}
        scroller="window"
        lines={lines}
        name={{
          label: "Note",
          icon: "note",
          min: 180,
          title: (n) => n.name,
          href: (n) => docPath(n.id),
          mark: () => <Icon name="note" size={15} className="flex-none text-(--ui-ink-2)" />,
          sub: (n) =>
            n.excerpt ? (
              <span className="wrap-anywhere whitespace-normal text-[12.5px] font-normal text-(--ui-ink-2)">
                {n.excerpt}
              </span>
            ) : null,
          tail: (n) =>
            n.card ? (
              <Tag tone={n.card.closed ? "green" : "neutral"}>Card: {n.card.column}</Tag>
            ) : null,
        }}
        columns={[
          {
            key: "edited",
            label: "Edited",
            icon: "clock",
            width: 110,
            quiet: true,
            phone: true,
            cell: (n) => relative(new Date(n.updatedAt)),
          },
        ]}
        open={{ id: null, onOpen: (n) => navigate(docPath(n.id)) }}
      />
    </div>
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
