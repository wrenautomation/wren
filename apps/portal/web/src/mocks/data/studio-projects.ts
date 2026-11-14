/** Studio's Projects desk (`VideoProjectDesk/wren`): synthetic projects, one per stage. */
import type { Project } from "@wren/starling-studio/projects";
import { ago } from "./shell.js";

const base = { inspiration: [], subjects: {}, folder: null, by: "agent:claude", edit: null };

export const PROJECTS: Project[] = [
  {
    ...base,
    id: 3,
    title: "I built an agent that edits my videos while I sleep, and here is every part of it",
    kind: "long",
    brief:
      "The meta video. Open on the finished edit, then walk back through each stage: the outlier it came from, the script, the edit, the numbers.",
    inspiration: [
      { kind: "post", ref: "x:1870001", why: "the pace of the first 10 s" },
      { kind: "canon", ref: "web-roma-launch" },
    ],
    subjects: { hook: 2 },
    at: ago(0.2),
    updatedAt: ago(0.1),
  },
  {
    ...base,
    id: 2,
    title: "Autobrowse demo",
    kind: "demo",
    brief: "",
    edit: { id: 41, title: "Autobrowse demo, take 2", state: "rendered" },
    at: ago(3),
    updatedAt: ago(1),
  },
  {
    ...base,
    id: 1,
    title: "Three hooks for the reactivation offer",
    kind: "ad",
    brief: "One recording: three hooks, one body, two CTAs.",
    edit: { id: 37, title: "Reactivation ad shoot", state: "uploaded" },
    at: ago(9),
    updatedAt: ago(6),
  },
];

let next = 4;
export const STUDIO_ANSWERS = {
  "console/call:VideoProjectDesk.list": { projects: PROJECTS },
  "console/call:VideoProjectDesk.add": (body: Record<string, unknown>) => {
    const input = body.input as { title: string; kind?: Project["kind"] };
    const project: Project = {
      ...base,
      id: next++,
      title: input.title,
      kind: input.kind ?? "long",
      brief: "",
      at: ago(0),
      updatedAt: ago(0),
    };
    PROJECTS.unshift(project);
    return { project };
  },
};
