/**
 * Wren's component kit: the lander's look as React pieces. A foundation, so it knows no product;
 * each product maps its own data onto these props. Styles are Tailwind classes over the `--ui-`
 * tokens in `@wren/ui/tailwind.css`; every token is one a Theme can set (theme.tsx).
 */
export { type Access, can, canAt, type Viewer } from "./access.js";
export {
  type Action,
  type Call,
  type Copied,
  copiedIn,
  copyAndOpen,
  type FormField,
  say,
  Toasts,
} from "./action.js";
export {
  Browser,
  type BrowserFolder,
  BrowserRow,
  folderTree,
} from "./browser.js";
export { BarsChart, type BarsRow, Sparkline, TrendChart } from "./charts/index.js";
export { Input } from "./components/ui/input.js";
export { Textarea } from "./components/ui/textarea.js";
export { Button, ButtonLink, type ButtonTone, Tag, type TagTone } from "./controls.js";
export { COPIED_MS, CodeBlock, Copyable, CopyButton, useCopy } from "./copy.js";
export {
  moved,
  type PinLine,
  PinnedRow,
  RAIL_PREF,
  type RailPref,
  togglePin,
  usePref,
} from "./customize.js";
export { Facts, Settings } from "./data.js";
export { type DaySource, RecordDay } from "./day.js";
export {
  DICTATE_KEYS,
  Dictate,
  type DictateEvents,
  DictateField,
  type DictateHandle,
  type DictatePhase,
  type DictateStatus,
  type DictationEngine,
  DictationProvider,
  useDictateStatus,
} from "./dictate.js";
export { joinDictated } from "./dictate-text.js";
export { Diff, pairsOf } from "./diff.js";
export {
  type DraftEditor,
  type DraftEditorProps,
  DraftText,
  type DraftTurnLine,
  DraftTurns,
  type RecordDraft,
  useDraftText,
} from "./draft.js";
export {
  Alert,
  Callout,
  Empty,
  failureOf,
  InDevelopment,
  LoadFailed,
  Loading,
  ShowRawErrors,
} from "./feedback.js";
export {
  type CiteTo,
  Cue,
  cueOf,
  dateOf,
  exact,
  FieldCell,
  FieldFilter,
  FieldLine,
  FieldTotal,
  filterParts,
  filterShape,
  readFilter,
  relative,
  StateMark,
  wilson,
} from "./fields.js";
export {
  type Box,
  edgePath,
  type FlowAxis,
  type FlowEdge,
  type FlowGraph,
  type FlowNode,
  type FlowStep,
  flowOf,
} from "./flow.js";
export { type FlowEdit, FlowMap, type MapBox } from "./flow-map.js";
export { RecordForm } from "./form.js";
export { ago, cx, hostOf, initials, money, month, num, soon } from "./format.js";
export {
  edgeId,
  GRAPH_DROP,
  Graph,
  type GraphDot,
  type GraphEdge,
  type GraphEdit,
  type GraphKind,
  type GraphMark,
  type GraphNode,
  type GraphNumber,
  type GraphPort,
  type GraphProps,
  type GraphRole,
  type GraphTone,
  Journey,
  journeyOf,
  percent,
  type Touch,
  wireLines,
} from "./graph/index.js";
export { type HandlerCall, HandlerForm } from "./handler.js";
export { Icon, type IconName } from "./icons.js";
export { AppCard, AppGlance, AppGrid, type GlanceFigure } from "./launcher.js";
export {
  Fieldset,
  FRAME,
  FRAME_BODY,
  FRAME_HEAD,
  GROUP_LABEL,
  PAGE_TITLE,
  PageHeader,
  SECTION_TITLE,
  Section,
} from "./layout.js";
export { Lineage, type LineageVersion } from "./lineage.js";
export type { KeepApi, SavedViewLine } from "./list-bar.js";
export { type Look, LookEditor, lookOf } from "./look.js";
export { hostMark, markName, PlatformMark, TintSwatch, tintColor, tintWash } from "./marks.js";
export {
  type OverviewProps,
  type OverviewTile,
  type OverviewTop,
  RecordOverview,
} from "./overview.js";
export type { PaletteItem } from "./palette.js";
export {
  type BrandInput,
  brandColorsOf,
  brandTheme,
  CONTRASTS,
  type ContrastLine,
  HARMONIES,
  type Harmony,
  readBrand,
  VARIANTS,
  type Variant,
} from "./palette-brand.js";
export { type Scope, type ScopeItem, useScope } from "./palette-scope.js";
export { DeviceFrame, type MessageKind, MessagePreview, shapeOf } from "./preview.js";
export { RecordQueue } from "./queue.js";
export { RAIL_STATES, Rail, type RailGroup, type RailState, type RailStep } from "./rail.js";
export {
  ReadAloud,
  type ReadEvents,
  type ReadHandle,
  type ReadingEngine,
  ReadingProvider,
  type ReadPhase,
  type ReadStatus,
  useReadAloud,
  useReadStatus,
} from "./read-aloud.js";
export { type AccessApi, type IssueLine, rowTarget } from "./record-access.js";
export {
  Panel as RecordPanel,
  type Place,
  type RecordAct,
  type RecordActs,
  type RecordExtras,
  RecordList,
  RecordPage,
  type RecordSource,
  type RecordsApi,
  type RecordTemplateProps,
  type ShopSections,
  useLoad,
  useTypes,
} from "./records.js";
export { type LocalRecords, localRecords } from "./records-local.js";
export {
  dwellOf,
  expectedOf,
  mixOf,
  RUN_DWELL,
  RUN_MAX_SPEEDUP,
  type RunEnd,
  type RunFocus,
  type RunLine,
  type RunLineKind,
  type RunMix,
  type RunStep,
  type RunStepState,
  type RunStepView,
  RunView,
  stepsAt,
} from "./run.js";
export {
  NOT_SET,
  type SettingField,
  type SettingRow,
  settingRows,
  settingText,
} from "./settings.js";
export {
  AppShell,
  type Brand,
  Gate,
  type NavApp,
  type NavArea,
  type NavHome,
  type NavItem,
  type OpenApp,
  type RailPins,
  type Workspace,
  type WorkspaceOption,
} from "./shell.js";
export { RecordShop } from "./shop.js";
export {
  FavoriteStar,
  InsertSnippet,
  type SnippetLine,
  SnippetsProvider,
  type SnippetsSource,
  useFavorites,
  useSnippets,
} from "./snippets.js";
export {
  Cite,
  Cited,
  MARKS,
  marksOf,
  type PickSource,
  SourceCard,
  SourceList,
  SURE_LEVELS,
  Sure,
  type SureLevel,
  stripMarks,
  Traced,
  Trail,
  type TrailStep,
  useSourcePick,
} from "./sources.js";
export { RecordSwitch, type SwitchWait } from "./switch-bar.js";
export {
  applyTheme,
  PRESETS,
  type PresetName,
  readTheme,
  type Theme,
  TOKENS,
  type Token,
  themeVars,
  usePageTheme,
} from "./theme.js";
export {
  PageChip,
  type RunWork,
  type RunWorkFact,
  type RunWorkIcon,
  type RunWorkLink,
  type RunWorkStep,
  RunWorkTrail,
  SiteMark,
} from "./work.js";
