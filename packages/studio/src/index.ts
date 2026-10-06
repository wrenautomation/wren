/**
 * The video editor (designs/2026-10-06-video-editor.md): OBS recordings in, whisper.cpp words,
 * trusted silence cuts, ffmpeg cut pass, Remotion composition. Only the CLI imports this; the
 * worker never does (Remotion must stay out of what it bundles).
 */

export { CAP_RECORDINGS, capNotReady, capTracks, findCapProjects, isCap } from "./cap.js";
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
  setCut,
  setCutKnobs,
  setEdit,
  setFiles,
  setLook,
  setRender,
  setRendered,
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
export { cutTracks, FPS, preview, proxy360 } from "./media.js";
export { findRecordings, isOpen, obsRecordingDir } from "./obs.js";
export {
  type LongProps,
  longProps,
  SHORT_COUNT,
  SHORT_S,
  type ShortProps,
  shortProps,
  type ThumbnailProps,
  thumbnailProps,
} from "./props.js";
export { openStudio, type RenderJob, renderAll, renderStill } from "./remotion.js";
export * from "./schema.js";
