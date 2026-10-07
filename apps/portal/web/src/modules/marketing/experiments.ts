/**
 * Marketing → Experiments (`marketing.experiment`): a site flag with a goal. Start and Ship put a
 * variant live on the public site, so they're William's; the shares move by themselves between.
 */
import type { Action } from "@wren/ui";

export const EXPERIMENT_ACTIONS: Action[] = [
  {
    id: "marketing.experimentAdd",
    label: "New experiment",
    handler: "console/experimentAdd",
    form: [
      {
        field: "flag",
        label: "Flag",
        hint: "A site flag whose variants are on the page as data-flag markup.",
      },
      {
        field: "goal",
        label: "Goal",
        type: "select",
        options: ["forms", "calls", "paid"],
        optional: true,
      },
    ],
    done: () => "Added as a draft. Nothing changes on the site until Start.",
  },
  {
    id: "marketing.experimentStart",
    label: "Start",
    handler: "console/experimentStart",
    confirm: "Start? Visitors to the site begin seeing every variant, in even shares.",
    bulk: true,
    done: () => "Started",
  },
  {
    id: "marketing.experimentShip",
    label: "Ship the best",
    handler: "console/experimentShip",
    confirm: "Ship? Every visitor gets the best variant from now on.",
    bulk: true,
    done: () => "Shipped. Remove the other variants' markup in a lander commit.",
  },
  {
    id: "marketing.experimentStop",
    label: "Stop",
    handler: "console/experimentStop",
    confirm: "Stop? The flag's own rules pick again.",
    bulk: true,
    done: () => "Stopped",
  },
  {
    id: "marketing.experimentRemove",
    label: "Delete",
    handler: "console/experimentRemove",
    confirm: "Delete this experiment? The flag and its counts stay.",
    bulk: true,
    done: () => "Deleted",
  },
];
