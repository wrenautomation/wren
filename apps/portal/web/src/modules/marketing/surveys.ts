/**
 * Marketing → Surveys (`marketing.survey`): one question, with when and who as words on the row.
 * Go live puts a site survey on the public site, so it's William's; a portal one shows to the
 * client logins it names.
 */
import type { Action } from "@wren/ui";

export const SURVEY_ACTIONS: Action[] = [
  {
    id: "marketing.surveyAdd",
    label: "New survey",
    handler: "console/surveyAdd",
    form: [
      { field: "key", label: "Key", hint: "Lower case, no spaces, like fit or score." },
      { field: "question", label: "Question" },
      { field: "kind", label: "Kind", type: "select", options: ["choice", "scale", "text"] },
      {
        field: "choices",
        label: "Choices",
        type: "long",
        optional: true,
        hint: "One per line, 2 to 8. Only for a choice question.",
      },
      { field: "surface", label: "Where", type: "select", options: ["site", "portal"] },
    ],
    done: () => "Added as a draft. Set when and who on the row, then Go live.",
  },
  {
    id: "marketing.surveyStart",
    label: "Go live",
    handler: "console/surveyStart",
    confirm: "Go live? A site survey starts showing to visitors; a portal one to client logins.",
    bulk: true,
    done: () => "Live",
  },
  {
    id: "marketing.surveyPause",
    label: "Pause",
    handler: "console/surveyPause",
    confirm: "Pause? It stops showing. Answers stay.",
    bulk: true,
    done: () => "Paused",
  },
  {
    id: "marketing.surveyRemove",
    label: "Delete",
    handler: "console/surveyRemove",
    confirm: "Delete this survey and its answers? Pause a live one first.",
    bulk: true,
    done: () => "Deleted",
  },
];
