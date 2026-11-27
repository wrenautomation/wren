/**
 * The kit's named icons: Lucide's (ISC), the one icon vendor (designs/2026-10-11-design-kits.md).
 * Every icon is named here, and only this file imports lucide (biome.json: noRestrictedImports).
 */
import {
  Activity,
  AlignLeft,
  Anchor,
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowDownUp,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  AtSign,
  BadgePercent,
  Bell,
  Bookmark,
  Boxes,
  Briefcase,
  CalendarClock,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Circle,
  CircleAlert,
  CircleCheck,
  CircleDot,
  CircleHelp,
  CircleX,
  ClipboardList,
  Clock,
  Code,
  Columns3,
  Copy,
  DollarSign,
  Download,
  Ellipsis,
  Equal,
  ExternalLink,
  Eye,
  EyeOff,
  Flag,
  Folder,
  FolderInput,
  FolderPlus,
  Gauge,
  Gift,
  GitBranch,
  GitCommitVertical,
  Globe,
  HandCoins,
  Hash,
  Heart,
  History,
  Hourglass,
  ImageIcon,
  Keyboard,
  KeyRound,
  Layers,
  LayoutGrid,
  Link,
  List,
  ListChecks,
  ListPlus,
  Lock,
  LogOut,
  type LucideIcon,
  Maximize,
  Maximize2,
  Menu,
  Merge,
  MessageSquareText,
  Mic,
  Minimize2,
  Minus,
  MousePointerClick,
  Newspaper,
  OctagonX,
  PanelLeft,
  PanelRight,
  PanelTop,
  Paperclip,
  Pause,
  Pencil,
  PenLine,
  Percent,
  PictureInPicture2,
  Pin,
  Play,
  Plus,
  Podcast,
  Presentation,
  Quote,
  RefreshCw,
  Repeat,
  Rocket,
  RotateCcw,
  RotateCw,
  Rows3,
  Rss,
  Send,
  Server,
  Shapes,
  ShieldCheck,
  Smartphone,
  SquareArrowOutUpRight,
  SquareDashed,
  SquarePlus,
  SquareTerminal,
  Star,
  Tag,
  Target,
  ThumbsDown,
  Ticket,
  ToggleLeft,
  Trash2,
  TriangleAlert,
  Trophy,
  Type,
  Upload,
  UserCheck,
  UserPlus,
  UserX,
  Volume2,
  VolumeX,
  X,
  Zap,
} from "lucide-react";
import type { CSSProperties } from "react";
import { brandIcon } from "./brand-icons.js";
import { cx } from "./format.js";

const ICONS = {
  home: brandIcon("home"),
  people: brandIcon("people"),
  mail: brandIcon("mail"),
  shield: ShieldCheck,
  money: brandIcon("money"),
  reply: brandIcon("reply"),
  link: Link,
  pulse: Activity,
  sliders: brandIcon("sliders"),
  play: Play,
  pause: Pause,
  arrow: ArrowRight,
  down: ChevronDown,
  left: ChevronLeft,
  right: ChevronRight,
  close: X,
  check: Check,
  checkCircle: CircleCheck,
  xCircle: CircleX,
  terminal: SquareTerminal,
  star: Star,
  clock: Clock,
  phone: brandIcon("phone"),
  menu: Menu,
  external: ExternalLink,
  search: brandIcon("search"),
  download: Download,
  pin: Pin,
  // Apps: the launcher, and each app's mark.
  apps: LayoutGrid,
  columns: Columns3,
  cycle: RefreshCw,
  flag: Flag,
  board: brandIcon("board"),
  note: brandIcon("note"),
  inbox: brandIcon("inbox"),
  target: Target,
  /** a part of an image, page or frame */
  area: SquareDashed,
  megaphone: brandIcon("megaphone"),
  billboard: Presentation,
  bolt: Zap,
  briefcase: Briefcase,
  calendar: brandIcon("calendar"),
  doc: brandIcon("doc"),
  globe: Globe,
  book: brandIcon("book"),
  chat: brandIcon("chat"),
  sparkle: brandIcon("sparkle"),
  stack: Layers,
  mic: Mic,
  card: brandIcon("card"),
  // Steps and parts: what a run did, a workflow's blocks, a component's mark.
  chart: brandIcon("chart"),
  code: Code,
  edit: Pencil,
  list: List,
  merge: Merge,
  page: brandIcon("page"),
  split: brandIcon("split"),
  wait: Hourglass,
  write: PenLine,
  // A shape's node kinds, and adding and sending files.
  boxes: Boxes,
  dot: CircleDot,
  workflow: brandIcon("workflow"),
  plus: Plus,
  upload: Upload,
  // The frame: the panels, help, keys.
  panel: PanelLeft,
  "panel-top": PanelTop,
  attach: Paperclip,
  help: CircleHelp,
  keys: Keyboard,
  // The Inbox queues' marks (overview E): an issue, a mention, an ask for access.
  alert: CircleAlert,
  at: AtSign,
  key: KeyRound,
  more: Ellipsis,
  // The metro map's marks (metro/): what a person gives, how a flow splits, what a step repeats.
  eye: Eye,
  dollar: DollarSign,
  exit: LogOut,
  shrink: Minimize2,
  percent: Percent,
  approve: UserCheck,
  shared: SquareArrowOutUpRight,
  bot: brandIcon("bot"),
  user: brandIcon("user"),
  undo: RotateCcw,
  branch: GitBranch,
  history: History,
  stop: OctagonX,
  repeat: Repeat,
  // What an offer's money does: cash back, credit to the next offer, a discount, a free part, the
  // offer a buyer compares against.
  cashback: HandCoins,
  credit: Ticket,
  discount: BadgePercent,
  free: Gift,
  anchor: Anchor,
  // A list's column heads, by what the column holds (rows.tsx), and a row's Open chip.
  text: Type,
  hash: Hash,
  building: brandIcon("building"),
  tag: Tag,
  gauge: Gauge,
  selected: CircleCheck,
  /** a check not yet done (an open AC line) */
  unchecked: Circle,
  /** shut to this viewer for now */
  lock: Lock,
  choices: ListChecks,
  lines: AlignLeft,
  quote: Quote,
  expand: Maximize2,
  send: Send,
  sms: MessageSquareText,
  click: MousePointerClick,
  form: ClipboardList,
  video: brandIcon("video"),
  // A video's bar (video.tsx).
  sound: Volume2,
  muted: VolumeX,
  // A row's action icons, by what the action does (row-acts.tsx VERBS). A DM is Instagram's paper
  // plane, apart from a reply's arrow.
  dm: Send,
  archive: Archive,
  restore: ArchiveRestore,
  bell: Bell,
  reschedule: CalendarClock,
  read: CheckCheck,
  copy: Copy,
  unpublish: EyeOff,
  heart: Heart,
  image: ImageIcon,
  addTo: ListPlus,
  ship: Rocket,
  retry: RotateCw,
  lost: ThumbsDown,
  trash: Trash2,
  won: Trophy,
  addPerson: UserPlus,
  passOn: UserX,
  // The kit's own parts and Learn's pages: moved here from direct imports (2026-10-24).
  arrowDown: ArrowDown,
  arrowUp: ArrowUp,
  up: ChevronUp,
  bookmark: Bookmark,
  toggle: ToggleLeft,
  commit: GitCommitVertical,
  rows: Rows3,
  warn: TriangleAlert,
  open: ArrowUpRight,
  server: Server,
  fit: Maximize,
  minus: Minus,
  // a task's medium priority (high: arrowUp, low: arrowDown)
  equal: Equal,
  rss: Rss,
  mobile: Smartphone,
  news: Newspaper,
  podcast: Podcast,
  back: ArrowLeft,
  folder: Folder,
  moveTo: FolderInput,
  newFolder: FolderPlus,
  sort: ArrowDownUp,
  pip: PictureInPicture2,
  // the run graph's dock: a detail window, a new one
  panelRight: PanelRight,
  newWindow: SquarePlus,
} satisfies Record<string, LucideIcon | ReturnType<typeof brandIcon>>;

export type IconName = keyof typeof ICONS;

/** Is `name` one of the kit's? Names that come from data (a component's mark) are only strings. */
export const isIconName = (name: string): name is IconName => Object.hasOwn(ICONS, name);

/** What a name the kit lacks draws, so a part's unknown mark never breaks its page. */
const UNKNOWN = Shapes;

export function Icon({
  name,
  size = 16,
  strokeWidth = 1.6,
  className,
  style,
  fill,
  label,
}: {
  name: IconName;
  size?: number;
  /** Its words for a screen reader, when nothing beside it says them; else it is hidden. */
  label?: string;
  /** Heavier only for a tiny mark (a checkbox's tick), so it still reads. */
  strokeWidth?: number;
  className?: string;
  style?: CSSProperties;
  /** A shape filled in, for an on state (a starred item). */
  fill?: string;
}) {
  const Drawn = isIconName(name) ? ICONS[name] : UNKNOWN;
  return (
    <Drawn
      className={cx("flex-none", className)}
      size={size}
      strokeWidth={strokeWidth}
      style={style}
      {...(fill ? { fill } : {})}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    />
  );
}

/**
 * A glyph inside an SVG, centred on (x, y): the metro map's marks. A nested svg, so the map's CSS
 * (`.ic`) sets the stroke and its width on the 24 grid, as it does for every mark.
 */
export function SvgGlyph({
  name,
  x,
  y,
  size,
  className,
}: {
  name: IconName;
  x: number;
  y: number;
  size: number;
  className?: string;
}) {
  const Drawn = isIconName(name) ? ICONS[name] : UNKNOWN;
  return (
    <Drawn
      className={cx("ic", className)}
      x={x - size / 2}
      y={y - size / 2}
      size={size}
      aria-hidden="true"
    />
  );
}
