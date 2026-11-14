/**
 * Studio (designs/2026-11-13-studio-suite.md): one app that holds a video from the idea to live
 * numbers. Opens by itself until he moves it into Wren (`|`). Wren's team only.
 */
import type { Module } from "../../module.js";
import { OutliersPage } from "../canon/outliers.js";
import { MARKETING_PAGES } from "../marketing/pages.js";
import { EditPage } from "./edit.js";
import { ProjectsPage } from "./projects.js";

// the drafts list, as a tab of its own
const publishOf = ({ hidden: _h, lights: _l, ...page }: typeof MARKETING_PAGES.drafts) => page;

const STUDIO_STAMP = "/studio-icon.svg";

export const studio: Module = {
  id: "studio",
  name: "Studio",
  icon: "video",
  blurb: "Every video from the idea to live numbers: projects, inspiration, the edit, publishing.",
  requires: { audience: "team" },
  apart: { stamp: STUDIO_STAMP, default: true },
  pages: [
    {
      id: "projects",
      label: "Projects",
      about: "Every video from the idea on: its stage, what waits on you. Start one here.",
      Page: ProjectsPage,
      wide: true,
    },
    {
      id: "inspiration",
      label: "Inspiration",
      about: "Posts of tracked creators that beat their own usual draw, best multiple first.",
      Page: OutliersPage,
      wide: true,
    },
    {
      id: "edit",
      label: "Edit",
      about: "A project's edit in Finish, or any recording.",
      Page: EditPage,
      wide: true,
    },
    {
      ...publishOf(MARKETING_PAGES.drafts),
      id: "publish",
      label: "Publish",
      about: "Every post draft: edit it, approve it, it goes out.",
    },
  ],
};
