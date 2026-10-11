/**
 * The kit's named icons: Lucide's (ISC), the one icon vendor (designs/2026-10-11-design-kits.md).
 * Apps name an icon here, or import one from `@wren/ui/lib/lucide`; never lucide itself.
 */
import {
  Activity,
  ArrowRight,
  Banknote,
  BookOpen,
  Briefcase,
  Calendar,
  ChartColumn,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock,
  Code,
  CreditCard,
  Download,
  ExternalLink,
  FileText,
  Flag,
  Globe,
  Hourglass,
  House,
  Inbox,
  Keyboard,
  Layers,
  LayoutGrid,
  Link,
  List,
  type LucideIcon,
  Mail,
  Megaphone,
  Menu,
  Merge,
  MessageSquare,
  Mic,
  PanelLeft,
  Pause,
  Pencil,
  PenLine,
  Phone,
  Pin,
  Play,
  Presentation,
  RefreshCw,
  Reply,
  Search,
  Shapes,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Split,
  SquareKanban,
  Star,
  StickyNote,
  Target,
  Users,
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
  // The frame: the panels, help, keys.
  panel: PanelLeft,
  help: CircleHelp,
  keys: Keyboard,
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
