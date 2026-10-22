/**
 * Wren's component kit: the lander's look as React pieces. A foundation, so it knows no product;
 * each product maps its own data onto these props. Styles are Tailwind classes over the `--ui-`
 * tokens in `@wren/ui/tailwind.css`; every token is one a Theme can set (theme.tsx).
 */
export { type Access, can, canAt, type Viewer } from "./access.js";
export {
  AccountBadge,
  AccountFilter,
  AccountPicker,
  accountFieldOf,
  accountState,
} from "./accounts.js";
export {
  type Action,
  type Call,
  type Copied,
  callOnce,
  copiedIn,
  copyAndOpen,
  type FormField,
  holdWithUndo,
  Runner,
  say,
  Toasts,
  useHeld,
  useLastWrite,
} from "./action.js";
export {
  Browser,
  type BrowserFolder,
  BrowserRow,
  folderTree,
} from "./browser.js";
export { Busy, BusyBox, type BusySize, Ring } from "./busy.js";
export { BarsChart, type BarsRow, ColumnsChart, Sparkline, TrendChart } from "./charts/index.js";
export { Input } from "./components/ui/input.js";
export { Textarea } from "./components/ui/textarea.js";
export {
  Button,
  ButtonLink,
  type ButtonTone,
  Check,
  Checks,
  Seg,
  Tag,
  type TagTone,
  Track,
} from "./controls.js";
export { COPIED_MS, CodeBlock, Copyable, CopyButton, useCopy } from "./copy.js";
export {
  moved,
  type PinLine,
  PinnedRow,
  type Pref,
  RAIL_PREF,
  type RailPref,
  togglePin,
  usePref,
} from "./customize.js";
export {
  cachedOf,
  dropCached,
  dropLocalCopy,
  EDITS,
  type Edit,
  EditConflict,
  type EditConflictState,
  type EditOptions,
  Edits,
  FOCUS_STALE_MS,
  focusManager,
  indexedStore,
  indicatorOf,
  type KeyValue,
  keyOf,
  type LocalCopy,
  listChanged,
  nameScope,
  onlineManager,
  QUERIES,
  readCached,
  readTogether,
  refreshAll,
  refreshing,
  type SendLine,
  SendStatus,
  sendLineOf,
  stampOf,
  startLocalCopy,
  tellTabsLanded,
  UnsavedMark,
  useEdit,
  useWritesState,
  WritesIndicator,
} from "./data/index.js";
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
  DISPLAY,
  DISPLAY_PREF,
  type Display,
  LOOK_PREF,
  readDisplay,
} from "./display.js";
export {
  type DraftEditor,
  type DraftEditorProps,
  DraftText,
  type DraftTurnLine,
  DraftTurns,
  type RecordDraft,
  useDraftText,
} from "./draft.js";
export { answerIn } from "./draft-save.js";
export {
  AccountField,
  CheckField,
  ChecksField,
  centsOf,
  changedFrom,
  DateField,
  type EditForm,
  type EditFormOptions,
  FIELD_CLASS,
  FormKept,
  forgetKept,
  MoneyField,
  RadioField,
  SELECT_CLASS,
  SelectField,
  TextAreaField,
  TextField,
  useEditForm,
} from "./edit-form.js";
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
  dateTip,
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
export { FoldList, FoldPreview, foldOf } from "./fold.js";
export { RecordForm } from "./form.js";
export { ago, cx, hostOf, initials, money, month, num, soon } from "./format.js";
export {
  type DisplayControl,
  DisplayPanel,
  FRAME_KEYS,
  Key,
  type KeyLine,
  KeyList,
  type KeySection,
  KeysSheet,
  LIST_KEYS,
  showKeys,
  useDisplay,
  useFrame,
  usePageKeys,
} from "./frame.js";
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
  RIBBON,
  ribbonMax,
  ribbonWidth,
  type Touch,
  wireLines,
} from "./graph/index.js";
export {
  FLOAT_PANEL,
  PaletteDrawer,
  type PaletteEntry,
  type PaletteGroup,
  PanelBlock,
} from "./graph/palette.js";
export { type HandlerCall, HandlerForm } from "./handler.js";
export { type TipOptions, type TipProps, tipProps, whenTip } from "./hint.js";
export { HintLayer, Why } from "./hint-layer.js";
export {
  HOVER_CLOSE_MS,
  HOVER_OPEN_MS,
  type HoverPop,
  SUB_OPEN_MS,
  typingInPopup,
  useHoverPop,
  useHovers,
  useSubmenus,
} from "./hover-pop.js";
export { Icon, type IconName, isIconName } from "./icons.js";
export { AppCard, AppGlance, AppGrid, type GlanceFigure } from "./launcher.js";
export {
  ABOUT,
  AboutProvider,
  Fieldset,
  FLAT_HEAD,
  FRAME,
  FRAME_BODY,
  FRAME_HEAD,
  GROUP_LABEL,
  PAGE_TITLE,
  PageHeader,
  PageTitle,
  SECTION_TITLE,
  Section,
  useAbout,
} from "./layout.js";
export { Lineage, type LineageVersion } from "./lineage.js";
export {
  type KeepApi,
  type SavedViewLine,
  TAB,
  tabTone,
  useNarrow,
} from "./list-bar.js";
export {
  LIST_FORMS,
  LIST_SEARCH,
  type ListSearch,
  type ListState,
  listChange,
  listStateOf,
  paramsOf,
  searchOf,
} from "./list-search.js";
export { type Look, LookEditor, lookOf, ThemeGallery } from "./look.js";
export {
  hostMark,
  lineColor,
  markName,
  PlatformMark,
  PlatformTile,
  StageSquare,
  TintSwatch,
  tintColor,
  tintWash,
} from "./marks.js";
export { EASE, FADE, MOVE, RingSlot, SPRING } from "./motion.js";
export {
  type OverviewProps,
  type OverviewQueue,
  type OverviewTile,
  type OverviewTop,
  RecordOverview,
  TopRecords,
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
export type { PeekLine, PeekSpec } from "./peek.js";
export { BottomSheet, type Segment, Segmented, SwipeRow, type Swipes } from "./phone.js";
export { runs as tabRuns } from "./phone-nav.js";
export { usePhone } from "./phone-shell.js";
export {
  DeviceFrame,
  FeedPost,
  type MessageKind,
  MessagePreview,
  PHONE as PHONE_WIDTH,
  shapeOf,
} from "./preview.js";
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
  detailPatch,
  patchRecord,
  recordPatch,
  type Twin,
  twinRecord,
} from "./record-patch.js";
export {
  type ActPatch,
  type EntryKeep,
  type Load,
  type Needs,
  Panel as RecordPanel,
  type PeekWire,
  type Place,
  pageAskOf,
  prefetchList,
  pressAct,
  type RecordAct,
  type RecordActs,
  type RecordExtras,
  RecordList,
  RecordPage,
  type RecordSource,
  type RecordsApi,
  type RecordTemplateProps,
  type ShopSections,
  TierLabel,
  useLoad,
  useTypes,
  waitsOn,
} from "./records.js";
export { type LocalRecords, localRecords } from "./records-local.js";
export { RowActions, rowActsOf } from "./row-acts.js";
export {
  Age,
  avatarOf,
  drawnOf,
  KIND_ICON,
  Pill,
  Rows,
  type RowsAct,
  type RowsColumn,
  type RowsLine,
  type RowsName,
  type RowsPick,
  type RowsProps,
  type RowsWait,
  stateColor,
  statsOf,
  type WaitStats,
} from "./rows.js";
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
  ACTIONS,
  type Conflict,
  conflictOf,
  type Failure,
  failureKind,
  LATEST,
  Latest,
  type Patch,
  type PressOptions,
  patchedSince,
  type Retry,
  recordKey,
  SAVE_DELAY_MS,
  type SaveAnswer,
  SaveConflict,
  type SaveContext,
  type Saved,
  type SaveEnv,
  type SaveFn,
  SavePage,
  Saver,
  type SaverOptions,
  SaveScope,
  type SaveState,
  SaveStatus,
  type SaveStatusName,
  SaveTimeout,
  stableKey,
  statusWords,
  tick,
  useSaved,
  useSavePage,
  type WireState,
  WRITES,
  type Write,
  type WriteHooks,
  type WriteStatus,
  Writes,
  type Wrote,
  writeThrough,
} from "./save/index.js";
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
  type DockItem,
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
export { SplitGhost, SplitPanel, type SplitRow } from "./split.js";
export { HOLD, type JobStep, type StepCard, type StepState, Steps } from "./steps.js";
export { Sweep } from "./sweep.js";
export { RecordSwitch, type SwitchWait } from "./switch-bar.js";
export { TabBar } from "./tab-bar.js";
export {
  cellsOf,
  DataTable,
  FactsTable,
  type ListLine,
  type ListTable,
  type RowAttrs,
  sortingOf,
  TABLE_FEATURES,
  type TableColumn,
  useLines,
  useListTable,
  VIRTUAL_FROM,
} from "./table.js";
export {
  applyTheme,
  BASE,
  dropPreloadedLook,
  isShowcase,
  LOOK_NOTES,
  PRESETS,
  type PresetName,
  readTheme,
  SHOWCASE,
  type ShowcaseName,
  type Theme,
  TOKENS,
  type Token,
  themeVars,
  usePageTheme,
  wholeVars,
} from "./theme.js";
export {
  type MiniLine,
  RecordTimeline,
  TimelineMini,
  type TimelineSpec,
  TimelineSwitch,
} from "./timeline.js";
export {
  orList,
  sayFilter,
  sayFilters,
  sayRaw,
  saySaved,
  saySort,
  sayView,
  sortTip,
} from "./view-says.js";
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
