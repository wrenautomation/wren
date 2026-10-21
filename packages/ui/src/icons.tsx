/**
 * The kit's named icons: Lucide's (ISC), the one icon vendor (designs/2026-10-11-design-kits.md).
 * Apps name an icon here, or import one from `@wren/ui/lib/lucide`; never lucide itself.
 */
import {
  Activity,
  AlignLeft,
  ArrowRight,
  AtSign,
  Banknote,
  BookOpen,
  Bot,
  Boxes,
  Briefcase,
  Building2,
  Calendar,
  ChartColumn,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleDot,
  CircleHelp,
  Clock,
  Code,
  CreditCard,
  DollarSign,
  Download,
  Ellipsis,
  ExternalLink,
  Eye,
  FileText,
  Flag,
  Gauge,
  GitBranch,
  Globe,
  Hash,
  History,
  Hourglass,
  House,
  Inbox,
  Keyboard,
  KeyRound,
  Layers,
  LayoutGrid,
  Link,
  List,
  ListChecks,
  LogOut,
  type LucideIcon,
  Mail,
  Maximize2,
  Megaphone,
  Menu,
  Merge,
  MessageSquare,
  Mic,
  Minimize2,
  OctagonX,
  PanelLeft,
  Pause,
  Pencil,
  PenLine,
  Percent,
  Phone,
  Pin,
  Play,
  Plus,
  Presentation,
  Quote,
  RefreshCw,
  Repeat,
  Reply,
  RotateCcw,
  Search,
  Shapes,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Split,
  SquareArrowOutUpRight,
  SquareKanban,
  Star,
  StickyNote,
  Tag,
  Target,
  Type,
  Upload,
  User,
  UserCheck,
  Users,
  Workflow,
  X,
  Zap,
} from "lucide-react";
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
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

/** Is `name` one of the kit's? Names that come from data (a component's mark) are only strings. */
export const isIconName = (name: string): name is IconName => Object.hasOwn(ICONS, name);

/** What a name the kit lacks draws, so a part's unknown mark never breaks its page. */
const UNKNOWN = Shapes;

export function Icon({
  name,
  size = 16,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  const Drawn = isIconName(name) ? ICONS[name] : UNKNOWN;
  return (
    <Drawn
      className={cx("flex-none", className)}
      size={size}
      strokeWidth={1.75}
      aria-hidden="true"
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
