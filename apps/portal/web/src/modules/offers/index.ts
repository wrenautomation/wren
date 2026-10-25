/**
 * Offers (designs/2026-10-19-portal-reshape.md): each offer Wren sells, its versions, and the
 * terms it sells on. Terms are append-only: "Propose version" adds the next version of a plan
 * from a date. Nobody fills the terms for him; the form asks for the JSON.
 */
import { OFFERS } from "@wren/offers";
import type { Action } from "@wren/ui";
import { createElement } from "react";
import type { ListPage, Module } from "../../module.js";

const OPEN = OFFERS.filter((o) => o.status !== "retired");

/** A version of an offer, as its detail reads it (`pipeline.offer` `load`). */
interface OfferVersion {
  number: number;
  hash: string;
  why: string | null;
  at: string;
  by: string | null;
}

const day = (at: string) => String(at).slice(0, 10);

/** The offer's versions under its fields, newest first: what changed and why. */
const offerExtras: NonNullable<ListPage["extras"]> = (detail) => {
  const versions = (detail as { versions?: OfferVersion[] } | null)?.versions ?? [];
  if (!versions.length) return {};
  return {
    sections: [
      [
        "Versions",
        createElement(
          "ul",
          { className: "grid gap-1 text-[13px]" },
          versions.map((v) =>
            createElement(
              "li",
              { key: v.number },
              `v${v.number}, ${day(v.at)}${v.by ? `, ${v.by}` : ""}${v.why ? `: ${v.why}` : ""}`,
            ),
          ),
        ),
      ],
    ],
  };
};

/** A terms version's body, as stored. */
const termsExtras: NonNullable<ListPage["extras"]> = (detail) => {
  const body = (detail as { body?: unknown } | null)?.body;
  if (!body) return {};
  return {
    sections: [
      [
        "Terms body",
        createElement(
          "pre",
          { className: "overflow-x-auto text-[12px]" },
          JSON.stringify(body, null, 2),
        ),
      ],
    ],
  };
};

const TERMS_ACTIONS: Action[] = [
  {
    id: "pipeline.termsAdd",
    label: "Propose version",
    handler: "pipeline/termsAdd",
    form: [
      {
        field: "offer",
        label: "Offer",
        type: "select",
        options: OPEN.map((o) => o.id),
        labels: Object.fromEntries(OPEN.map((o) => [o.id, o.name])),
      },
      { field: "plan", label: "Plan", hint: "A plan with versions already adds the next one." },
      {
        field: "from",
        label: "Effective from",
        type: "date",
        hint: "Not earlier than the plan's last version.",
      },
      {
        field: "body",
        label: "Terms JSON",
        type: "json",
        hint: "The terms body. Checked against the schema when sent.",
      },
      { field: "why", label: "Why", hint: "What changed, in a line." },
    ],
    done: (made) => {
      const m = made as { plan?: string; version?: number };
      return `Added ${m.plan ?? "plan"} version ${m.version ?? ""}`.trim();
    },
  },
];

export const offers: Module = {
  id: "offers",
  name: "Offers",
  component: "pipeline.journeys",
  icon: "briefcase",
  blurb: "Each offer Wren sells, its versions, and the terms it sells on.",
  requires: { audience: "team" },
  pages: [
    {
      id: "all",
      label: "Offers",
      about: "Every offer, its live plans and open journeys, with its versions and terms.",
      template: "list",
      record: "pipeline.offer",
      empty: "No offers yet.",
      extras: offerExtras,
    },
    {
      id: "terms",
      label: "Terms",
      about: "The terms each plan sells on, with a button to propose the next version.",
      template: "list",
      record: "pipeline.terms",
      empty: {
        live: "No terms are live yet.",
        all: "No terms versions yet.",
      },
      actions: TERMS_ACTIONS,
      extras: termsExtras,
    },
  ],
};
