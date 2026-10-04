/** What a project record's panel adds under its fields: the piece to open, the thread, the paper's link. */
import { ButtonLink, type RecordExtras } from "@wren/ui";
import type { AskView, DeliverableView, UpdateView } from "../../api.js";
import type { ListPage } from "../../module.js";
import { OpenFile, Thread } from "./bits.js";
import { at } from "./nav.js";

type Extras = NonNullable<ListPage["extras"]>;
/** A link in the panel keeps its own width. */
const START = "justify-self-start";

/** The update's words are its title; the thread goes under. */
export const updateExtras: Extras = (detail, props) => {
  const u = detail as UpdateView;
  return {
    sections: [
      [
        "Comments",
        <Thread key={u.id} props={props} on={{ updateId: u.id }} comments={u.comments} />,
      ],
    ],
  } satisfies RecordExtras;
};

export const askExtras: Extras = (detail, props) => {
  const a = detail as AskView;
  return {
    lead: a.file ? <OpenFile props={props} of={{ askId: a.id }} /> : null,
  } satisfies RecordExtras;
};

export const deliverableExtras: Extras = (detail, props) => {
  const d = detail as DeliverableView;
  return {
    lead: d.url ? (
      <ButtonLink
        href={d.url}
        target="_blank"
        rel="noopener"
        tone="secondary"
        size="sm"
        arrow
        className={START}
      >
        Open
      </ButtonLink>
    ) : d.file ? (
      <OpenFile props={props} of={{ deliverableId: d.id }} />
    ) : null,
    sections: [
      [
        "Comments",
        <Thread key={d.id} props={props} on={{ deliverableId: d.id }} comments={d.comments} />,
      ],
    ],
  } satisfies RecordExtras;
};

/** The contract opens to read and sign; the setup fee, its invoice. */
export const paperExtras: Extras = (_, { row, team }) => {
  const id = String(row.id);
  const open = row.state === "sign" || row.state === "pay";
  return {
    lead: id.startsWith("c") ? (
      <ButtonLink
        href={at("contract", { e: id.slice(1) })}
        tone={open && !team ? "primary" : "secondary"}
        className={START}
        size="sm"
        arrow
      >
        {open && !team ? "Read and sign" : "Read it"}
      </ButtonLink>
    ) : id.startsWith("f") ? (
      <ButtonLink href="/account/billing" tone="secondary" size="sm" arrow className={START}>
        Billing
      </ButtonLink>
    ) : null,
  } satisfies RecordExtras;
};
