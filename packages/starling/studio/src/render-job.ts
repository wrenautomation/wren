/** What `frames/render.ts` takes as its job file. Types only: both sides of the spawn read it. */

export type RenderOutput = { composition: string; props: unknown; out: string } & (
  | { kind: "video"; bitrate: string }
  | { kind: "still"; frame: number; format: "png" | "jpeg"; quality?: number }
);

export type RenderScriptJob = {
  /** The edit's folder: every file the props name is inside it. */
  dir: string;
  outputs: RenderOutput[];
  /** Serve output 0 as a live page with a scrubber, open it, run until Ctrl-C. */
  preview?: boolean;
  ffmpeg?: string;
};
