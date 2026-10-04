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
