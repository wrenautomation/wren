/**
 * Screen videos of web pages, made in code: `openRecorder` walks a page while
 * the browser streams frames, `encode` turns the frames into an mp4 and a
 * poster. Knows nothing of leads, clients or products; a product writes the
 * walk.
 */
export { type Encoded, type EncodeOptions, encode, encodeArgs } from "./encode.js";
export { type Card, DEFAULT_LOOK, type Look } from "./overlay.js";
export { openRecorder, Recorder, type RecorderOptions, type ZoomOptions } from "./recorder.js";
export {
  type Caption,
  checkZooms,
  concatList,
  type Frame,
  type Recording,
  type Zoom,
  zoomExpressions,
} from "./timeline.js";
