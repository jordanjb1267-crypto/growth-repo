/** ISO-8601 week identifier, e.g. "2026-W31". Uses the ISO week-year, which
 *  differs from the calendar year around New Year — Jan 1 can belong to the
 *  previous year's final week. */
export function isoWeekId(date = new Date()): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  // Shift to the Thursday of this week; its calendar year is the ISO week-year.
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function dayId(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/** Start of the ISO week (Monday 00:00 UTC) containing `date`. */
export function isoWeekStart(date = new Date()): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - (day - 1));
  return d;
}
