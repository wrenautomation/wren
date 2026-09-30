/** Calendar days as `YYYY-MM-DD` strings: how bills print them and Postgres `date` stores them. */

/** `day` moved by `n` days (negative = earlier). */
export function shiftDay(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Today in UTC. */
export function today(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
