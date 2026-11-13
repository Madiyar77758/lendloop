/** Date helpers. Loan dates are plain `YYYY-MM-DD` strings (UTC calendar days). */

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export const MAX_LOAN_DAYS = 30;

export function isValidIsoDay(value: string): boolean {
  if (!ISO_DAY.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function todayUtc(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** Inclusive number of days between two ISO days (end - start). */
export function daysBetween(start: string, end: string): number {
  const ms = Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/** Inclusive range overlap. */
export function rangesOverlap(
  a: { startDate: string; endDate: string },
  b: { startDate: string; endDate: string },
): boolean {
  return a.startDate <= b.endDate && b.startDate <= a.endDate;
}
