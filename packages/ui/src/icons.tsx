/**
 * The kit's named icons: Lucide's (ISC), the one icon vendor (designs/2026-10-11-design-kits.md).
 * Every icon is named here, and only this file imports lucide (biome.json: noRestrictedImports).
 */
import {
  Activity,
  AlignLeft,
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowDownUp,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  AtSign,
  Banknote,
  Bell,
  Bookmark,
  BookOpen,
  Bot,
  Boxes,
  Briefcase,
  Building2,
  Calendar,
  CalendarClock,
  ChartColumn,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleAlert,
  CircleCheck,
  CircleDot,
  CircleHelp,
  ClipboardList,
  Clock,
  Code,
  Copy,
  CreditCard,
  DollarSign,
  Download,
  Ellipsis,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Flag,
  Folder,
  FolderInput,
  FolderPlus,
  Gauge,
  GitBranch,
  GitCommitVertical,
  Globe,
  Hash,
  Heart,
  History,
  Hourglass,
  House,
  ImageIcon,
  Inbox,
  Keyboard,
  KeyRound,
  Layers,
  LayoutGrid,
  Link,
  List,
  ListChecks,
  ListPlus,
  LogOut,
  type LucideIcon,
  Mail,
  Maximize,
  Maximize2,
  Megaphone,
  Menu,
  Merge,
  MessageSquare,
  MessageSquareText,
  Mic,
  Minimize2,
  Minus,
  MousePointerClick,
  Newspaper,
  OctagonX,
  PanelLeft,
  Pause,
  Pencil,
  PenLine,
  Percent,
  Phone,
  PictureInPicture2,
  Pin,
  Play,
  Plus,
  Podcast,
  Presentation,
  Quote,
  RefreshCw,
  Repeat,
  Reply,
  Rocket,
  RotateCcw,
  RotateCw,
  Rows3,
  Rss,
  Search,
  Send,
  Server,
  Shapes,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Split,
  SquareArrowOutUpRight,
  SquareKanban,
  Star,
  StickyNote,
  Tag,
  Target,
  ThumbsDown,
  ToggleLeft,
  Trash2,
  TriangleAlert,
  Trophy,
  Type,
  Upload,
  User,
  UserCheck,
  UserPlus,
  Users,
  UserX,
  Video,
  Workflow,
  X,
  Zap,
} from "lucide-react";
import type { CSSProperties } from "react";
import { cx } from "./format.js";

const ICONS = {
  home: House,
  people: Users,
  mail: Mail,
  shield: ShieldCheck,
  money: Banknote,
  reply: Reply,
  link: Link,
  pulse: Activity,
  sliders: SlidersHorizontal,
  play: Play,
  pause: Pause,
  arrow: ArrowRight,
  down: ChevronDown,
  left: ChevronLeft,
  right: ChevronRight,
  close: X,
  check: Check,
  star: Star,
  clock: Clock,
  phone: Phone,
  menu: Menu,
  external: ExternalLink,
  search: Search,
  download: Download,
  pin: Pin,
  // Apps: the launcher, and each app's mark.
  apps: LayoutGrid,
  cycle: RefreshCw,
  flag: Flag,
  board: SquareKanban,
  note: StickyNote,
  inbox: Inbox,
  target: Target,
  megaphone: Megaphone,
  billboard: Presentation,
  bolt: Zap,
  briefcase: Briefcase,
  calendar: Calendar,
  doc: FileText,
  globe: Globe,
  book: BookOpen,
  chat: MessageSquare,
  sparkle: Sparkles,
  stack: Layers,
  mic: Mic,
  card: CreditCard,
  // Steps and parts: what a run did, a workflow's blocks, a component's mark.
  chart: ChartColumn,
  code: Code,
  edit: Pencil,
  list: List,
  merge: Merge,
  page: FileText,
  split: Split,
  wait: Hourglass,
  write: PenLine,
  // A shape's node kinds, and adding and sending files.
  boxes: Boxes,
  dot: CircleDot,
  workflow: Workflow,
  plus: Plus,
  upload: Upload,
  // The frame: the panels, help, keys.
  panel: PanelLeft,
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
  bot: Bot,
  user: User,
  undo: RotateCcw,
  branch: GitBranch,
  history: History,
  stop: OctagonX,
  repeat: Repeat,
  // A list's column heads, by what the column holds (rows.tsx), and a row's Open chip.
  text: Type,
  hash: Hash,
  building: Building2,
  tag: Tag,
  gauge: Gauge,
  selected: CircleCheck,
  choices: ListChecks,
  lines: AlignLeft,
  quote: Quote,
  expand: Maximize2,
  send: Send,
  sms: MessageSquareText,
  click: MousePointerClick,
  form: ClipboardList,
  video: Video,
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
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

/** Is `name` one of the kit's? Names that come from data (a component's mark) are only strings. */
export const isIconName = (name: string): name is IconName => Object.hasOwn(ICONS, name);

/** What a name the kit lacks draws, so a part's unknown mark never breaks its page. */
const UNKNOWN = Shapes;

export function Icon({
  name,
  size = 16,
  strokeWidth = 1.75,
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
