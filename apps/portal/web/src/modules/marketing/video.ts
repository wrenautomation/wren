/**
 * Video row actions: approve (upload to YouTube), privacy, promos and the rest of a recording's life.
 */
import { type Action, said } from "@wren/ui";
import { PROMOTE_CONFIRM, PROMOTE_DONE, PROMOTE_FORM } from "./drafts.js";

/** Who sees an upload (content VIDEO_PRIVACY); blank is private. */
const PRIVACY = {
  field: "privacy",
  label: "Who sees it",
  type: "select",
  options: ["private", "unlisted", "public"],
  optional: true,
  hint: "Blank: private.",
} as const;

/** Approve is his yes: the file uploads to YouTube on the next pass, private unless he picks. */
export const VIDEO_APPROVE: Action = {
  id: "marketing.videoApprove",
  label: "Approve",
  icon: "check",
  handler: "marketing/videoApprove",
  confirm: "Upload the long video to YouTube?",
  key: "a",
  form: [
    PRIVACY,
    {
      field: "replace",
      label: "Upload as a new video",
      type: "switch",
      optional: true,
      hint: "Only when this video is up already and the new cut should replace it.",
    },
  ],
  when: { state: ["rendered"] },
  done: said("Approved. It uploads on the next pass."),
};
export const VIDEO_ACTIONS: Action[] = [
  VIDEO_APPROVE,
  {
    id: "marketing.videoApproveShort",
    label: "Approve a Short",
    icon: "check",
    handler: "marketing/videoApproveShort",
    each: true,
    form: [
      { field: "short", label: "Short", type: "number", hint: "1 is the first Short." },
      PRIVACY,
    ],
    when: { state: ["rendered", "approved", "uploaded"] },
    done: said("Approved. The Short uploads on the next pass."),
  },
  {
    id: "marketing.videoApproveVertical",
    label: "Approve vertical",
    icon: "check",
    handler: "marketing/videoApproveVertical",
    confirm: "Upload the vertical video to YouTube, and draft its Reel for To approve?",
    form: [PRIVACY],
    when: { state: ["rendered", "approved", "uploaded"], vertical: ["yes"] },
    done: said("Approved. It uploads on the next pass; its Reel waits in To approve."),
  },
  {
    id: "marketing.videoThumbnail",
    label: "Pick thumbnail",
    icon: "image",
    handler: "marketing/videoThumbnail",
    each: true,
    form: [{ field: "n", label: "Thumbnail", type: "select", options: ["1", "2", "3"] }],
    when: { state: ["rendered", "approved"] },
    done: said("Picked. It goes up with the video."),
  },
  {
    id: "marketing.videoPromote",
    label: "Promote",
    icon: "megaphone",
    handler: "marketing/videoPromote",
    confirm: PROMOTE_CONFIRM,
    each: true,
    form: PROMOTE_FORM,
    when: { state: ["approved", "uploaded"] },
    done: PROMOTE_DONE,
  },
  {
    id: "marketing.videoSchedule",
    label: "Schedule",
    icon: "reschedule",
    handler: "marketing/videoSchedule",
    confirm: "Upload it now, private, and make it public then?",
    form: [
      { field: "day", label: "Day", type: "date" },
      { field: "time", label: "Time", hint: "Your time, like 15:00. Blank: 9:00.", optional: true },
    ],
    when: { state: ["rendered"] },
    done: said("Scheduled. It uploads private on the next pass and goes public then."),
  },
  {
    id: "marketing.videoReject",
    label: "Reject",
    icon: "close",
    handler: "marketing/videoReject",
    form: [{ field: "note", label: "Why", type: "long", optional: true }],
    when: { state: ["added", "edited", "rendered"] },
    done: said("Rejected. Its files stay; Bring back undoes it."),
  },
  {
    id: "marketing.videoRestore",
    label: "Bring back",
    icon: "undo",
    handler: "marketing/videoRestore",
    form: [],
    when: { state: ["rejected"] },
    done: said("Back. It waits on you again."),
  },
  {
    id: "marketing.videoRender",
    label: "Render",
    icon: "retry",
    handler: "marketing/videoRender",
    key: "r",
    confirm:
      "Cut and render it on the Mac? It takes a few minutes, and waits while the Mac is off.",
    when: { state: ["added", "edited", "rendered"] },
    done: said("Queued. The Mac renders it; it waits while the Mac is off."),
  },
  {
    id: "marketing.videoRenderAgain",
    label: "Render again",
    icon: "retry",
    handler: "marketing/videoRenderAgain",
    confirm:
      "Render every part again, even the ones that haven't changed? It takes longer than Render.",
    when: { state: ["added", "edited", "rendered"] },
    done: said("Queued. The Mac renders it all again; it waits while the Mac is off."),
  },
  {
    id: "marketing.videoRenderPart",
    label: "Render one part",
    icon: "retry",
    handler: "marketing/videoRenderPart",
    confirm: "Render just this part on the Mac? It waits while the Mac is off.",
    form: [
      {
        field: "only",
        label: "Part",
        type: "select",
        options: ["long", "vertical", "square", "portrait", "shorts", "thumbs"],
        labels: {
          long: "Long video",
          vertical: "Vertical",
          square: "Square",
          portrait: "Portrait",
          shorts: "Shorts",
          thumbs: "Thumbnails",
        },
      },
    ],
    when: { state: ["added", "edited", "rendered", "approved"] },
    done: said("Queued. The Mac renders that part; it waits while the Mac is off."),
  },
  {
    id: "marketing.videoSwap",
    label: "Use new render",
    icon: "retry",
    handler: "marketing/videoSwap",
    confirm: "Point the approved Shorts that aren't out yet at the new render?",
    form: [
      {
        field: "short",
        label: "Short",
        type: "number",
        optional: true,
        hint: "Blank: every approved Short. 1 is the first.",
      },
    ],
    when: { state: ["rendered", "approved", "uploaded"] },
    done: (a) => {
      const r = a as { swapped?: number; missing?: number };
      const n = r.swapped ?? 0;
      return n
        ? `${n} Short${n === 1 ? "" : "s"} now use${n === 1 ? "s" : ""} the new render.`
        : "Nothing to change: no approved Short waits.";
    },
  },
  // The page's editor runs these from inside the detail (videos.tsx), never from the head.
  ...(
    [
      ["videoSet", "Save"],
      ["videoCut", "Cut"],
      ["videoAsk", "Ask Claude"],
      ["videoUndo", "Undo"],
      ["videoWords", "Fix word"],
      ["videoLine", "Fix caption"],
      ["videoAgent", "Ask for changes"],
      ["videoStress", "Propose stressed words"],
      ["videoPunctuate", "Add punctuation"],
      ["videoPropose", "Propose change"],
    ] as const
  ).map(([id, label]) => ({
    id: `marketing.${id}`,
    label,
    handler: `marketing/${id}`,
    inline: true as const,
  })),
];
