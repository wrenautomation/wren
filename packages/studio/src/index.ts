/**
 * The video editor (designs/2026-10-06-video-editor.md): OBS recordings in, whisper.cpp words,
 * trusted silence cuts, ffmpeg cut pass, Remotion composition. Only the CLI imports this; the
 * worker never does (Remotion must stay out of what it bundles).
 */

export { CAP_RECORDINGS, capNotReady, capTracks, findCapProjects, isCap } from "./cap.js";
export {
  bigWordState,
  CAPTION_STYLES,
  type CaptionStyle,
  type Captions,
  isCaptionStyle,
  wordState,
} from "./caption-styles.js";
export { type Line, lineAt, pages, phrases, REEL, reelLines } from "./captions.js";
export {
  CUT_DEFAULTS,
  type CutKnobs,
  type CutRow,
  cutKnobsSchema,
  fitWords,
  fromCutTime,
  keepSegments,
  onCut,
  reviewCuts,
  toCutTime,
} from "./cuts.js";
export {
  addVideo,
  cutKnobs,
  editPatchSchema,
  formatsFor,
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
  setStress,
  setStudioWords,
  setWords,
  stressOnCut,
  studioWords,
  twelvelabsMinutes,
  type WordsFix,
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
export {
  applyFilter,
  LOUDNESS,
  type Loudness,
  measureFilter,
  measureLoudness,
  normalizeLoudness,
  parseLoudnorm,
} from "./loudness.js";
export {
  editMattes,
  ensureModel,
  MATTE,
  type MattePlan,
  type MatteWindow,
  MODEL,
  makeMattes,
  matteFile,
  type Pick,
  planMattes,
} from "./matte.js";
export { cutSize, cutTracks, FPS, portrait, preview, proxy360, scaleFilter } from "./media.js";
export { findRecordings, isOpen, obsRecordingDir } from "./obs.js";
export {
  type BehindWord,
  type LongProps,
  longProps,
  type Matte,
  SHORT_COUNT,
  SHORT_S,
  type ShortProps,
  shortProps,
  type ThumbnailProps,
  thumbnailProps,
  type VerticalProps,
  verticalProps,
  verticalWindow,
} from "./props.js";
export { openStudio, type RenderJob, renderAll, renderStill, renderStills } from "./remotion.js";
export * from "./schema.js";
export {
  checkStress,
  parseStress,
  proposeStress,
  remapStress,
  STRESS,
  spaceStress,
  stressPrompt,
  wordAt,
} from "./stress.js";
export { fixWordAt, fixWords } from "./words.js";
