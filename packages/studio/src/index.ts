/**
 * The video editor (designs/2026-10-06-video-editor.md): OBS recordings in, whisper.cpp words,
 * trusted silence cuts, ffmpeg cut pass, Remotion composition. Only the CLI imports this; the
 * worker never does (Remotion must stay out of what it bundles).
 */
export {
  CUT_DEFAULTS,
  type CutKnobs,
  type CutRow,
  cutKnobsSchema,
  fitWords,
  fromCutTime,
  keepSegments,
  reviewCuts,
} from "./cuts.js";
export {
  addVideo,
  cutKnobs,
  editPatchSchema,
  getEdit,
  keepCut,
  redoSilence,
  setCutKnobs,
  setEdit,
  setFiles,
  setLook,
  twelvelabsMinutes,
} from "./edit.js";
export {
  cutTranscript,
  geminiLooker,
  LOOK_PROVIDERS,
  type Looker,
  type LookProvider,
  TL_FREE_MINUTES,
  toRaw,
  twelvelabsFind,
  twelvelabsLooker,
} from "./look.js";
export { cutTracks, FPS, proxy360 } from "./media.js";
export { type LongProps, longProps } from "./props.js";
export { openStudio, renderStill } from "./remotion.js";
export * from "./schema.js";
