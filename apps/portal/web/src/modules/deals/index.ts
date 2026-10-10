/**
 * Opportunities (designs/2026-10-09-opportunities.md): deals in pipelines of stages. The board
 * moves them; the list keeps saved views; Pipelines edits the stages. One app in Wren's
 * workspace and each client's. A move sends nothing: a workflow that hears it decides.
 */
import type { Action } from "@wren/ui";
import type { Module } from "../../module.js";
import { DealBoard } from "./board.js";
import { Pipelines } from "./pipelines.js";

const OPEN = { status: ["open"] };

/** The deal's own fields: New deal's form and Edit's. */
const FIELDS = [
  { field: "name", label: "Deal", hint: "A firm, a job, a quote" },
  { field: "value", label: "Value", optional: true, hint: "In dollars, like 1200" },
  { field: "contactName", label: "Contact", optional: true },
  { field: "contactEmail", label: "Email", optional: true },
  { field: "contactPhone", label: "Phone", optional: true },
  { field: "owner", label: "Who works it", optional: true, hint: "Their email" },
  { field: "nextOn", label: "Follow up on", type: "date", optional: true },
  { field: "note", label: "Note", type: "long", optional: true },
] as const;

export const NEW_DEAL: Action = {
  id: "deals.create",
  label: "New deal",
  handler: "deals/create",
  form: FIELDS,
  done: () => "Added to the first stage.",
};

export const DEAL_ACTIONS: Action[] = [
  NEW_DEAL,
  {
    id: "deals.won",
    label: "Mark won",
    handler: "deals/won",
    when: OPEN,
    sets: { status: "won" },
    key: "w",
    bulk: true,
    done: () => "Marked won.",
  },
  {
    id: "deals.lost",
    label: "Mark lost",
    handler: "deals/lost",
    when: OPEN,
    sets: { status: "lost" },
    key: "l",
    bulk: true,
    done: () => "Marked lost.",
  },
  {
    id: "deals.assign",
    label: "Assign",
    handler: "deals/assign",
    form: [{ field: "owner", label: "Who works it", optional: true, hint: "Their email" }],
    bulk: true,
    done: () => "Assigned.",
  },
  {
    id: "deals.edit",
    label: "Edit",
    handler: "deals/edit",
    each: true,
    // Only what's typed changes: a box left empty keeps its value.
    form: FIELDS.map((f) => ({ ...f, optional: true as const })),
    key: "e",
    done: () => "Saved.",
  },
  {
    id: "deals.delete",
    label: "Delete",
    handler: "deals/remove",
    confirm: "Delete these deals and their history? This can't be undone.",
    bulk: true,
    done: () => "Deleted.",
  },
];

/** A client's Opportunities, in its own workspace: its own deals and pipelines. */
export const clientDeals: Module = {
  id: "deals",
  name: "Opportunities",
  component: "deals.board",
  icon: "target",
  blurb: "Every deal by stage, with its value and who works it. Drag one on when it moves.",
  pages: [
    { id: "board", label: "Board", Page: DealBoard, wide: true },
    {
      id: "deals",
      label: "Deals",
      template: "list",
      record: "deals.deal",
      empty: {
        open: "No open deals. Add one with New deal.",
        mine: "No open deals are yours.",
        due: "No follow-up is due.",
        stale: "Nothing has sat in a stage 14 days.",
        won: "No deal is won yet.",
        lost: "No deal is lost.",
        all: "No deals yet. Add one with New deal.",
      },
      actions: DEAL_ACTIONS,
      columns: [
        "name",
        "stageLabel",
        "value",
        "flag",
        "contactName",
        "owner",
        "nextOn",
        "daysInStage",
        "pipelineName",
        "movedAt",
      ],
    },
    { id: "pipelines", label: "Pipelines", Page: Pipelines },
  ],
};

/** Wren's own Opportunities, in Wren's workspace: the same pages on Wren's deals. */
export const deals: Module = {
  ...clientDeals,
  blurb: "Wren's own deals by stage: who's quoted, who's won, who needs a follow-up.",
  requires: { audience: "team" },
};
