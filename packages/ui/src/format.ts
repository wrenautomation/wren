/** Numbers, dates and names as people read them. */

export const num = (n: number) => n.toLocaleString("en-US");

/** Money shown one way everywhere: "$1,250.00" in a list, "$1,250" in a tile (`whole`). */
export function money(amount: number, currency: string, whole = false): string {
  const d = whole ? 0 : 2;
  try {
    return amount.toLocaleString("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
  } catch {
    return `${currency} ${amount.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
  }
}

/** Seconds as people say them: "38s", "2m 5s", "1h 4m", "3d 2h". */
export function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const two = (big: number, bu: string, small: number, su: string) =>
    small ? `${big}${bu} ${small}${su}` : `${big}${bu}`;
  if (s < 3600) return two(Math.floor(s / 60), "m", s % 60, "s");
  if (s < 86_400) return two(Math.floor(s / 3600), "h", Math.floor((s % 3600) / 60), "m");
  return two(Math.floor(s / 86_400), "d", Math.floor((s % 86_400) / 3600), "h");
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "2025-03-14" -> "Mar 2025"; days would claim a precision the data rarely has. A bad month
 * leaves just the year, and a string that isn't a date gives "".
 */
export function month(day: string | null): string {
  const [, y, m] = /^(\d{4})(?:-(\d{2}))?/.exec(day ?? "") ?? [];
  if (!y) return "";
  return [MONTHS[Number(m) - 1], y].filter(Boolean).join(" ");
}

/** "2024-05-02" -> "1 yr ago", by whole months. No day is "never"; one we can't read is "". */
export function ago(day: string | null, today = new Date()): string {
  if (!day) return "never";
  const d = new Date(`${day.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  const months =
    (today.getUTCFullYear() - d.getUTCFullYear()) * 12 + today.getUTCMonth() - d.getUTCMonth();
  if (months < 1) return "this month";
  if (months < 12) return `${months} mo ago`;
  const years = Math.floor(months / 12);
  return `${years} yr${years > 1 ? "s" : ""} ago`;
}

/**
 * When something later today or this week happens, in the viewer's time: "8:00 PM",
 * "tomorrow 8:00 PM", "Fri 8:00 PM", then "Oct 9". Null once it's past or unreadable.
 */
export function soon(at: string | null, now = new Date()): string | null {
  const d = new Date(at ?? "");
  if (Number.isNaN(d.getTime()) || d <= now) return null;
  const midnight = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((midnight(d) - midnight(now)) / 86_400_000);
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (days === 0) return time;
  if (days === 1) return `tomorrow ${time}`;
  if (days < 7) return `${d.toLocaleDateString("en-US", { weekday: "short" })} ${time}`;
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** "https://www.acme.com/jobs" -> "acme.com"; null when it isn't a URL. */
export function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Sites known by name: a link there reads as the site, or the profile it opens. */
const SITES: Readonly<Record<string, string>> = {
  "linkedin.com": "LinkedIn",
  "x.com": "X",
  "twitter.com": "X",
  "facebook.com": "Facebook",
  "instagram.com": "Instagram",
  "youtube.com": "YouTube",
  "tiktok.com": "TikTok",
  "reddit.com": "Reddit",
  "wise.com": "Wise",
  "stripe.com": "Stripe",
  "cal.com": "Cal.com",
  "github.com": "GitHub",
};

/** A path segment as words: "jane-doe-4a1b2c" -> "Jane Doe". */
const slugWords = (s: string) =>
  decodeURIComponent(s)
    .split(/[-_]/)
    .filter((w) => w && !/\d/.test(w))
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

/**
 * A link as people read it, the address on hover: a page of this app "Open", a phone "Call", a
 * profile its name ("Jane Doe", "@acme"), another page on a known site "Open in Wise", any other
 * site its host ("acme.com"). `label` is the field's: "In Wise" needs no "Wise" again.
 */
export function linkLabel(href: string, label = ""): string {
  if (href.startsWith("/")) return "Open";
  if (href.startsWith("tel:")) return "Call";
  const full = /^[a-z][a-z0-9+.-]*:/i.test(href) ? href : `https://${href}`;
  let url: URL;
  try {
    url = new URL(full);
  } catch {
    return href;
  }
  const host = url.hostname.replace(/^(www|m|mobile)\./, "");
  const site = SITES[host];
  if (!site) return host || href;
  const [a = "", b = ""] = url.pathname.split("/").filter(Boolean);
  if (host === "linkedin.com" && (a === "in" || a === "company") && b) return slugWords(b) || site;
  if (a.startsWith("@")) return a;
  if (["x.com", "twitter.com", "instagram.com"].includes(host) && /^[a-z0-9_.]+$/i.test(a))
    return a === "home" ? site : `@${a}`;
  if (host === "reddit.com" && (a === "r" || a === "u" || a === "user") && b)
    return `${a === "r" ? "r" : "u"}/${b}`;
  return label.toLowerCase().includes(site.toLowerCase()) ? "Open" : `Open in ${site}`;
}

/** "Sample recruiting firm" -> "SR": the first letters of the first two words. */
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

/** Class names, falsy ones dropped. */
export const cx = (...names: (string | false | null | undefined)[]) =>
  names.filter(Boolean).join(" ");
