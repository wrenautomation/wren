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
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  CreditCard,
  Download,
  ExternalLink,
  FileText,
  Flag,
  Globe,
  House,
  Inbox,
  Layers,
  LayoutGrid,
  Link,
  type LucideIcon,
  Mail,
  Megaphone,
  Menu,
  MessageSquare,
  Mic,
  Pause,
  Phone,
  Pin,
  Play,
  Presentation,
  RefreshCw,
  Reply,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
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
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

export function Icon({
  name,
  size = 16,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  const Drawn = ICONS[name];
  return (
    <Drawn
      className={cx("flex-none", className)}
      size={size}
      strokeWidth={1.75}
      aria-hidden="true"
    />
  );
}
